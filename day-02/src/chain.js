// Day 02 — a chain of blocks, each pointing to the previous block's hash.
"use strict";

const { hashBlock, meetsDifficulty, mineBlock, parseDifficulty, toWholeNumber, MIN_DIFFICULTY, MAX_DIFFICULTY } = require("./block");

const ZERO_HASH = "0".repeat(64);
const GENESIS_TIMESTAMP = Date.UTC(2026, 9, 16); // 16 Oct 2026 — Day 02
const GENESIS_DATA = "Day 02 genesis — Learning Blockchain";
const MAX_FUTURE_MS = 2 * 60 * 60 * 1000; // Bitcoin's rule: at most 2 hours ahead of the local clock

const genesisCache = new Map();
/** The genesis block is fixed by the rules: same difficulty → same genesis, everywhere. */
function genesisBlock(difficulty) {
  const d = parseDifficulty(difficulty);
  if (!genesisCache.has(d)) {
    const { block } = mineBlock({ index: 0, prevHash: ZERO_HASH, timestamp: GENESIS_TIMESTAMP, data: GENESIS_DATA, difficulty: d });
    genesisCache.set(d, block);
  }
  return genesisCache.get(d); // frozen block — safe to share
}

/** The local clock used for the "not more than 2 h in the future" rule (audit E6). */
function parseNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError(`now must be whole milliseconds ≥ 0, got "${now}"`);
  return now;
}

const MAX_STEP_BITS = 2; // one retarget may change difficulty by at most ×4 or ÷4 — like Bitcoin

/** Validate retarget settings: { interval: blocks per window (2–1000), targetMs: wanted ms per block }. */
function parseRetarget(retarget) {
  if (retarget === undefined || retarget === null) return null;
  const interval = toWholeNumber(retarget.interval);
  const targetMs = toWholeNumber(retarget.targetMs);
  if (!Number.isInteger(interval) || interval < 2 || interval > 1000) throw new RangeError("retarget.interval must be a whole number from 2 to 1000");
  if (!Number.isInteger(targetMs) || targetMs < 1 || targetMs > 86_400_000) throw new RangeError("retarget.targetMs must be whole milliseconds from 1 to 86,400,000");
  return { interval, targetMs };
}

/**
 * Evening improvement — difficulty adjustment (Bitcoin does this every 2016 blocks).
 * The difficulty block `height` MUST have, computed only from the blocks before it:
 *  - no retarget, or not a retarget height → same as the parent (genesis uses `base`)
 *  - at the first block of each new window (heights 1 + k·interval, k ≥ 1) → look at how long
 *    the previous window took:
 *      too fast → add bits, too slow → remove bits; ±1 bit = ×2 work; at most ±2 bits per step.
 * The genesis timestamp is fixed in the rules, so the first window starts at block 1.
 */
function expectedDifficulty(blocks, height, base, retarget) {
  if (height === 0) return base;
  const parentDifficulty = blocks[height - 1].difficulty;
  if (!retarget || height === 1 || (height - 1) % retarget.interval !== 0) return parentDifficulty;
  const first = Math.max(1, height - 1 - retarget.interval);
  const gaps = height - 1 - first;
  if (gaps < 1) return parentDifficulty;
  const actual = Math.max(1, blocks[height - 1].timestamp - blocks[first].timestamp); // ≥ 1 ms: no divide-by-zero
  const wanted = gaps * retarget.targetMs;
  const step = Math.max(-MAX_STEP_BITS, Math.min(MAX_STEP_BITS, Math.round(Math.log2(wanted / actual))));
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, parentDifficulty + step));
}

/**
 * Check one block against its parent and the chain's rules.
 * Returns null if the block is valid, or a short human-readable reason.
 */
