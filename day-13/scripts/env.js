"use strict";

/**
 * Validates the Sepolia settings from .env WITHOUT ever printing the key.
 * Returns { ok, url, key, problems[] }.
 */
const PLACEHOLDER = /your|xxx|replace|example|<|>/i;

// The 20 accounts Hardhat/Anvil print by default come from a PUBLIC mnemonic, so
// all 20 private keys are known to everyone (bots sweep them on every real network).
const { HDNodeWallet } = require("ethers");
const PUBLIC_MNEMONIC = "test test test test test test test test test test test junk";
const HARDHAT_PUBLIC_KEYS = Array.from({ length: 20 }, (_, i) =>
  HDNodeWallet.fromPhrase(PUBLIC_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).privateKey.toLowerCase()
);
// secp256k1 group order: a valid private key is 1 .. N-1
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function isHttpsUrlWithHost(text) {
  try {
    const u = new URL(text);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function checkSepoliaEnv(env) {
  const problems = [];
  const url = (env.SEPOLIA_RPC_URL || "").trim();
  let key = (env.DEPLOYER_PRIVATE_KEY || "").trim();

  if (!url) problems.push("SEPOLIA_RPC_URL is missing");
  else if (!isHttpsUrlWithHost(url)) problems.push("SEPOLIA_RPC_URL must be a full https:// URL with a host name");
  else if (PLACEHOLDER.test(url)) problems.push("SEPOLIA_RPC_URL still holds the placeholder from .env.example");

  if (!key) problems.push("DEPLOYER_PRIVATE_KEY is missing");
  else {
    key = key.replace(/^0x/i, "0x");
    if (!key.startsWith("0x")) key = "0x" + key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) problems.push("DEPLOYER_PRIVATE_KEY must be 32 bytes of hex (64 characters)");
    else if (BigInt(key) === 0n || BigInt(key) >= CURVE_N) problems.push("DEPLOYER_PRIVATE_KEY is not a valid private key");
    // The well-known Hardhat test keys are public: never use them on a real network.
    else if (HARDHAT_PUBLIC_KEYS.includes(key.toLowerCase()))
      problems.push("DEPLOYER_PRIVATE_KEY is a Hardhat PUBLIC test key: anyone could drain it");
  }
  return { ok: problems.length === 0, url, key: problems.length === 0 ? key : undefined, problems };
}

module.exports = { checkSepoliaEnv, HARDHAT_PUBLIC_KEYS };
