// Day 03 — an account ledger: balances + one nonce (transaction counter) per address.
// This is the "account model" Ethereum uses. Bitcoin uses unspent outputs (UTXOs) instead; see README.
"use strict";

const { isAddress } = require("./keys");
const { verifyTransfer } = require("./transaction");

const MAX_SUPPLY = Number.MAX_SAFE_INTEGER; // all balances together never exceed this, so sums never lose precision

class Ledger {
  /**
   * @param {string} chainId  which network this ledger is (signatures for another chainId are refused)
   * @param {Record<string, number>} genesis  starting balances, e.g. { <address>: 100 }
   */
  constructor(chainId, genesis = {}) {
    if (typeof chainId !== "string" || !/^[a-z0-9-]{1,32}$/.test(chainId)) throw new TypeError("chainId must be 1–32 characters a–z, 0–9 or -");
    this.chainId = chainId;
    // Map, not a plain object: v1 used {} and an address like "__proto__" made coins vanish (audit B11).
    this.balances = new Map();
    this.nonces = new Map();
    let total = 0;
    for (const [address, amount] of Object.entries(genesis)) {
      if (!isAddress(address)) throw new TypeError(`genesis address "${address}" is not a 40-hex address`);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError("genesis amounts must be whole numbers ≥ 1");
      total += amount;
      if (!Number.isSafeInteger(total) || total > MAX_SUPPLY) throw new RangeError("total supply is too large");
      this.balances.set(address, amount);
    }
    this.totalSupply = total;
  }

  balanceOf(address) {
    return this.balances.get(address) ?? 0;
  }

  /** The nonce the NEXT transaction from this address must use (0, 1, 2, …). */
  nonceOf(address) {
    return this.nonces.get(address) ?? 0;
  }

  /** Check a transfer against the current state without changing anything. Returns { ok, reason?, id?, sender? }. */
  check(input) {
    const v = verifyTransfer(input);
    if (!v.ok) return v;
    const tx = v.tx; // the verified, frozen snapshot: never read the caller's object again (audit M1)
    if (tx.chainId !== this.chainId) return { ok: false, reason: `signed for chain "${tx.chainId}", this is "${this.chainId}" (cross-chain replay)` };
    const expected = this.nonceOf(v.sender);
    if (tx.nonce !== expected) {
      return { ok: false, reason: tx.nonce < expected ? `nonce ${tx.nonce} already used (replay)` : `nonce ${tx.nonce} is ahead of expected ${expected}` };
    }
    if (this.balanceOf(v.sender) < tx.amount) return { ok: false, reason: `insufficient balance: has ${this.balanceOf(v.sender)}, sends ${tx.amount}` };
    return v;
  }

  /** Apply one transfer, or throw with the reason. Total supply never changes. */
  apply(input) {
    const v = this.check(input);
    if (!v.ok) throw new Error(v.reason);
    this.#commit(v.sender, v.tx);
    return v.id;
  }

  /**
   * Apply a list of transfers all-or-nothing (like the transactions in one block).
   * v1 applied them one by one, so a failure halfway left the first half applied (audit B6).
   * Now the whole list is checked on a scratch copy first, then committed.
   */
  applyAll(txs) {
    if (!Array.isArray(txs)) throw new TypeError("expected an array of transactions");
    const scratch = this.#clone();
    const ids = [];
    txs.forEach((tx, i) => {
      try {
        ids.push(scratch.apply(tx));
      } catch (e) {
        throw new Error(`transaction ${i} rejected: ${e.message} (nothing was applied)`);
      }
    });
    this.balances = scratch.balances;
    this.nonces = scratch.nonces;
    return ids;
  }

  #commit(sender, tx) {
    this.balances.set(sender, this.balanceOf(sender) - tx.amount);
    this.balances.set(tx.to, this.balanceOf(tx.to) + tx.amount); // ≤ totalSupply ≤ MAX_SAFE_INTEGER: exact
    this.nonces.set(sender, this.nonceOf(sender) + 1);
  }

  #clone() {
    const copy = new Ledger(this.chainId);
    copy.balances = new Map(this.balances);
    copy.nonces = new Map(this.nonces);
    copy.totalSupply = this.totalSupply;
    return copy;
  }

  /** Sum of all balances, used by tests to prove coins are never created or destroyed. */
  sumOfBalances() {
    let s = 0;
    for (const v of this.balances.values()) s += v;
    return s;
  }
}

module.exports = { Ledger, MAX_SUPPLY };
