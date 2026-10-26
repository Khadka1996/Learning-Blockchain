"use strict";
/* Exercise 2 (medium): from which batch size is a rollup cheaper than a plain L1 transfer? */
const R = require("../../src/rollup");

/** Closed-form estimate: fixed overhead is shared; each tx adds ~TX_BYTES of calldata. */
function estimateBreakEven(avgGasPerTx) {
  // overhead/n + perTx < 21,000  →  n > overhead / (21,000 - perTx)
  return Math.floor(R.BATCH_OVERHEAD_GAS / (R.L1_TRANSFER_GAS - avgGasPerTx)) + 1;
}

/** Measured average calldata gas per tx on a big sample (so the overhead is negligible). */
function avgGasPerTx() {
  const c = R.batchCost(R.randomTxs(2000, 50));
  return (c.totalGas - R.BATCH_OVERHEAD_GAS) / c.txs;
}

module.exports = { estimateBreakEven, avgGasPerTx };

if (require.main === module) {
  const per = avgGasPerTx();
  console.log(`average calldata gas per transaction: ${per.toFixed(1)}`);
  console.log(`estimated break-even batch size:      ${estimateBreakEven(per)}`);
  console.log(`measured  break-even batch size:      ${R.breakEvenBatchSize()}`);
  for (const n of [1, 2, 3, 4, 5]) console.log(`  batch of ${n}: ${R.batchCost(R.randomTxs(n, 50)).gasPerTx.toFixed(0)} gas/tx`);
}
