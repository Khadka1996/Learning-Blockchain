"use strict";
/* Shared deployment + signing helpers for the demo and the tests. */
const { ethers } = require("hardhat");

const HOUR = 3600;
const ETH_USD_8 = (usd) => BigInt(Math.round(usd * 1e8)); // Chainlink ETH/USD uses 8 decimals

/** ETH/USD feed + sequencer-uptime feed + naive and safe readers (L2 setup). */
async function deployOracles({ price = 2000, heartbeat = HOUR, grace = HOUR, min = 100, max = 100_000 } = {}) {
  const Feed = await ethers.getContractFactory("MockV3Aggregator");
  const feed = await Feed.deploy(8, "ETH / USD", ETH_USD_8(price));
  const seq = await Feed.deploy(0, "L2 Sequencer Uptime", 0);
  // The sequencer has been "up" since long ago: push a round that started 1 day back.
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await seq.updateRoundData(0, now - 24 * HOUR, now - 24 * HOUR);

  const naive = await (await ethers.getContractFactory("NaivePriceReader")).deploy(feed);
  const Safe = await ethers.getContractFactory("SafePriceReader");
  const safe = await Safe.deploy(feed, seq, heartbeat, grace, ETH_USD_8(min), ETH_USD_8(max));
  return { feed, seq, naive, safe, Safe };
}

/** Validators sorted by address (SafeBridge requires strictly increasing signers). */
function makeValidators(n) {
  return Array.from({ length: n }, () => ethers.Wallet.createRandom()).sort((a, b) =>
    BigInt(a.address) < BigInt(b.address) ? -1 : 1,
  );
}

/** L1 lockbox + token, SafeBridge (+ wrapped token) and NaiveBridge (+ wrapped token). */
async function deployBridges({ validators, threshold = 2, srcChainId = 1n, supply = ethers.parseEther("1000000") }) {
  const addrs = validators.map((v) => v.address);
  const token = await (await ethers.getContractFactory("TestToken")).deploy(supply);
  const lockbox = await (await ethers.getContractFactory("L1Lockbox")).deploy(token);

  const Wrapped = await ethers.getContractFactory("WrappedToken");
  const bridge = await (await ethers.getContractFactory("SafeBridge")).deploy(srcChainId, addrs, threshold);
  const wrapped = await Wrapped.deploy("Wrapped tUSD", "wtUSD", bridge);
  await bridge.setToken(wrapped);

  const naive = await (await ethers.getContractFactory("NaiveBridge")).deploy(addrs, threshold);
  const naiveWrapped = await Wrapped.deploy("Naive wtUSD", "nwtUSD", naive);
  await naive.setToken(naiveWrapped);

  return { token, lockbox, bridge, wrapped, naive, naiveWrapped, srcChainId };
}

/** Each validator signs the SafeBridge digest; returns signatures in signer-address order. */
async function signMint(bridge, signers, { srcChainId, depositId, to, amount }) {
  const digest = await bridge.mintDigest(srcChainId, depositId, to, amount);
  // mintDigest is already the eth-signed-message hash, so sign the raw digest.
  return signers.map((w) => w.signingKey.sign(digest).serialized);
}

/** What NaiveBridge validators sign: only (to, amount). */
async function signNaive(signers, to, amount) {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [to, amount]));
  return Promise.all(signers.map((w) => w.signMessage(ethers.getBytes(inner))));
}

/** Reads Deposit events from the lockbox — what a validator node does all day. */
async function readDeposits(lockbox) {
  const logs = await lockbox.queryFilter(lockbox.filters.Deposit());
  return logs.map((l) => ({ depositId: l.args.depositId, to: l.args.to, amount: l.args.amount }));
}

module.exports = { HOUR, ETH_USD_8, deployOracles, makeValidators, deployBridges, signMint, signNaive, readDeposits };
