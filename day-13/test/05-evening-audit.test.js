"use strict";
/* Evening audit (independent second pass) — one test per finding in QA.md "Evening audit". */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { checkSepoliaEnv, HARDHAT_PUBLIC_KEYS } = require("../scripts/env");

const URL_OK = "https://rpc.sepolia.org";

describe("Evening audit (see QA.md)", function () {
  it("E1: ALL 20 well-known Hardhat test keys are refused for Sepolia, not only account #0", function () {
    const words = "test test test test test test test test test test test junk";
    expect(HARDHAT_PUBLIC_KEYS).to.have.length(20);
    for (let i = 0; i < 20; i++) {
      const key = ethers.HDNodeWallet.fromPhrase(words, undefined, `m/44'/60'/0'/0/${i}`).privateKey;
      for (const form of [key, key.slice(2), key.toUpperCase().replace("0X", "0x")]) {
        const r = checkSepoliaEnv({ SEPOLIA_RPC_URL: URL_OK, DEPLOYER_PRIVATE_KEY: form });
        expect(r.ok, `account #${i}`).to.equal(false);
        expect(r.key).to.equal(undefined);
        expect(r.problems.join(" ")).to.match(/PUBLIC test key/);
        expect(r.problems.join(" ")).to.not.include(key.slice(2, 20)); // never echoes the key
      }
    }
  });

  it("E2: a private key with an upper-case 0X prefix or stray spaces is handled (accepted, normalised) or refused with a plain message", function () {
    const raw = "11".repeat(32);
    for (const form of ["0X" + raw, " 0x" + raw + " ", raw]) {
      const r = checkSepoliaEnv({ SEPOLIA_RPC_URL: URL_OK, DEPLOYER_PRIVATE_KEY: form });
      if (r.ok) expect(r.key).to.equal("0x" + raw);
      else expect(r.problems.join(" ")).to.not.include(raw);
    }
    // a key of all zeros is not a valid secp256k1 key
    const zero = checkSepoliaEnv({ SEPOLIA_RPC_URL: URL_OK, DEPLOYER_PRIVATE_KEY: "0x" + "00".repeat(32) });
    expect(zero.ok).to.equal(false);
  });

  it("E3: RPC URLs with a placeholder, whitespace or a non-https scheme are refused", function () {
    for (const bad of ["https://sepolia.infura.io/v3/YOUR_API_KEY", "ws://rpc.sepolia.org", "ftp://x.org", "https://", "javascript:alert(1)"]) {
      expect(checkSepoliaEnv({ SEPOLIA_RPC_URL: bad, DEPLOYER_PRIVATE_KEY: "0x" + "11".repeat(32) }).ok, bad).to.equal(false);
    }
  });
});
