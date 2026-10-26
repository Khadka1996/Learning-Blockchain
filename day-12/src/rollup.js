"use strict";
/**
 * A tiny OPTIMISTIC ROLLUP, simulated in plain JavaScript.
 *
 *   L2 (the rollup)  : a sequencer collects many transfers and executes them off-chain.
 *   L1 (Ethereum)    : stores only the batch data + the claimed state root ("the result").
 *
 * "Optimistic" = L1 believes the claimed result by default, but for a CHALLENGE WINDOW
 * (7 days on Optimism/Arbitrum) anyone can prove it wrong with a FRAUD PROOF. Because all
 * transaction data is on L1, anyone can re-execute it and check.
 *
 * The fraud proof here is the real idea, simplified: an interactive BISECTION game.
 * Challenger and sequencer disagree on the final state; they compare the state after the
 * middle transaction, keep the half where they disagree, and repeat until one single
 * transaction is left. L1 then re-executes ONLY that one transaction itself — cheap — and
 * sees who lied. 1,000 transactions need only 10 rounds (log2).
 *
 * Simplifications (stated, not hidden): signatures are placeholder bytes (Day 03 covers real
 * ones), the L1 gas model counts calldata only (pre-EIP-4844, no blobs, no compression), and
 * L1 "verifies" the one-step pre-state by recomputing its root from the full account list
 * (a real rollup uses a Merkle proof of just the touched accounts — Day 04).
 */
const crypto = require("node:crypto");

const CHALLENGE_WINDOW = 7 * 24 * 60 * 60; // seconds
const L1_TRANSFER_GAS = 21_000; // a plain ETH transfer on L1
const BATCH_OVERHEAD_GAS = 21_000 + 20_000 + 5_000; // tx base + store batch root + event/bookkeeping
const TX_BYTES = 4 + 4 + 8 + 65; // from index, to index, amount (uint64), signature

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest();

/* ------------------------------ state & execution ------------------------------ */

/** State root = Merkle root over leaves sha256(index ‖ balance). Same state → same root. */
function stateRoot(balances) {
  let level = balances.map((b, i) => {
    const leaf = Buffer.alloc(12);
    leaf.writeUInt32BE(i, 0);
    leaf.writeBigUInt64BE(BigInt(b), 4);
    return sha256(leaf);
  });
  if (level.length === 0) return sha256(Buffer.alloc(0)).toString("hex");
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1] ?? level[i]; // odd count: pair the last node with itself
      next.push(sha256(Buffer.concat([level[i], right])));
    }
    level = next;
  }
  return level[0].toString("hex");
}

function validTxShape(tx, n) {
  return (
    Number.isInteger(tx.from) && Number.isInteger(tx.to) && Number.isSafeInteger(tx.amount) &&
    tx.from >= 0 && tx.from < n && tx.to >= 0 && tx.to < n && tx.amount > 0
  );
}

/**
 * The rollup's state-transition rule. Deterministic, and it never throws: a transfer that
 * is malformed or larger than the sender's balance is a NO-OP (the state stays the same).
 * Everyone running this function on the same input gets the same output — the whole
 * security of a rollup rests on that.
 */
function applyTx(balances, tx) {
  if (!validTxShape(tx, balances.length) || balances[tx.from] < tx.amount || tx.from === tx.to) {
    return balances.slice();
  }
  if (!Number.isSafeInteger(balances[tx.to] + tx.amount)) return balances.slice(); // would lose precision
  const next = balances.slice();
  next[tx.from] -= tx.amount;
  next[tx.to] += tx.amount;
  return next;
}

/** Runs a batch honestly; returns the root after every transaction (roots[0] = before). */
function executeBatch(balances, txs) {
  const roots = [stateRoot(balances)];
  const states = [balances.slice()];
  let s = balances.slice();
  for (const tx of txs) {
    s = applyTx(s, tx);
    states.push(s);
    roots.push(stateRoot(s));
  }
  return { post: s, roots, states };
}

/* ------------------------------ L1 cost model ------------------------------ */

function encodeTx(tx) {
  const b = Buffer.alloc(TX_BYTES);
  b.writeUInt32BE(tx.from, 0);
  b.writeUInt32BE(tx.to, 4);
  b.writeBigUInt64BE(BigInt(tx.amount), 8);
  // placeholder 65-byte signature: deterministic, random-looking (real sigs are ~all non-zero)
  const fake = Buffer.concat([sha256(b.subarray(0, 16)), sha256(b.subarray(0, 15)), Buffer.from([27])]);
  fake.copy(b, 16);
  return b;
}

/** EIP-2028 calldata price: 4 gas per zero byte, 16 per non-zero byte. */
function calldataGas(buf) {
  let gas = 0;
  for (const byte of buf) gas += byte === 0 ? 4 : 16;
  return gas;
}

/** L1 gas to post one batch, and the share each transaction pays. */
function batchCost(txs) {
  const data = Buffer.concat(txs.map(encodeTx));
  const total = BATCH_OVERHEAD_GAS + calldataGas(data);
  return { txs: txs.length, bytes: data.length, totalGas: total, gasPerTx: total / txs.length };
}

/* ------------------------------ the L1 rollup contract (simulated) ------------------------------ */

