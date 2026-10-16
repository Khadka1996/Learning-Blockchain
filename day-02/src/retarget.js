// Day 02 (evening) — difficulty adjustment: the chain tunes its own difficulty so blocks
// arrive at a steady pace, no matter how fast the miners are. Bitcoin: every 2016 blocks, 10 min each.
// Usage: node src/retarget.js [startBits=8] [targetMs=100] [blocks=40]
"use strict";

const { parseDifficulty, toWholeNumber } = require("./block");
const { Blockchain } = require("./chain");

const INTERVAL = 5;

function runRetarget(startBits = 8, targetMs = 100, count = 40) {
  const blocks = toWholeNumber(count);
  if (!Number.isInteger(blocks) || blocks < INTERVAL || blocks > 200) throw new RangeError(`blocks must be a whole number from ${INTERVAL} to 200, got "${count}"`);
  const chain = new Blockchain(parseDifficulty(startBits), { retarget: { interval: INTERVAL, targetMs } });
  const windows = [];
  let win = null;
  for (let i = 1; i <= blocks; i++) {
    if (!win || win.n === INTERVAL) windows.push((win = { from: i, difficulty: chain.nextDifficulty, n: 0, ms: 0, attempts: 0 }));
    const r = chain.addBlock(`block ${i}`);
    win.n += 1;
    win.ms += r.ms;
    win.attempts += r.attempts;
  }
  return { chain, windows, valid: chain.isValid() };
}

function main(argv) {
  const target = toWholeNumber(argv[1] ?? 100);
  const { windows, valid } = runRetarget(argv[0] ?? 8, target, argv[2] ?? 40);
  console.log(`Target: ${target} ms per block · retarget every ${INTERVAL} blocks · max ±2 bits per step\n`);
  console.log("Blocks    Difficulty  Avg time/block  Avg hashes/block");
  for (const w of windows) {
    const range = `${w.from}–${w.from + w.n - 1}`;
    console.log(`${range.padEnd(9)} ${String(w.difficulty).padStart(5)} bits  ${(w.ms / w.n).toFixed(1).padStart(10)} ms  ${Math.round(w.attempts / w.n).toLocaleString("en-US").padStart(14)}`);
  }
  console.log(`\nChain valid (difficulty re-checked for every block): ${valid}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { INTERVAL, runRetarget };
