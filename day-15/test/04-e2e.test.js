"use strict";
/* global window, document */ // used inside page.evaluate / addInitScript (runs in the browser)
/**
 * End-to-end: the REAL page (frontend/) in Chromium, talking to the registry on
 * Hardhat's in-process chain.
 *  - "no wallet" visitors: the page's read-only RPC calls to 127.0.0.1:8545 are routed
 *    by Playwright into the in-process chain.
 *  - issuers: a tiny stand-in EIP-1193 wallet (`window.ethereum`) forwards to the chain.
 * Skipped with a message if Playwright isn't installed.
 */
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ethers } = hre;
const { createServer } = require("../src/serve");
const Cert = require("../src/certificate");
const { FILES, SRC, DEST } = require("../scripts/build-web");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}
const SHOTS = path.join(__dirname, "..", "screenshots");

function walletInit(account) {
  const listeners = {};
  window.ethereum = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_sendTransaction") params = [{ ...params[0], from: account }];
      const r = await window.__rpc(method, params || []);
      if (r.error) throw Object.assign(new Error(r.error.message), r.error);
      return r.result;
    },
    on: (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn),
    removeListener() {},
  };
}

async function rpc(method, params) {
  try {
    return { result: await hre.network.provider.request({ method, params }) };
  } catch (e) {
    return { error: { code: e.code, message: e.message, data: e.data } };
  }
}

describe("Frontend copies of the shared code", function () {
  it("frontend/lib is identical to src (run npm run build:web after editing src)", function () {
    for (const f of FILES) expect(fs.readFileSync(path.join(DEST, f), "utf8"), f).to.equal(fs.readFileSync(path.join(SRC, f), "utf8"));
  });
});