class RollupL1 {
  constructor(genesisBalances) {
    const total = genesisBalances.reduce((a, b) => a + b, 0);
    if (!genesisBalances.every((b) => Number.isSafeInteger(b) && b >= 0) || !Number.isSafeInteger(total)) {
      throw new Error("BadGenesis"); // every balance (and their sum) must stay exact in JS numbers
    }
    this.n = genesisBalances.length;
    this.batches = []; // { txs, preRoot, claimedPostRoot, sequencer, postedAt, status }
    this.finalizedRoot = stateRoot(genesisBalances);
    this.bonds = new Map();
  }

  /** The sequencer must lock a bond: it is what a fraud costs them. */
  depositBond(sequencer, amount) {
    this.bonds.set(sequencer, (this.bonds.get(sequencer) ?? 0) + amount);
  }

  postBatch({ sequencer, txs, claimedPostRoot, now }) {
    if (!(this.bonds.get(sequencer) > 0)) throw new Error("NoBond");
    const prev = this._lastLive(this.batches.length);
    const preRoot = prev ? prev.claimedPostRoot : this.finalizedRoot; // reverted batches are skipped
    this.batches.push({ txs, preRoot, claimedPostRoot, sequencer, postedAt: now, status: "pending" });
    return this.batches.length - 1;
  }

  /** After the window with no successful challenge, the result is final (withdrawals can pay out). */
  finalize(id, now) {
    const b = this.batches[id];
    if (!b || b.status !== "pending") throw new Error("NotPending");
    const prev = this._lastLive(id);
    if (prev && prev.status !== "final") throw new Error("PreviousNotFinal");
    if (now < b.postedAt + CHALLENGE_WINDOW) throw new Error("ChallengeWindowOpen");
    b.status = "final";
    this.finalizedRoot = b.claimedPostRoot;
  }

  /**
   * Fraud proof by bisection.
   * @param asserterRootAt (i) => the root the SEQUENCER claims after tx i (it must answer)
   * @param challenger     { rootAt(i), stateAt(i) } from honest re-execution
   * @returns { fraud, index, rounds } — index = the single transaction proven wrong
   */
  challenge(id, now, asserterRootAt, challenger, challengerAddr) {
    const b = this.batches[id];
    if (!b || b.status !== "pending") throw new Error("NotPending");
    if (now >= b.postedAt + CHALLENGE_WINDOW) throw new Error("ChallengeWindowClosed");
    const n = b.txs.length;
    if (challenger.rootAt(0) !== b.preRoot) throw new Error("WrongPreState");
    if (challenger.rootAt(n) === b.claimedPostRoot) return { fraud: false, rounds: 0 };
    if (n === 0) return this._slash(id, challengerAddr, { fraud: true, index: -1, rounds: 0 }); // empty batch changed the state

    // Invariant: both agree at lo, disagree at hi.
    let lo = 0;
    let hi = n;
    let rounds = 0;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      rounds++;
      if (asserterRootAt(mid) === challenger.rootAt(mid)) lo = mid;
      else hi = mid;
    }

    // One-step proof: L1 itself executes tx #lo from the agreed state.
    const pre = challenger.stateAt(lo);
    if (stateRoot(pre) !== (lo === 0 ? b.preRoot : asserterRootAt(lo))) throw new Error("BadOneStepPreState");
    const correct = stateRoot(applyTx(pre, b.txs[lo]));
    const claimed = hi === n ? b.claimedPostRoot : asserterRootAt(hi);
    if (correct === claimed) return { fraud: false, rounds }; // the sequencer was right after all

    return this._slash(id, challengerAddr, { fraud: true, index: lo, rounds });
  }

  /** Latest batch before index `end` that was not reverted (or undefined). */
  _lastLive(end) {
    for (let j = end - 1; j >= 0; j--) if (this.batches[j].status !== "reverted") return this.batches[j];
    return undefined;
  }

  /** Fraud proven: revert this batch and every later one (they built on a lie), slash the bond. */
  _slash(id, challengerAddr, result) {
    const b = this.batches[id];
    for (let j = id; j < this.batches.length; j++) this.batches[j].status = "reverted";
    const bond = this.bonds.get(b.sequencer) ?? 0;
    this.bonds.set(b.sequencer, 0);
    const reward = Math.floor(bond / 2); // the rest is burned, so a sequencer cannot challenge itself for profit
    this.bonds.set(challengerAddr, (this.bonds.get(challengerAddr) ?? 0) + reward);
    return { ...result, reward };
  }
}

/* ------------------------------ helpers for the demo / tests ------------------------------ */

/** Small deterministic PRNG so the demo prints the same numbers every run. */
function prng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 2 ** 32;
  };
}

function randomTxs(count, accounts, seed = 12) {
  const r = prng(seed);
  return Array.from({ length: count }, () => ({
    from: Math.floor(r() * accounts),
    to: Math.floor(r() * accounts),
    amount: 1 + Math.floor(r() * 50),
  }));
}

/** A dishonest sequencer: honest until tx #k, then it secretly credits itself `stolen` coins. */
function cheatingRoots(genesis, txs, k, thief, stolen) {
  const roots = [stateRoot(genesis)];
  let s = genesis.slice();
  txs.forEach((tx, i) => {
    s = applyTx(s, tx);
    if (i === k) s[thief] += stolen;
    roots.push(stateRoot(s));
  });
  return roots;
}

module.exports = {
  CHALLENGE_WINDOW,
  L1_TRANSFER_GAS,
  BATCH_OVERHEAD_GAS,
  TX_BYTES,
  stateRoot,
  applyTx,
  executeBatch,
  encodeTx,
  calldataGas,
  batchCost,
  RollupL1,
  randomTxs,
  cheatingRoots,
};
