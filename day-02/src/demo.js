// Day 02 — build a small blockchain: mine 4 blocks on top of genesis and validate it.
// Usage: node src/demo.js [difficultyBits=16]
"use strict";

const { parseDifficulty } = require("./block");
const { Blockchain, GENESIS_TIMESTAMP } = require("./chain");

const PAYMENTS = ["Sita pays Ram 5 coins", "Ram pays Hari 2 coins", "Hari pays Gita 1 coin", "Gita pays Sita 3 coins"];

/** Build the demo chain. Timestamps are fixed (1 block per minute) so every run gives the same hashes. */
function buildDemoChain(difficulty = 16, payments = PAYMENTS) {
  const chain = new Blockchain(difficulty);
  const mined = payments.map((data, i) => chain.addBlock(data, GENESIS_TIMESTAMP + (i + 1) * 60_000));
  return { chain, mined };
}

function main(argv) {
  const difficulty = parseDifficulty(argv[0] ?? 16);
  const { chain, mined } = buildDemoChain(difficulty);
  console.log(`Difficulty: ${difficulty} leading zero bits (expected ~${(2 ** difficulty).toLocaleString("en-US")} guesses per block)\n`);
  console.log("#  data                      nonce      hash (first 16 hex)  prevHash (first 16 hex)");
  for (const b of chain.blocks) {
    console.log(`${String(b.index).padEnd(2)} ${String(b.data).slice(0, 25).padEnd(25)} ${String(b.nonce).padStart(9)}  ${b.hash.slice(0, 16)}     ${b.prevHash.slice(0, 16)}`);
  }
  const attempts = mined.reduce((s, m) => s + m.attempts, 0);
  const ms = mined.reduce((s, m) => s + m.ms, 0);
  console.log(`\nMined ${mined.length} blocks: ${attempts.toLocaleString("en-US")} hashes in ${ms.toFixed(0)} ms`);
  console.log(`Chain valid: ${chain.isValid()}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { PAYMENTS, buildDemoChain };
