"use strict";
const { expect } = require("chai");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ethers } = require("hardhat");
const { main, readConfig } = require("../scripts/deploy");
const { checkSepoliaEnv, HARDHAT_PUBLIC_KEYS } = require("../scripts/env");

describe("Deploy script & secrets", function () {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cfg-")), "config.js");

  it("refuses the throw-away in-memory chain unless told otherwise", async function () {
    let err;
    try {
      await main({ file: tmp() });
    } catch (e) {
      err = e;
    }
    expect(err && err.message).to.match(/temporary in-memory chain/);
  });

  it("deploys, makes the local deployer an issuer, and writes only PUBLIC data to the page config", async function () {
    const file = tmp();
    const { address, chainId } = await main({ file, allowEphemeral: true });
    const cfg = readConfig(file);
    expect(cfg.deployments[chainId]).to.include({ address, rpc: "http://127.0.0.1:8545" });
    const reg = await ethers.getContractAt("CertificateRegistry", address);
    const [deployer] = await ethers.getSigners();
    expect(await reg.hasRole(await reg.ISSUER_ROLE(), deployer.address)).to.equal(true);
    expect(fs.readFileSync(file, "utf8")).to.not.match(/[0-9a-f]{64}"/i); // no private key-looking strings
  });

  it(".env checks: placeholders, bad keys and Hardhat's public test keys are refused", function () {
    expect(checkSepoliaEnv({}).ok).to.equal(false);
    expect(checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://sepolia.infura.io/v3/your-project-id", DEPLOYER_PRIVATE_KEY: "0x" + "11".repeat(32) }).ok).to.equal(false);
    expect(checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://rpc.example.org", DEPLOYER_PRIVATE_KEY: HARDHAT_PUBLIC_KEYS[0] }).problems.join()).to.match(/PUBLIC test key/);
    expect(checkSepoliaEnv({ SEPOLIA_RPC_URL: "https://rpc.sepolia.dev", DEPLOYER_PRIVATE_KEY: "0x" + "11".repeat(32) }).ok).to.equal(true);
  });

  it(".env is git-ignored and .env.example holds placeholders only", function () {
    const ignore = fs.readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8");
    expect(ignore).to.match(/^\.env$/m);
    const example = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    expect(example).to.match(/your-/);
    expect(example).to.not.match(/[0-9a-f]{64}/i);
  });
});
