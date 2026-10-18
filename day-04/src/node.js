// Day 04 — a full node: checks every block, keeps every valid branch, and follows the
// branch with the MOST WORK (Bitcoin's "longest chain" rule — longest by work, not by count).
"use strict";

const { Ledger } = require("../../day-03/src/ledger");
const { merkleRoot } = require("./merkle");
const { snapshot, readHeader, readTxs, headerBytes, leadingZeroBits, workOf, txRoot, mineBlock, ZERO_HASH } = require("./block");
const { createHash } = require("crypto");

const MAX_ORPHANS = 100; // blocks whose parent we have not seen yet (QA A4: v1 kept unlimited)
const MAX_INVALID = 10_000; // hashes of blocks that broke a permanent rule (QA E2), oldest dropped first
const MAX_FUTURE_MS = 2 * 60 * 60 * 1000; // like Bitcoin: a block may be at most 2 hours "in the future"
const BLOCK_KEYS = ["header", "txs", "hash"];

const sha256Hex = (b) => createHash("sha256").update(b).digest("hex");

/**
 * The rules every node of one network agrees on.
 * @param {{ chainId: string, bits: number, genesis: Record<string, number> }} p
 */
function makeParams({ chainId, bits, genesis }) {
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) throw new RangeError("bits must be 1…32");
  new Ledger(chainId, genesis); // validates chainId + genesis balances
  // The genesis block commits to the starting balances, so two networks with different
  // balances can never share a genesis hash.
  const alloc = Object.entries(genesis).sort(([a], [b]) => (a < b ? -1 : 1)).map(([a, v]) => `${a}:${v}`);
  const header = Object.freeze({ version: 1, chainId, height: 0, prevHash: ZERO_HASH, merkleRoot: merkleRoot(alloc), timestamp: 0, bits: 0, nonce: 0 });
  const genesisBlock = Object.freeze({ header, txs: Object.freeze([]), hash: sha256Hex(headerBytes(header)) });
  return Object.freeze({ chainId, bits, genesis: Object.freeze({ ...genesis }), genesisBlock });
}

class Node {
  #params;
  #clock;
  #blocks = new Map(); // hash → { block, height, work (total work from genesis, BigInt), parent }
  #orphans = new Map(); // hash → block, oldest first
  #invalid = new Set(); // hashes of blocks that can never become valid (QA E2)
  #tip;

  /**
   * @param {string} id     a name for logs ("A", "B", …)
   * @param {object} params from makeParams()
   * @param {{ clock?: () => number }} [opts]  current time in ms (the simulator passes its own clock)
   */
  constructor(id, params, { clock = () => Date.now() } = {}) {
    this.id = id;
    this.#params = params;
    this.#clock = clock;
    const g = params.genesisBlock;
    this.#blocks.set(g.hash, { block: g, height: 0, work: 0n, parent: null });
    this.#tip = g.hash;
    Object.freeze(this);
  }

