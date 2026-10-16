// Exercise 1 (easy) — where does a tampered chain break, and how much must be re-mined?
"use strict";

const { validateBlocks } = require("../../src/chain");
const { buildDemoChain } = require("../../src/demo");

/**
 * Returns null for a valid chain, otherwise
 * { firstBad, reason, mustRemine } — every block from firstBad to the tip must be re-mined.
 */
function findBreak(blocks, difficulty) {
  const r = validateBlocks(blocks, { difficulty });
  if (r.valid) return null;
  return { firstBad: r.index, reason: r.reason, mustRemine: blocks.length - r.index };
}

function demo() {
  const { chain } = buildDemoChain(12);
  const blocks = chain.blocks.map((b) => ({ ...b }));
  console.log("Honest chain     :", findBreak(blocks, 12) ?? "valid");
  blocks[3] = { ...blocks[3], data: "Hari pays Gita 100 coins" };
  const r = findBreak(blocks, 12);
  console.log(`Edited block 3   : breaks at block ${r.firstBad} — ${r.reason}`);
  console.log(`Blocks to re-mine: ${r.mustRemine} (block ${r.firstBad} up to the tip)`);
}

if (require.main === module) demo();

module.exports = { findBreak };
