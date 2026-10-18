// Day 04 — Exercise 1 (easy): Merkle proof length by arithmetic only.
"use strict";

const { merkleProof } = require("../../src/merkle");

/** Number of sibling hashes in the proof for leaf `index` of a `leafCount`-leaf tree. */
function proofLength(leafCount, index) {
  if (!Number.isSafeInteger(leafCount) || leafCount < 1) throw new RangeError("leafCount must be ≥ 1");
  if (!Number.isSafeInteger(index) || index < 0 || index >= leafCount) throw new RangeError("index out of range");
  let steps = 0;
  for (let i = index, width = leafCount; width > 1; i >>= 1, width = Math.ceil(width / 2)) {
    if (i % 2 === 1 || i + 1 < width) steps++; // has a sibling; otherwise it moves up unchanged
  }
  return steps;
}

function run({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  let checked = 0;
  for (let n = 1; n <= 64; n++) {
    const leaves = Array.from({ length: n }, (_, i) => `tx-${i}`);
    for (let i = 0; i < n; i++) {
      if (proofLength(n, i) !== merkleProof(leaves, i).siblings.length) throw new Error(`mismatch at n=${n}, i=${i}`);
      checked++;
    }
  }
  log(`Checked ${checked.toLocaleString("en-US")} (size, index) pairs against merkleProof: all equal.\n`);
  log("Tree of 5 leaves:");
  const five = [0, 1, 2, 3, 4].map((i) => proofLength(5, i));
  five.forEach((s, i) => log(`  leaf ${i} → ${s} hash${s === 1 ? "" : "es"}`));
  log("\nLeaf 4 is the odd one out twice, so it moves up unchanged and only meets H(0..3) at the top.");
  return { checked, five };
}

if (require.main === module) run();
module.exports = { proofLength, run };
