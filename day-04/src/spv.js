// Day 04 (evening) — a light client (SPV, Bitcoin whitepaper §8).
// It keeps ONLY block headers, follows the header chain with the most work, and checks
// "is my payment in block X, and how deep?" with a Merkle proof from a full node.
// It never sees other people's payments and never replays balances.
"use strict";

const { readHeader, headerBytes, leadingZeroBits, workOf, txLeaf, readTxs } = require("./block");
const { merkleProof, verifyProof } = require("./merkle");
const { verifyTransfer } = require("../../day-03/src/transaction");
const { MAX_FUTURE_MS } = require("./node");
const { createHash } = require("crypto");

const sha256Hex = (b) => createHash("sha256").update(b).digest("hex");

/** Full-node side: the Merkle proof for transaction `index` of a block. */
function proveTx(block, index) {
  return merkleProof(readTxs(block.txs).map(txLeaf), index);
}

class LightClient {
  #params;
  #clock;
  #headers = new Map(); // hash → { header, height, work, parent }
  #tip;

  constructor(params, { clock = () => Date.now() } = {}) {
    this.#params = params;
    this.#clock = clock;
    const g = params.genesisBlock;
    this.#headers.set(g.hash, { header: g.header, height: 0, work: 0n, parent: null });
    this.#tip = g.hash;
    Object.freeze(this);
  }

  get tip() {
    const e = this.#headers.get(this.#tip);
    return { hash: this.#tip, height: e.height, work: e.work };
  }

  get headerCount() {
    return this.#headers.size;
  }

  /** Bytes of header data stored (the same encoding that is hashed). */
  get storedBytes() {
    let n = 0;
    for (const { header } of this.#headers.values()) n += headerBytes(header).length;
    return n;
  }

  /**
   * Add one header. Checks everything a header alone can prove: shape, chain, the network's
   * difficulty, real Proof of Work, parent link, height and time. Never throws.
   */
  addHeader(input) {
    try {
      const header = readHeader(input);
      const hash = sha256Hex(headerBytes(header));
      const p = this.#params;
      if (this.#headers.has(hash)) return { status: "duplicate", hash };
      if (header.chainId !== p.chainId) throw new Error(`header is for chain "${header.chainId}"`);
      if (header.bits !== p.bits) throw new Error(`difficulty must be ${p.bits} bits`);
      if (leadingZeroBits(hash) < p.bits) throw new Error("not enough Proof of Work");
      const parent = this.#headers.get(header.prevHash);
      if (!parent) throw new Error("unknown parent: sync headers in order");
      if (header.height !== parent.height + 1) throw new Error(`height must be ${parent.height + 1}`);
      if (header.timestamp < parent.header.timestamp) throw new Error("timestamp is earlier than the parent's");
      if (header.timestamp > this.#clock() + MAX_FUTURE_MS) throw new Error("timestamp is more than 2 hours in the future");
      const work = parent.work + workOf(header.bits);
      this.#headers.set(hash, { header, height: header.height, work, parent: header.prevHash });
      if (work > this.#headers.get(this.#tip).work) this.#tip = hash; // most work wins, ties keep the first
      return { status: "added", hash };
    } catch (e) {
      return { status: "rejected", reason: e.message };
    }
  }

  #onBestChain(hash) {
    const target = this.#headers.get(hash);
    if (!target) return false;
    let h = this.#tip;
    while (h !== null && this.#headers.get(h).height > target.height) h = this.#headers.get(h).parent;
    return h === hash;
  }

  /**
   * Is `tx` in block `blockHash`, and is that block on the best chain?
   * Returns { ok: true, confirmations } or { ok: false, reason }. Never throws.
   * Confirmations = blocks from that block up to the tip, counting the block itself.
   */
  verifyPayment(tx, proof, blockHash) {
    try {
      const v = verifyTransfer(tx);
      if (!v.ok) return { ok: false, reason: `not a valid signed payment: ${v.reason}` };
      const entry = this.#headers.get(blockHash);
      if (!entry) return { ok: false, reason: "unknown block" };
      if (!this.#onBestChain(blockHash)) return { ok: false, reason: "block is not on the best chain (stale branch)" };
      if (!verifyProof(txLeaf(v.tx), proof, entry.header.merkleRoot)) return { ok: false, reason: "Merkle proof does not match the block" };
      return { ok: true, confirmations: this.tip.height - entry.height + 1 };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
}

Object.freeze(LightClient.prototype);

module.exports = { LightClient, proveTx };
