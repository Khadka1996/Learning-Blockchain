"use strict";

/**
 * Validates the Sepolia settings from .env WITHOUT ever printing the key.
 * Returns { ok, url, key, problems[] }.
 */
const PLACEHOLDER = /your|xxx|replace|example|<|>/i;

function checkSepoliaEnv(env) {
  const problems = [];
  const url = (env.SEPOLIA_RPC_URL || "").trim();
  let key = (env.DEPLOYER_PRIVATE_KEY || "").trim();

  if (!url) problems.push("SEPOLIA_RPC_URL is missing");
  else if (!/^https:\/\//.test(url)) problems.push("SEPOLIA_RPC_URL must start with https://");
  else if (PLACEHOLDER.test(url)) problems.push("SEPOLIA_RPC_URL still holds the placeholder from .env.example");

  if (!key) problems.push("DEPLOYER_PRIVATE_KEY is missing");
  else {
    if (!key.startsWith("0x")) key = "0x" + key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) problems.push("DEPLOYER_PRIVATE_KEY must be 32 bytes of hex (64 characters)");
    // The well-known Hardhat test keys are public: never use them on a real network.
    else if (key.toLowerCase() === "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
      problems.push("DEPLOYER_PRIVATE_KEY is Hardhat's PUBLIC test key: anyone could drain it");
  }
  return { ok: problems.length === 0, url, key: problems.length === 0 ? key : undefined, problems };
}

module.exports = { checkSepoliaEnv };
