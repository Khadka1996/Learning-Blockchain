"use strict";
/* global window, document, getComputedStyle */ // used inside page.evaluate / addInitScript (runs in the browser)
/**
 * End-to-end: the REAL frontend (frontend/index.html + app.js + ethers) in a real
 * Chromium browser, talking to a TipJar on Hardhat's in-process chain.
 *
 * MetaMask can't be automated here, so the test injects a tiny stand-in wallet:
 * an EIP-1193 `window.ethereum` (the same interface MetaMask exposes) that forwards
 * every request to the Hardhat node, can switch accounts, and can "reject" like a
 * user pressing Cancel.
 *
 * Needs Playwright + Chromium (`npm i -D playwright && npx playwright install chromium`).
 * If they are missing the suite is skipped with a message rather than failing.
 */
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ethers } = hre;
const { createServer } = require("../src/serve");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}

const SHOTS = path.join(__dirname, "..", "screenshots");

// Runs inside the page BEFORE app.js: the stand-in wallet.
function walletInit() {
  const listeners = {};
  const w = {
    account: 0,
    rejectNext: false,
    calls: [],
    async request({ method, params }) {
      w.calls.push(method);
      if (w.rejectNext && (method === "eth_sendTransaction" || method === "eth_requestAccounts")) {
        w.rejectNext = false;
        const e = new Error("User rejected the request.");
        e.code = 4001;
        throw e;
      }
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        const all = await window.__rpc("eth_accounts", []);
        return [all.result[w.account]];
      }
      const r = await window.__rpc(method, params || []);
      if (r.error) {
        const e = new Error(r.error.message);
        e.code = r.error.code;
        e.data = r.error.data;
        throw e;
      }
      return r.result;
    },
    on(ev, fn) {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    removeListener(ev, fn) {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    },
    emit(ev, arg) {
      (listeners[ev] || []).forEach((f) => f(arg));
    },
  };
  window.ethereum = w;
  window.__wallet = w;
}

