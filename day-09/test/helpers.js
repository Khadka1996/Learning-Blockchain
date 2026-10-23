"use strict";
// Shared helpers for the front-running tests and demo: a tiny "mempool bot".
const { ethers, network } = require("hardhat");

const GWEI = 10n ** 9n;

/** Stop mining automatically, so transactions wait in the mempool like on a real network. */
async function pauseMining() {
  await network.provider.send("evm_setAutomine", [false]);
}

async function resumeMining() {
  await network.provider.send("evm_setAutomine", [true]);
}

/** Mine one block containing everything in the mempool (Hardhat orders it by fee, like real builders). */
async function mineBlock() {
  await network.provider.send("evm_mine", []);
}

/** What a bot sees: the full transactions currently waiting to be mined. */
async function pendingTransactions() {
  const block = await network.provider.send("eth_getBlockByNumber", ["pending", true]);
  return block ? block.transactions : [];
}

/** Find the first pending call to `fnName` on `contract`, decode it, and return its arguments. */
async function spyOnMempool(contract, fnName) {
  const target = (await contract.getAddress()).toLowerCase();
  for (const tx of await pendingTransactions()) {
    if (!tx.to || tx.to.toLowerCase() !== target) continue;
    const parsed = contract.interface.parseTransaction({ data: tx.input });
    if (parsed && parsed.name === fnName) return { tx, args: parsed.args };
  }
  return null;
}

/** Fee settings for a type-2 transaction with the given tip (gwei). */
function tip(gwei) {
  return { maxPriorityFeePerGas: BigInt(gwei) * GWEI, maxFeePerGas: (BigInt(gwei) + 100n) * GWEI, gasLimit: 300_000n };
}

async function statusOf(txResponse) {
  const receipt = await ethers.provider.getTransactionReceipt(txResponse.hash);
  return { ok: receipt.status === 1, index: receipt.index, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

module.exports = { pauseMining, resumeMining, mineBlock, pendingTransactions, spyOnMempool, tip, statusOf };