(chromium ? describe : describe.skip)("E2E — real page in Chromium + Hardhat chain", function () {
  this.timeout(120000);
  let browser, server, base, reg, artifact, signers, where;
  const pageErrors = [];
  afterEach(() => expect(pageErrors, "uncaught errors in the page").to.deep.equal([]));

  before(async function () {
    signers = await ethers.getSigners();
    reg = await ethers.deployContract("CertificateRegistry", [signers[0].address]);
    await reg.grantRole(await reg.ISSUER_ROLE(), signers[1].address);
    artifact = await hre.artifacts.readArtifact("CertificateRegistry");
    where = { address: await reg.getAddress(), chainId: 31337 };
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

  async function open({ account = null, width = 900, timezoneId, clock } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 1300 }, timezoneId });
    const page = await ctx.newPage();
    page.on("close", () => ctx.close());
    if (clock) await page.clock.setFixedTime(clock);
    pageErrors.length = 0;
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const deployments = { 31337: { address: where.address, name: "Hardhat local", explorer: null, rpc: "http://127.0.0.1:8545" } };
    await page.route("**/config.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: `window.DAPP_CONFIG = ${JSON.stringify({ abi: artifact.abi, deployments })};` })
    );
    // read-only JSON-RPC from the page (no wallet) → the in-process chain
    await page.route("http://127.0.0.1:8545/**", async (route) => {
      const body = JSON.parse(route.request().postData());
      const one = async (m) => ({ jsonrpc: "2.0", id: m.id, ...(await rpc(m.method, m.params || [])) });
      const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
      await route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(out) });
    });
    if (account) {
      await page.exposeFunction("__rpc", rpc);
      await page.addInitScript(walletInit, account);
    }
    await page.goto(base);
    return page;
  }

  const issue = async (who, fields) => {
    const c = Cert.create({ registry: where.address, chainId: where.chainId, issuer: who.address, course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29", ...fields });
    await reg.connect(who).issue(Cert.hash(c));
    return c;
  };
  const verdict = async (page, text) => {
    await page.fill("#paste", text);
    await page.click("#verify");
    await page.waitForSelector("#result:not([hidden])");
    await page.waitForFunction(() => document.getElementById("verify").disabled === false);
    return page.locator("#verdict").textContent();
  };

  it("a visitor with NO wallet verifies a real certificate for free", async function () {
    const cert = await issue(signers[1], { id: "LB-2026-001", recipient: "Manish Khadka" });
    const page = await open();
    expect(await verdict(page, JSON.stringify(cert, null, 2))).to.equal("✅ Genuine certificate");
    expect(await page.locator("#details dd").first().textContent()).to.equal("Manish Khadka");
    await page.screenshot({ path: path.join(SHOTS, "verify-valid.png"), fullPage: true });
    await page.close();
  });

  it("an edited certificate, a wrong registry and junk are all refused", async function () {
    const cert = await issue(signers[1], { id: "LB-2026-002", recipient: "Asha Rai" });
    const page = await open();
    expect(await verdict(page, JSON.stringify({ ...cert, course: "Learning Blockchain in 16 Days" }))).to.equal("❌ Not found: fake or edited");
    await page.screenshot({ path: path.join(SHOTS, "verify-fake.png"), fullPage: true });
    expect(await verdict(page, JSON.stringify({ ...cert, registry: signers[5].address }))).to.equal("❌ Wrong registry");
    expect(await verdict(page, JSON.stringify({ ...cert, chainId: 1 }))).to.equal("❌ Wrong registry");
    expect(await verdict(page, "{not json")).to.equal("❌ Not a valid certificate file");
    await page.close();
  });

  it("XSS: a certificate whose name is HTML is shown as text and never runs", async function () {
    const evil = `<img src=x onerror="window.__pwned=1">`;
    const cert = await issue(signers[1], { id: "LB-XSS", recipient: evil });
    const page = await open();
    expect(await verdict(page, JSON.stringify(cert))).to.equal("✅ Genuine certificate");
    expect(await page.locator("#details dd").first().textContent()).to.equal(evil);
    expect(await page.locator("#details img").count()).to.equal(0);
    expect(await page.evaluate(() => window.__pwned)).to.equal(undefined);
    await page.close();
  });

  it("upload: verifying by choosing the .json file works", async function () {
    const cert = await issue(signers[1], { id: "LB-FILE", recipient: "File Upload" });
    const page = await open();
    await page.setInputFiles("#file", { name: "c.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(cert)) });
    await page.click("#verify");
    await page.waitForSelector("#result:not([hidden])");
    expect(await page.locator("#verdict").textContent()).to.equal("✅ Genuine certificate");
    await page.close();
  });

  it("an issuer issues through the form, downloads the file, then revokes it", async function () {
    const page = await open({ account: signers[1].address });
    await page.click("#connect");
    await page.waitForFunction(() => /Connected as an issuer/.test(document.getElementById("status").textContent));
    await page.fill("#recipient", "Sita Gurung");
    await page.fill("#certid", "LB-2026-777");
    await page.fill("#date", "2026-10-29");
    await page.click("#issue");
    await page.waitForFunction(() => /Issued LB-2026-777/.test(document.getElementById("status").textContent));
    const json = await page.inputValue("#paste");
    const cert = JSON.parse(json);
    expect(cert.salt).to.match(/^0x[0-9a-f]{32}$/);
    expect((await reg.verify(signers[1].address, Cert.hash(cert))).status).to.equal(1n);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
    expect(download.suggestedFilename()).to.equal("certificate-LB-2026-777.json");
    expect(await verdict(page, json)).to.equal("✅ Genuine certificate");
    await page.screenshot({ path: path.join(SHOTS, "issuer.png"), fullPage: true });

    await page.fill("#reason-in", "test revoke");
    await page.click("#revoke");
    await page.waitForFunction(() => /Revoked LB-2026-777/.test(document.getElementById("status").textContent));
    await page.waitForFunction(() => /Revoked by the issuer/.test(document.getElementById("verdict").textContent));
    expect((await reg.verify(signers[1].address, Cert.hash(cert))).status).to.equal(2n);
    await page.close();
  });

  it("a connected NON-issuer sees no issue/revoke tools; phone layout has no sideways scroll", async function () {
    const page = await open({ account: signers[7].address, width: 375 });
    await page.click("#connect");
    await page.waitForFunction(() => /not an issuer/.test(document.getElementById("status").textContent));
    expect(await page.locator("#issuer-box").isHidden()).to.equal(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).to.be.at.most(0);
    await page.screenshot({ path: path.join(SHOTS, "phone.png"), fullPage: true });
    await page.close();
  });

  it("L1: the issue form's default date is the issuer's LOCAL date (Nepal, 01:45 on 30 Oct)", async function () {
    // 2026-10-29 20:00 UTC = 2026-10-30 01:45 in Kathmandu
    const page = await open({ timezoneId: "Asia/Kathmandu", clock: new Date("2026-10-29T20:00:00Z") });
    expect(await page.inputValue("#date")).to.equal("2026-10-30");
    await page.close();
  });
});