  get tip() {
    const e = this.#blocks.get(this.#tip);
    return { hash: this.#tip, height: e.height, work: e.work };
  }

  get orphanCount() {
    return this.#orphans.size;
  }

  hasBlock(hash) {
    return this.#blocks.has(hash);
  }

  getBlock(hash) {
    return this.#blocks.get(hash)?.block ?? null;
  }

  /** Block hashes of the best chain, genesis first. */
  chain(from = this.#tip) {
    if (!this.#blocks.has(from)) throw new RangeError(`unknown block ${String(from).slice(0, 16)}`); // QA E3
    const out = [];
    for (let h = from; h !== null; h = this.#blocks.get(h).parent) out.push(h);
    return out.reverse();
  }

  /** Balances after the block `hash` (default: the tip), rebuilt from genesis with Day 03's ledger. */
  ledgerAt(hash = this.#tip) {
    const ledger = new Ledger(this.#params.chainId, this.#params.genesis);
    for (const h of this.chain(hash).slice(1)) ledger.applyAll(this.#blocks.get(h).block.txs);
    return ledger;
  }

  /**
   * Receive a block from a peer (or from our own miner).
   * Returns { status: "added" | "orphan" | "duplicate" | "rejected", … }. Never throws.
   */
  receive(input) {
    let block;
    try {
      block = this.#check(input);
    } catch (e) {
      return { status: "rejected", reason: e.message };
    }
    // Safe to remember by hash: since E1 the hash covers the header, every transaction and every
    // signature, so one hash can never stand for both a bad block and a good one.
    if (this.#invalid.has(block.hash)) return { status: "rejected", reason: "known invalid block" };
    if (this.#blocks.has(block.hash) || this.#orphans.has(block.hash)) return { status: "duplicate", hash: block.hash };
    if (this.#invalid.has(block.header.prevHash)) {
      this.#markInvalid(block.hash);
      return { status: "rejected", reason: `parent ${block.header.prevHash.slice(0, 16)} is invalid` };
    }
    if (!this.#blocks.has(block.header.prevHash)) return this.#keepOrphan(block);

    const oldTip = this.#tip;
    const added = [];
    try {
      this.#connect(block);
    } catch (e) {
      this.#markInvalid(block.hash);
      this.#dropInvalidOrphans();
      return { status: "rejected", reason: e.message };
    }
    added.push(block.hash);
    // Blocks that were waiting for this one can now be connected too.
    for (let i = 0; i < added.length; i++) {
      for (const [h, orphan] of this.#orphans) {
        if (orphan.header.prevHash !== added[i]) continue;
        this.#orphans.delete(h);
        try {
          this.#connect(orphan);
          added.push(h);
        } catch {
          this.#markInvalid(h); // an invalid orphan is dropped and remembered
        }
      }
    }
    this.#dropInvalidOrphans();
    const reorg = this.#tip !== oldTip ? this.#reorgInfo(oldTip, this.#tip) : null;
    return { status: "added", hash: block.hash, added, tipChanged: reorg !== null, reorg };
  }

  /** Mine a block with `txs` on top of our tip at time `timestamp`, add it, and return it. */
  mine(txs = [], timestamp = this.#clock()) {
    const parent = this.#blocks.get(this.#tip);
    const ts = Math.max(timestamp, parent.block.header.timestamp);
    this.ledgerAt(this.#tip).applyAll(readTxs(txs)); // refuse bad payments BEFORE spending work on them (QA L2)
    const block = mineBlock({ chainId: this.#params.chainId, height: parent.height + 1, prevHash: this.#tip, timestamp: ts, bits: this.#params.bits }, txs);
    const r = this.receive(block);
    if (r.status !== "added") throw new Error(`own block refused: ${r.reason}`);
    return block;
  }

  /** Everything that can be checked without the parent: shape, difficulty, Proof of Work, Merkle root, time. */
  #check(input) {
    const raw = snapshot(input, BLOCK_KEYS, "block");
    const header = readHeader(raw.header);
    const txs = readTxs(raw.txs);
    const hash = sha256Hex(headerBytes(header));
    if (raw.hash !== undefined && raw.hash !== hash) throw new Error("block hash does not match its header");
    const p = this.#params;
    if (header.chainId !== p.chainId) throw new Error(`block is for chain "${header.chainId}", this is "${p.chainId}"`);
    if (header.height === 0) throw new Error("only the built-in genesis block can have height 0");
    // The difficulty is a network rule, never the block's own choice (QA A3).
    if (header.bits !== p.bits) throw new Error(`difficulty must be ${p.bits} bits, block says ${header.bits}`);
    if (leadingZeroBits(hash) < p.bits) throw new Error("not enough Proof of Work");
    if (header.timestamp > this.#clock() + MAX_FUTURE_MS) throw new Error("timestamp is more than 2 hours in the future");
    // PoW first (cheap to check), Merkle root second: junk without work costs us one hash.
    if (txRoot(txs) !== header.merkleRoot) throw new Error("Merkle root does not match the transactions");
    return Object.freeze({ header, txs, hash });
  }

  #markInvalid(hash) {
    if (this.#invalid.size >= MAX_INVALID) this.#invalid.delete(this.#invalid.values().next().value);
    this.#invalid.add(hash);
  }

  /** Orphans that descend from an invalid block are invalid too (Bitcoin Core: BLOCK_FAILED_CHILD). */
  #dropInvalidOrphans() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [h, orphan] of this.#orphans) {
        if (!this.#invalid.has(orphan.header.prevHash)) continue;
        this.#orphans.delete(h);
        this.#markInvalid(h);
        changed = true;
      }
    }
  }

  #keepOrphan(block) {
    if (this.#orphans.size >= MAX_ORPHANS) this.#orphans.delete(this.#orphans.keys().next().value); // drop the oldest
    this.#orphans.set(block.hash, block);
    return { status: "orphan", hash: block.hash, missing: block.header.prevHash };
  }

  /** Rules that need the parent: height, time order and every transaction against the parent's balances. */
  #connect(block) {
    const parent = this.#blocks.get(block.header.prevHash);
    if (block.header.height !== parent.height + 1) throw new Error(`height must be ${parent.height + 1}`);
    if (block.header.timestamp < parent.block.header.timestamp) throw new Error("timestamp is earlier than the parent's");
    this.ledgerAt(block.header.prevHash).applyAll(block.txs); // throws on a bad signature, replay or overspend
    const work = parent.work + workOf(block.header.bits);
    this.#blocks.set(block.hash, { block, height: block.header.height, work, parent: block.header.prevHash });
    // Fork choice: strictly more work wins. On a tie, keep the block we saw first (like Bitcoin Core).
    if (work > this.#blocks.get(this.#tip).work) this.#tip = block.hash;
  }

  #reorgInfo(oldTip, newTip) {
    const onNew = new Set(this.chain(newTip));
    let fork = oldTip;
    while (!onNew.has(fork)) fork = this.#blocks.get(fork).parent;
    const depth = this.#blocks.get(oldTip).height - this.#blocks.get(fork).height; // blocks thrown away
    return { from: oldTip, to: newTip, forkPoint: fork, depth };
  }
}

Object.freeze(Node.prototype);

module.exports = { Node, makeParams, MAX_ORPHANS, MAX_INVALID, MAX_FUTURE_MS };
