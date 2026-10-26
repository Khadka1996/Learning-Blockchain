"use strict";
/* Day 12 — rollup demo: (1) why batching is cheap, (2) a cheating sequencer caught by a fraud proof. */
const R = require("./rollup");

const fmt = (n) => Math.round(n).toLocaleString("en-US");

console.log("\n=== 1. What one transfer costs on L1 when it rides in a rollup batch ===");
console.log(`(plain L1 transfer = ${fmt(R.L1_TRANSFER_GAS)} gas; each rollup tx = ${R.TX_BYTES} bytes of calldata)\n`);
console.log("  txs in batch | batch gas on L1 | gas per tx | vs L1 transfer");
for (const n of [1, 10, 100, 1000]) {
  const c = R.batchCost(R.randomTxs(n, 50));
  const ratio = R.L1_TRANSFER_GAS / c.gasPerTx;
  console.log(
    `  ${String(n).padStart(12)} | ${fmt(c.totalGas).padStart(15)} | ${fmt(c.gasPerTx).padStart(10)} | ${
      ratio >= 1 ? ratio.toFixed(1) + "x cheaper" : (1 / ratio).toFixed(1) + "x MORE expensive"
    }`,
  );
}

console.log("\n=== 2. A cheating sequencer vs one honest watcher ===");
const genesis = Array(50).fill(1000);
const txs = R.randomTxs(1000, 50, 7);
const honest = R.executeBatch(genesis, txs);
const THIEF = 0;
const lieAt = 637;
const lies = R.cheatingRoots(genesis, txs, lieAt, THIEF, 1_000_000);

const l1 = new R.RollupL1(genesis);
l1.depositBond("sequencer", 10);
let now = 1_000;
const id = l1.postBatch({ sequencer: "sequencer", txs, claimedPostRoot: lies.at(-1), now });
console.log(`Sequencer posts 1,000 txs. Secretly, after tx #${lieAt} it gave itself 1,000,000 coins.`);
console.log(`Claimed final root: ${lies.at(-1).slice(0, 16)}…   honest root: ${honest.roots.at(-1).slice(0, 16)}…`);

now += 2 * 24 * 3600; // a watcher re-executes the public data two days later
const res = l1.challenge(id, now, (i) => lies[i], { rootAt: (i) => honest.roots[i], stateAt: (i) => honest.states[i] }, "watcher");
console.log(`Challenge on day 2 → fraud proven: ${res.fraud}, bad tx found: #${res.index}, bisection rounds: ${res.rounds}`);
console.log(`L1 re-executed just ONE transaction. Batch status: ${l1.batches[id].status}.`);
console.log(`Sequencer bond: ${l1.bonds.get("sequencer")} ETH (slashed) · watcher reward: ${l1.bonds.get("watcher")} ETH`);

console.log("\n=== 3. Why withdrawals from an optimistic rollup take 7 days ===");
l1.depositBond("sequencer", 10);
now += 3600;
const good = l1.postBatch({ sequencer: "sequencer", txs, claimedPostRoot: honest.roots.at(-1), now });
for (const day of [1, 6, 7]) {
  try {
    l1.finalize(good, now + day * 24 * 3600);
    console.log(`  day ${day}: final ✔ (withdrawals can now be paid on L1)`);
  } catch (e) {
    console.log(`  day ${day}: ${e.message} — anyone may still prove fraud`);
  }
}
console.log();
