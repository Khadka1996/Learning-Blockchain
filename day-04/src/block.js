// Day 04 — a block = a small header + Day 03's signed transactions.
// The header holds the Merkle root, so the 32-byte block hash commits to every transaction.
"use strict";

const { createHash } = require("crypto");
const { merkleRoot } = require("./merkle");
const { txId, snapshot: snapshotTx } = require("../../day-03/src/transaction"); // Day 03: signed transfers

const HEADER_VERSION = 1;
const DOMAIN = "learning-blockchain/header";
const HEADER_KEYS = ["version", "chainId", "height", "prevHash", "merkleRoot", "timestamp", "bits", "nonce"];
const MAX_TXS = 1000; // a block-size limit, like Bitcoin's (stops one block eating all memory)
const MAX_NONCE = 2 ** 32; // Bitcoin's nonce is 32 bits too
const HEX64 = /^[0-9a-f]{64}$/;
const ZERO_HASH = "0".repeat(64);

const sha256Hex = (b) => createHash("sha256").update(b).digest("hex");
const isWhole = (n) => Number.isSafeInteger(n) && n >= 0;

/** Copy an untrusted object's own fields ONCE (no getters re-read later: Day 03, M1). */
function snapshot(obj, keys, what) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new TypeError(`${what} must be an object`);
  const copy = {};
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) throw new TypeError(`${what} has unexpected field "${k}"`);
    copy[k] = obj[k];
  }
  return Object.freeze(copy);
}

/** Check the header's shape. Consensus rules (difficulty, parent, time) are checked by the node. */
function readHeader(input) {
  const h = snapshot(input, HEADER_KEYS, "header");
  if (h.version !== HEADER_VERSION) throw new TypeError(`header version must be ${HEADER_VERSION}`);
  if (typeof h.chainId !== "string" || !/^[a-z0-9-]{1,32}$/.test(h.chainId)) throw new TypeError("bad chainId");
  if (!isWhole(h.height)) throw new TypeError("height must be a whole number");
  if (typeof h.prevHash !== "string" || !HEX64.test(h.prevHash)) throw new TypeError("prevHash must be 64 lowercase hex");
  if (typeof h.merkleRoot !== "string" || !HEX64.test(h.merkleRoot)) throw new TypeError("merkleRoot must be 64 lowercase hex");
  if (!isWhole(h.timestamp)) throw new TypeError("timestamp must be whole milliseconds");
  if (!Number.isInteger(h.bits) || h.bits < 0 || h.bits > 64) throw new TypeError("bits must be 0…64");
  if (!isWhole(h.nonce) || h.nonce >= MAX_NONCE) throw new TypeError("nonce must be 0…2^32−1");
  return h;
}

/** The exact bytes that get hashed: fixed order, fixed types, a domain tag and the chain id. */
function headerBytes(h) {
  return Buffer.from(JSON.stringify([DOMAIN, h.version, h.chainId, h.height, h.prevHash, h.merkleRoot, h.timestamp, h.bits, h.nonce]), "utf8");
}

const blockHash = (header) => sha256Hex(headerBytes(readHeader(header)));

/** Number of leading zero bits of a hex hash. */
function leadingZeroBits(hex) {
  let bits = 0;
  for (const c of hex) {
    const v = parseInt(c, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    return bits + Math.clz32(v) - 28;
  }
  return bits;
}

/** Expected guesses to find a block with `bits` zero bits = 2^bits. This is the block's "work". */
const workOf = (bits) => 2n ** BigInt(bits);

/** Merkle root of a block's transactions: the leaves are the Day 03 transaction ids. */
function txRoot(txs) {
  return merkleRoot(txs.map((tx) => Buffer.from(txId(tx), "hex")));
}

/**
 * Read a block's transaction list exactly once into a frozen, dense copy, and freeze a plain
 * copy of every transaction too. v2 kept the peer's objects: a payment whose `amount` getter
 * said 1 while the block was checked and 100 afterwards made every later replay of the chain
 * fail, so the node could never accept another block (QA M2).
 */
function readTxs(txs) {
  if (!Array.isArray(txs)) throw new TypeError("txs must be an array");
  const n = txs.length;
  if (n > MAX_TXS) throw new RangeError(`a block holds at most ${MAX_TXS} transactions`);
  const list = [];
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(txs, i)) throw new TypeError(`transaction ${i} is missing (sparse array)`);
    list.push(snapshotTx(txs[i]));
  }
  return Object.freeze(list);
}

/**
 * Proof of Work: try nonces until the hash has `header.bits` leading zero bits (Day 02).
 * Returns a frozen block { header, txs, hash }.
 */
function mineBlock({ chainId, height, prevHash, timestamp, bits }, txs) {
  const list = readTxs(txs);
  const base = { version: HEADER_VERSION, chainId, height, prevHash, merkleRoot: txRoot(list), timestamp, bits, nonce: 0 };
  readHeader(base);
  for (let nonce = 0; nonce < MAX_NONCE; nonce++) {
    const header = { ...base, nonce };
    const hash = sha256Hex(headerBytes(header));
    if (leadingZeroBits(hash) >= bits) return Object.freeze({ header: Object.freeze(header), txs: list, hash });
  }
  throw new Error("no nonce found: change the timestamp and try again");
}

module.exports = {
  HEADER_VERSION, HEADER_KEYS, MAX_TXS, ZERO_HASH,
  snapshot, readHeader, readTxs, headerBytes, blockHash, leadingZeroBits, workOf, txRoot, mineBlock,
};
