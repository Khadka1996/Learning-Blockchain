// Day 02 — how much harder does mining get per difficulty bit? Measured, not guessed.
// Usage: node src/difficulty.js [maxBits=20] [samples=8]
"use strict";

const { mineBlock, parseDifficulty, toWholeNumber } = require("./block");

const PREV = "0".repeat(64);

/** Mine `samples` fixed blocks per difficulty level (deterministic: same numbers every run). */
function difficultyTable(maxBits = 20, samples = 8, step = 4) {
  const max = parseDifficulty(maxBits);
  const n = toWholeNumber(samples);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new RangeError(`samples must be a whole number from 1 to 100, got "${samples}"`);
  const rows = [];
  for (let d = step; d <= max; d += step) {
    let attempts = 0;
    const start = process.hrtime.bigint();
    for (let s = 0; s < n; s++) {
      attempts += mineBlock({ index: 1, prevHash: PREV, timestamp: s, data: `sample-${s}`, difficulty: d }).attempts;
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    rows.push({ difficulty: d, avgAttempts: attempts / n, expected: 2 ** d, avgMs: ms / n });
  }
  return rows;
}

function main(argv) {
  const rows = difficultyTable(argv[0] ?? 20, argv[1] ?? 8);
  console.log("| Difficulty (zero bits) | Avg attempts (my run) | Expected (2^d) | Avg time per block |");
  console.log("|---:|---:|---:|---:|");
  for (const r of rows) {
    console.log(`| ${r.difficulty} | ${Math.round(r.avgAttempts).toLocaleString("en-US")} | ${r.expected.toLocaleString("en-US")} | ${r.avgMs < 1 ? r.avgMs.toFixed(2) : r.avgMs.toFixed(0)} ms |`);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { difficultyTable };
