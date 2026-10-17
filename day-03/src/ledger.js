// Day 03 — an account ledger: balances + one nonce (transaction counter) per address.
// This is the "account model" Ethereum uses. Bitcoin uses unspent outputs (UTXOs) instead; see README.
"use strict";

const { isAddress } = require("./keys");
const { verifyTransfer } = require("./transaction");

const MAX_SUPPLY = Number.MAX_SAFE_INTEGER; // all balances together never exceed this, so sums never lose precision

const isPlainObject = (o) => o !== null && typeof o === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(o));

/**
 * All state is private (evening audit E1). v1 exposed `balances`, `nonces`, `chainId` and
 * `totalSupply` as public fields: `ledger.balances.set(mallory, 1e6)` minted coins and
 * `ledger.chainId = "lb-testnet"` switched the cross-chain replay check off. Now the only way
 * to change state is a signed, verified transaction; instances are frozen.
 */
class Ledger {
  #chainId;
  #totalSupply;
  #balances = new Map(); // Map, not a plain object: v1 used {} and "__proto__" made coins vanish (audit B11)
  #nonces = new Map();

  /**
   * @param {string} chainId  which network this ledger is (signatures for another chainId are refused)
   * @param {Record<string, number>} genesis  starting balances, a plain object, e.g. { <address>: 100 }
   */
  constructor(chainId, genesis = {}) {
    if (typeof chainId !== "string" || !/^[a-z0-9-]{1,32}$/.test(chainId)) throw new TypeError("chainId must be 1–32 characters a–z, 0–9 or -");
    // v1: a Map was silently read as "no accounts", null crashed (audit E3).
    if (!isPlainObject(genesis)) throw new TypeError("genesis must be a plain object { address: coins }");
    this.#chainId = chainId;
    let total = 0;
    for (const [address, amount] of Object.entries(genesis)) {
      if (!isAddress(address)) throw new TypeError(`genesis address "${address}" is not a 40-hex address`);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError("genesis amounts must be whole numbers ≥ 1");
      total += amount;
      if (!Number.isSafeInteger(total) || total > MAX_SUPPLY) throw new RangeError("total supply is too large");
      this.#balances.set(address, amount);
    }
    this.#totalSupply = total;
    Object.freeze(this);
  }

  get chainId() {
    return this.#chainId;
  }

  get totalSupply() {
    return this.#totalSupply;
  }

  balanceOf(address) {
    return this.#balances.get(address) ?? 0;
  }

  /** The nonce the NEXT transaction from this address must use (0, 1, 2, …). */
  nonceOf(address) {
    return this.#nonces.get(address) ?? 0;
  }

  /** A read-only copy of every account: [{ address, balance, nonce }]. Editing it changes nothing. */
  accounts() {
    const addrs = new Set([...this.#balances.keys(), ...this.#nonces.keys()]);
    return [...addrs].map((address) => ({ address, balance: this.balanceOf(address), nonce: this.nonceOf(address) }));
  }

  /** Check a transfer against the current state without changing anything. Returns { ok, reason?, id?, sender? }. */
  check(input) {
    return this.#checkOn({ balances: this.#balances, nonces: this.#nonces }, input);
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
   * The list is copied first, reading each element exactly once; holes are refused (audit E2:
   * v1 skipped them, so a "3-transaction" batch could apply 1). Then everything is checked on a
   * scratch copy and committed at once.
   */
  applyAll(txs) {
    if (!Array.isArray(txs)) throw new TypeError("expected an array of transactions");
    const length = txs.length;
    const list = [];
    for (let i = 0; i < length; i++) {
      if (!Object.hasOwn(txs, i)) throw new TypeError(`transaction ${i} is missing (sparse array; nothing was applied)`);
      list.push(txs[i]);
    }
    const scratch = this.#copyState();
    const ids = list.map((tx, i) => {
      const v = this.#checkOn(scratch, tx);
      if (!v.ok) throw new Error(`transaction ${i} rejected: ${v.reason} (nothing was applied)`);
      Ledger.#commitTo(scratch, v.sender, v.tx);
      return v.id;
    });
    this.#balances = scratch.balances;
    this.#nonces = scratch.nonces;
    return ids;
  }

  /** Verify the signature, then chain id, nonce and balance against `state` (the live maps or a scratch copy). */
  #checkOn(state, input) {
    const v = verifyTransfer(input);
    if (!v.ok) return v;
    const tx = v.tx; // the verified, frozen snapshot: never read the caller's object again (audit M1)
    if (tx.chainId !== this.#chainId) return { ok: false, reason: `signed for chain "${tx.chainId}", this is "${this.#chainId}" (cross-chain replay)` };
    const expected = state.nonces.get(v.sender) ?? 0;
    if (tx.nonce !== expected) {
      return { ok: false, reason: tx.nonce < expected ? `nonce ${tx.nonce} already used (replay)` : `nonce ${tx.nonce} is ahead of expected ${expected}` };
    }
    const balance = state.balances.get(v.sender) ?? 0;
    if (balance < tx.amount) return { ok: false, reason: `insufficient balance: has ${balance}, sends ${tx.amount}` };
    return v;
  }

  #commit(sender, tx) {
    Ledger.#commitTo({ balances: this.#balances, nonces: this.#nonces }, sender, tx);
  }

  static #commitTo({ balances, nonces }, sender, tx) {
    balances.set(sender, (balances.get(sender) ?? 0) - tx.amount);
    balances.set(tx.to, (balances.get(tx.to) ?? 0) + tx.amount); // ≤ totalSupply ≤ MAX_SAFE_INTEGER: exact
    nonces.set(sender, (nonces.get(sender) ?? 0) + 1);
  }

  #copyState() {
    return { balances: new Map(this.#balances), nonces: new Map(this.#nonces) };
  }

  /** Sum of all balances, used by tests to prove coins are never created or destroyed. */
  sumOfBalances() {
    let s = 0;
    for (const v of this.#balances.values()) s += v;
    return s;
  }
}

// Defence in depth: other code in the same process cannot swap the ledger's methods.
Object.freeze(Ledger.prototype);
Object.freeze(Ledger);

module.exports = { Ledger, MAX_SUPPLY };