function checkBlock(block, parent, { difficulty, now }) {
  let recomputed;
  try {
    recomputed = hashBlock(block);
  } catch (e) {
    return `malformed block: ${e.message}`;
  }
  if (block.hash !== recomputed) return "hash does not match contents (block was edited)";
  if (block.difficulty !== difficulty) return `wrong difficulty ${block.difficulty} (chain requires ${difficulty})`; // F2
  if (!meetsDifficulty(block.hash, difficulty)) return "hash does not meet the Proof-of-Work target (not mined)"; // F1
  if (parent === null) return null;
  if (block.index !== parent.index + 1) return `index ${block.index} should be ${parent.index + 1}`; // F6
  if (block.prevHash !== parent.hash) return "prevHash does not point to the previous block (chain broken)";
  if (block.timestamp < parent.timestamp) return "timestamp is earlier than the previous block"; // F6
  if (block.timestamp > now + MAX_FUTURE_MS) return "timestamp is more than 2 hours in the future"; // F6
  return null;
}

/**
 * Validate a whole list of blocks. Returns { valid: true } or
 * { valid: false, index, reason } for the FIRST bad block — that is where the chain breaks.
 */
function validateBlocks(blocks, { difficulty, retarget, now = Date.now() } = {}) {
  const d = parseDifficulty(difficulty);
  const rt = parseRetarget(retarget);
  now = parseNow(now);
  if (!Array.isArray(blocks) || blocks.length === 0) return { valid: false, index: 0, reason: "a chain needs at least the genesis block" };
  // F4: the genesis block must be OUR genesis, not any block that happens to be first.
  const g = genesisBlock(d);
  const first = blocks[0];
  if (first === null || typeof first !== "object" || first.hash !== g.hash || checkBlock(first, null, { difficulty: d, now }) !== null) {
    return { valid: false, index: 0, reason: "genesis block is not this chain's genesis" };
  }
  for (let i = 1; i < blocks.length; i++) {
    // blocks 0..i-1 are already verified, so their timestamps/difficulties can be used for block i's rule
    const reason = checkBlock(blocks[i], blocks[i - 1], { difficulty: expectedDifficulty(blocks, i, d, rt), now });
    if (reason) return { valid: false, index: i, reason };
  }
  return { valid: true };
}

class Blockchain {
  /**
   * @param {number} difficulty leading zero bits required (1–32) — for every block, or the
   *   starting value when `retarget` is set
   * @param {{interval:number,targetMs:number}} [options.retarget] adjust difficulty to hit a block time
   */
  constructor(difficulty = 16, { retarget } = {}) {
    this.difficulty = parseDifficulty(difficulty);
    this.retarget = parseRetarget(retarget);
    this.blocks = [genesisBlock(this.difficulty)];
  }

  /** Difficulty the NEXT block must be mined at. */
  get nextDifficulty() {
    return expectedDifficulty(this.blocks, this.blocks.length, this.difficulty, this.retarget);
  }

  get tip() {
    return this.blocks[this.blocks.length - 1];
  }

  /**
   * Mine a new block on top of the tip. Returns { block, attempts, ms }.
   * The block is checked with the SAME rules as validate() before it is appended, and the
   * timestamp is checked BEFORE mining, so no work is wasted on a block peers would reject (E4).
   */
  addBlock(data, timestamp = Date.now(), now = Date.now()) {
    const parent = this.tip;
    parseNow(now);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("timestamp must be whole milliseconds ≥ 0");
    if (timestamp < parent.timestamp) throw new RangeError("timestamp is earlier than the previous block");
    if (timestamp > now + MAX_FUTURE_MS) throw new RangeError("timestamp is more than 2 hours in the future");
    const difficulty = this.nextDifficulty;
    const start = process.hrtime.bigint();
    const { block, attempts } = mineBlock({ index: parent.index + 1, prevHash: parent.hash, timestamp, data, difficulty });
    const reason = checkBlock(block, parent, { difficulty, now });
    if (reason) throw new Error(`refusing to add an invalid block: ${reason}`);
    this.blocks.push(block);
    return { block, attempts, ms: Number(process.hrtime.bigint() - start) / 1e6 };
  }

  validate(now) {
    return validateBlocks(this.blocks, { difficulty: this.difficulty, retarget: this.retarget, now });
  }

  isValid(now) {
    return this.validate(now).valid;
  }
}

module.exports = {
  ZERO_HASH,
  GENESIS_TIMESTAMP,
  GENESIS_DATA,
  MAX_FUTURE_MS,
  MAX_STEP_BITS,
  genesisBlock,
  parseRetarget,
  parseNow,
  expectedDifficulty,
  checkBlock,
  validateBlocks,
  Blockchain,
};