(chromium ? describe : describe.skip)("E2E — real frontend in Chromium + Hardhat chain", function () {
  this.timeout(120000);
  let browser, server, base, jar, signers, artifact;
  const pageErrors = []; // uncaught JS errors in the page fail the test
  afterEach(() => expect(pageErrors, "uncaught errors in the page").to.deep.equal([]));

  before(async function () {
    signers = await ethers.getSigners();
    jar = await ethers.deployContract("TipJar");
    artifact = await hre.artifacts.readArtifact("TipJar");
    server = createServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch();
    fs.mkdirSync(SHOTS, { recursive: true });
  });
  after(async function () {
    if (browser) await browser.close();
    if (server) server.close();
  });

  /** Open the dApp with a given config (chain id → address) and optionally no wallet. */
  async function open({ deployments, wallet = true, width = 900, init = null } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    pageErrors.length = 0;
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const deps = deployments || { 31337: { address: await jar.getAddress(), name: "Hardhat local", explorer: null } };
    await page.route("**/config.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: `window.DAPP_CONFIG = ${JSON.stringify({ abi: artifact.abi, deployments: deps })};` })
    );
    if (wallet) {
      await page.exposeFunction("__rpc", async (method, params) => {
        try {
          return { result: await hre.network.provider.request({ method, params }) };
        } catch (e) {
          return { error: { code: e.code, message: e.message, data: e.data } };
        }
      });
      await page.addInitScript(walletInit);
    }
    if (init) await page.addInitScript(init);
    await page.goto(base);
    return page;
  }

  const status = (page) => page.locator("#status").textContent();
  const waitStatus = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById("status").textContent), re.source);

  it("connects, sends a tip through the form, and shows it from the chain", async function () {
    const page = await open();
    await page.click("#connect");
    await waitStatus(page, /Connected/);
    expect(await page.locator("#network").textContent()).to.equal("Hardhat local");

    await page.fill("#amount", "0.002");
    await page.fill("#message", "Hello from the browser 👋");
    expect(await page.locator("#bytes").textContent()).to.equal("27 / 140 bytes");
    await page.click("#send");
    await waitStatus(page, /Tip confirmed in block \d+/);

    const [t] = await jar.getTips(0, 1);
    expect(t.message).to.equal("Hello from the browser 👋");
    expect(t.amount).to.equal(ethers.parseEther("0.002"));
    expect(t.from).to.equal(signers[0].address);
    expect(await page.locator("#tips li .tip-msg").first().textContent()).to.equal("Hello from the browser 👋");
    expect(await page.locator("#count").textContent()).to.equal("1");
    await page.close();
  });

  it("XSS: a message that is HTML/JS is shown as plain text and never runs", async function () {
    const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>`;
    await jar.connect(signers[3]).tip(evil, { value: ethers.parseEther("0.001") });
    const page = await open();
    await page.click("#connect");
    await waitStatus(page, /Connected/);
    await page.waitForSelector("#tips li");
    expect(await page.locator("#tips li .tip-msg").first().textContent()).to.equal(evil);
    expect(await page.locator("#tips img, #tips script").count()).to.equal(0);
    expect(await page.evaluate(() => window.__pwned)).to.equal(undefined);
    await page.close();
  });

  it("bad input is caught in the page BEFORE the wallet is asked (no transaction sent)", async function () {
    const page = await open();
    await page.click("#connect");
    await waitStatus(page, /Connected/);
    const before = await jar.tipCount();
    const cases = [
      ["0.00001", "hi", /smallest tip is 0.0001 ETH/],
      ["abc", "hi", /Enter the amount as a number/],
      ["-1", "hi", /Enter the amount as a number|smallest tip/],
      ["0.001", "   ", /Please write a message/],
      ["0.001", "🔗".repeat(36), /144 bytes; the limit is 140/],
    ];
    for (const [amount, msg, re] of cases) {
      await page.fill("#amount", amount);
      await page.fill("#message", msg);
      await page.click("#send");
      expect(await status(page), `${amount} / ${msg.slice(0, 8)}`).to.match(re);
    }
    expect(await jar.tipCount()).to.equal(before);
    expect(await page.evaluate(() => window.__wallet.calls.includes("eth_sendTransaction"))).to.equal(false);
    await page.close();
  });

  it("user presses Cancel in the wallet → a plain message, nothing sent, form usable again", async function () {
    const page = await open();
    await page.click("#connect");
    await waitStatus(page, /Connected/);
    const before = await jar.tipCount();
    await page.evaluate(() => (window.__wallet.rejectNext = true));
    await page.fill("#message", "maybe later");
    await page.click("#send");
    await waitStatus(page, /cancelled the request/);
    expect(await jar.tipCount()).to.equal(before);
    expect(await page.locator("#send").isDisabled()).to.equal(false);
    await page.close();
  });

  it("owner sees Withdraw and it works; switching to another account hides it", async function () {
    const page = await open();
    await page.click("#connect");
    await waitStatus(page, /Connected/);
    expect(await page.locator("#owner-box").isVisible()).to.equal(true);
    const inJar = await ethers.provider.getBalance(jar);
    expect(inJar > 0n).to.equal(true);
    await page.click("#withdraw");
    await waitStatus(page, /Withdrawn in block/);
    expect(await ethers.provider.getBalance(jar)).to.equal(0n);
    // A contract revert (custom error) is decoded into plain words.
    await page.click("#withdraw");
    await waitStatus(page, /The jar is empty\./);

    await page.evaluate(async () => {
      window.__wallet.account = 1;
      const accs = await window.__wallet.request({ method: "eth_accounts" });
      window.__wallet.emit("accountsChanged", accs);
    });
    await page.waitForFunction(() => document.getElementById("owner-box").hidden === true);
    expect(await page.locator("#account").textContent()).to.include(signers[1].address.slice(0, 6));
    await page.close();
  });

  it("wrong network → explains it and offers a Switch button", async function () {
    const page = await open({ deployments: { 11155111: { address: await jar.getAddress(), name: "Sepolia testnet", explorer: "https://sepolia.etherscan.io" } } });
    await page.click("#connect");
    await waitStatus(page, /not deployed on this network/);
    expect(await status(page)).to.include("Sepolia testnet (11155111)");
    expect(await page.locator("#switch").isVisible()).to.equal(true);
    expect(await page.locator("#send").isDisabled()).to.equal(true);
    await page.close();
  });

  it("stale config (no contract at the address) → clear error, not a crash", async function () {
    const page = await open({ deployments: { 31337: { address: "0x000000000000000000000000000000000000dEaD", name: "Hardhat local", explorer: null } } });
    await page.click("#connect");
    await waitStatus(page, /No contract at/);
    expect(await page.locator("#send").isDisabled()).to.equal(true);
    await page.close();
  });

  it("no wallet installed → tells the user to install one", async function () {
    const page = await open({ wallet: false });
    await page.click("#connect");
    expect(await status(page)).to.match(/No wallet found\. Install MetaMask/);
    await page.close();
  });

  it("L1: two quick account switches leave exactly ONE polling timer (no leak, no double requests)", async function () {
    const countTimers = () => {
      const live = new Set();
      const si = window.setInterval.bind(window);
      const ci = window.clearInterval.bind(window);
      window.setInterval = (fn, ms) => {
        const id = si(fn, ms);
        live.add(id);
        return id;
      };
      window.clearInterval = (id) => {
        live.delete(id);
        ci(id);
      };
      window.__liveTimers = () => live.size;
    };
    const page = await open({ init: countTimers });
    await page.click("#connect");
    await page.waitForFunction(() => window.__liveTimers() >= 1);
    expect(await page.evaluate(() => window.__liveTimers())).to.equal(1);
    // MetaMask can fire accountsChanged twice in a row (e.g. lock/unlock, quick switch).
    await page.evaluate(async () => {
      const all = await window.__rpc("eth_accounts", []);
      window.__wallet.account = 1;
      window.__wallet.emit("accountsChanged", [all.result[1]]);
      window.__wallet.account = 2;
      window.__wallet.emit("accountsChanged", [all.result[2]]);
    });
    await page.waitForFunction((a) => document.getElementById("account").textContent.includes(a), signers[2].address.slice(0, 6));
    await page.waitForFunction(() => window.__liveTimers() >= 1);
    await page.waitForTimeout(500); // let any slower, overlapping setup() finish too
    expect(await page.evaluate(() => window.__liveTimers())).to.equal(1);
    await page.close();
  });

  it("Info: a message with a right-to-left override can't flip the address/amount line", async function () {
    const spoof = "pay me \u202Etxet desrever";
    await jar.connect(signers[4]).tip(spoof, { value: ethers.parseEther("0.001") });
    const page = await open();
    await page.click("#connect");
    await waitStatus(page, /Connected/);
    await page.waitForSelector("#tips li");
    const first = page.locator("#tips li").first();
    expect(await first.locator(".tip-msg").evaluate((el) => getComputedStyle(el).unicodeBidi)).to.equal("isolate");
    expect(await first.locator(".tip-meta").textContent()).to.match(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} · 0\.001 ETH · /);
    await page.close();
  });

  it("screenshot: 3 tips, desktop and phone width (saved to screenshots/)", async function () {
    jar = await ethers.deployContract("TipJar"); // fresh jar for a clean picture
    for (const [who, amt, msg] of [
      [1, "0.001", "Thanks for the Day 12 notes!"],
      [2, "0.005", "Great series 🔗"],
      [3, "0.002", "नमस्ते from Kathmandu"],
    ]) {
      await jar.connect(signers[who]).tip(msg, { value: ethers.parseEther(amt) });
    }
    for (const [name, width] of [["dapp-desktop.png", 900], ["dapp-phone.png", 390]]) {
      const page = await open({ width });
      await page.click("#connect");
      await waitStatus(page, /Connected/);
      await page.waitForSelector("#tips li");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${name} has horizontal scroll`).to.equal(false);
      await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
      await page.close();
    }
  });
});
