"use strict";
const { expect } = require("chai");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { checkSepoliaEnv } = require("../scripts/env");
const { createServer, resolveSafe, ROOT } = require("../src/serve");

const GOOD_KEY = "0x" + "11".repeat(32);

describe("Deploy settings (.env) — secrets are validated, never printed", function () {
  it("accepts a real-looking https URL + 32-byte key (with or without 0x)", function () {
    const r = checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://rpc.sepolia.org", DEPLOYER_PRIVATE_KEY: GOOD_KEY.slice(2) });
    expect(r.ok).to.equal(true);
    expect(r.key).to.equal(GOOD_KEY);
  });

  it("refuses missing values and the untouched .env.example placeholders", function () {
    expect(checkSepoliaEnv({}).problems).to.have.length(2);
    const example = Object.fromEntries(
      fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8")
        .split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("="))
    );
    const r = checkSepoliaEnv(example);
    expect(r.ok).to.equal(false);
    expect(r.key).to.equal(undefined);
  });

  it("refuses http:// RPC URLs, short keys and Hardhat's PUBLIC test key", function () {
    expect(checkSepoliaEnv({ SEPOLIA_RPC_URL: "http://rpc.sepolia.org", DEPLOYER_PRIVATE_KEY: GOOD_KEY }).ok).to.equal(false);
    expect(checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://rpc.sepolia.org", DEPLOYER_PRIVATE_KEY: "0x1234" }).ok).to.equal(false);
    const hh = checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://rpc.sepolia.org", DEPLOYER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" });
    expect(hh.ok).to.equal(false);
    expect(hh.problems.join(" ")).to.match(/PUBLIC test key/);
  });

  it("problem messages never contain the key itself", function () {
    const bad = "0x" + "ab".repeat(31) + "zz";
    const r = checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://rpc.sepolia.org", DEPLOYER_PRIVATE_KEY: bad });
    expect(r.problems.join(" ")).to.not.include("abab");
  });

  it(".env is git-ignored and .env.example holds no real secret", function () {
    const gi = fs.readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8");
    expect(gi).to.match(/^\.env$/m);
    const ex = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    expect(ex).to.not.match(/[0-9a-fA-F]{64}/);
  });
});

describe("Static server — only serves frontend/", function () {
  let server, port;
  before(async function () {
    server = createServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => server.close());

  const get = (p, method = "GET") =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: p, method }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });

  it("serves index.html with nosniff", async function () {
    const r = await get("/");
    expect(r.status).to.equal(200);
    expect(r.body).to.include("TipJar");
    expect(r.headers["x-content-type-options"]).to.equal("nosniff");
  });

  it("path traversal is refused (raw, encoded, double-dot, null byte, bad escape)", async function () {
    for (const p of ["/../hardhat.config.js", "/%2e%2e/.env.example", "/..%2f..%2fpackage.json", "/a%00.html", "/%E0%A4%A"]) {
      const r = await get(p);
      expect(r.status, p).to.be.oneOf([400, 404]);
      expect(r.body).to.not.include("loadEnvFile");
    }
    expect(resolveSafe("/../x")).to.equal(null);
    expect(resolveSafe("/ok.js")).to.equal(path.join(ROOT, "ok.js"));
  });

  it("only GET/HEAD", async function () {
    expect((await get("/", "POST")).status).to.equal(405);
  });
});

describe("QA findings — deploy script & server", function () {
  const os = require("node:os");
  const { readConfig, main } = require("../scripts/deploy");

  it("L2: a corrupted frontend/config.js is NOT silently replaced (it may hold the Sepolia address)", function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const file = path.join(dir, "config.js");
    expect(readConfig(file)).to.deep.equal({ deployments: {} }); // missing → fine
    fs.writeFileSync(file, 'window.DAPP_CONFIG = { "deployments": { "11155111": { "address": "0xabc" } }, oops');
    expect(() => readConfig(file)).to.throw(/not valid.*refusing to overwrite/);
  });

  it("L3: deploying to the temporary in-memory chain refuses (and writes nothing)", async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const file = path.join(dir, "config.js");
    let err;
    try {
      await main({ file });
    } catch (e) {
      err = e;
    }
    expect(err && err.message).to.match(/temporary in-memory chain/);
    expect(fs.existsSync(file)).to.equal(false);
  });

  it("deploy script writes ABI + address per chain and KEEPS other chains", async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const file = path.join(dir, "config.js");
    const sep = { address: "0x" + "12".repeat(20), name: "Sepolia testnet", explorer: "https://sepolia.etherscan.io", deployBlock: 5 };
    fs.writeFileSync(file, `window.DAPP_CONFIG = ${JSON.stringify({ deployments: { 11155111: sep } })};`);
    const { address, chainId } = await main({ file, allowEphemeral: true });
    const cfg = readConfig(file);
    expect(cfg.deployments[chainId].address).to.equal(address);
    expect(cfg.deployments[11155111]).to.deep.equal(sep);
    expect(cfg.abi.some((x) => x.name === "tip")).to.equal(true);
    expect(fs.readFileSync(file, "utf8")).to.not.match(/[0-9a-fA-F]{64}/); // no keys, ever
  });

  it("L4: the server forbids framing (clickjacking) and the page CSP allows only its own scripts", async function () {
    const server = createServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const res = await new Promise((resolve) => http.get({ host: "127.0.0.1", port: server.address().port, path: "/" }, resolve));
    res.resume();
    server.close();
    expect(res.headers["x-frame-options"]).to.equal("DENY");
    expect(res.headers["content-security-policy"]).to.equal("frame-ancestors 'none'");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)[1];
    expect(csp).to.include("script-src 'self'");
    expect(csp).to.not.include("unsafe-inline");
    expect(csp).to.not.include("unsafe-eval");
    const code = html.replace(/<!--[\s\S]*?-->/g, "");
    expect(code).to.not.match(/<script(?![^>]*\bsrc=)[^>]*>/); // every <script> has src= (no inline JS)
  });

  it("frontend source never uses innerHTML / outerHTML / insertAdjacentHTML / document.write", function () {
    const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    expect(src).to.not.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
