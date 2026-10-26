"use strict";
/* Exercise 1 (easy): how many bisection rounds does a fraud proof need? */
const R = require("../../src/rollup");

/** ⌈log2 n⌉ using integers only (no floating-point surprises). */
function roundsFor(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer");
  let rounds = 0;
  for (let size = 1; size < n; size *= 2) rounds++;
  return rounds;
}

/** Runs a real challenge against a sequencer that lies after tx #k and returns the rounds used. */
function measuredRounds(n, k) {
  const genesis = [1_000, 1_000, 1_000, 1_000];
  const txs = R.randomTxs(n, 4, 7);
  const honest = R.executeBatch(genesis, txs);
  const cheat = R.cheatingRoots(genesis, txs, k, 0, 500);
  const l1 = new R.RollupL1(genesis);
  l1.depositBond("seq", 10);
  const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: cheat.at(-1), now: 0 });
  const res = l1.challenge(id, 1, (i) => cheat[i], { rootAt: (i) => honest.roots[i], stateAt: (i) => honest.states[i] }, "w");
  return res;
}

module.exports = { roundsFor, measuredRounds };

if (require.main === module) {
  console.log("txs in batch | formula ⌈log2 n⌉ | measured rounds | tx found");
  for (const n of [1, 2, 3, 10, 100, 1000]) {
    const k = Math.floor(n / 2);
    const r = measuredRounds(n, k);
    console.log(`${String(n).padStart(12)} | ${String(roundsFor(n)).padStart(15)} | ${String(r.rounds).padStart(15)} | #${r.index}`);
  }
}
