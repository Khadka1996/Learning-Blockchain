// Day 04 — Merkle trees: one 32-byte fingerprint for a whole list of transactions,
// plus short proofs that one transaction is in the list.
//
// Design (see QA.md for the attacks behind each rule):
//   leaf  = SHA-256(0x00 ‖ data)            tags stop an inner node posing as a leaf (QA A2)
//   node  = SHA-256(0x01 ‖ left ‖ right)
//   odd   = the last node moves up unchanged  (no "pair with itself": QA A1, CVE-2012-2459)
//   root  = SHA-256(0x02 ‖ count(8 bytes) ‖ top)   the root also commits to HOW MANY leaves (QA M1)
// Tags 0x00 / 0x01 follow Certificate Transparency (RFC 6962 §2.1).
"use strict";

const { createHash } = require("crypto");

const LEAF = 0x00;
const NODE = 0x01;
const ROOT = 0x02;
const MAX_LEAVES = 2 ** 20; // ~1 million leaves → at most 20 proof steps
const HEX64 = /^[0-9a-f]{64}$/;

const sha256 = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

function toBytes(data) {
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") {
    if (!data.isWellFormed()) throw new TypeError("leaf text contains broken characters (lone surrogates)"); // Day 01, F1
    return Buffer.from(data, "utf8");
  }
  throw new TypeError("a leaf must be a Buffer, Uint8Array or string");
}

const leafHash = (data) => sha256(Buffer.of(LEAF), toBytes(data));
const nodeHash = (left, right) => sha256(Buffer.of(NODE), left, right);

function countBytes(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}
const finalRoot = (count, top) => sha256(Buffer.of(ROOT), countBytes(count), top);
const EMPTY_TOP = sha256(Buffer.alloc(0)); // RFC 6962: the hash of an empty list is SHA-256("")

function checkCount(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_LEAVES) throw new RangeError(`number of leaves must be 0…${MAX_LEAVES}`);
}

/** Build every level of the tree, bottom (leaf hashes) to top (one node). */
function buildLevels(leaves) {
  if (!Array.isArray(leaves)) throw new TypeError("leaves must be an array");
  checkCount(leaves.length);
  const level0 = [];
  for (let i = 0; i < leaves.length; i++) {
    if (!Object.hasOwn(leaves, i)) throw new TypeError(`leaf ${i} is missing (sparse array)`);
    level0.push(leafHash(leaves[i]));
  }
  const levels = [level0];
  while (levels.at(-1).length > 1) {
    const cur = levels.at(-1);
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]);
    levels.push(next);
  }
  return levels;
}

/** The Merkle root (hex) of a list of leaves. */
function merkleRoot(leaves) {
  const levels = buildLevels(leaves);
  const top = levels[0].length === 0 ? EMPTY_TOP : levels.at(-1)[0];
  return finalRoot(leaves.length, top).toString("hex");
}

/**
 * Proof that leaf `index` is in the tree: the sibling hashes from bottom to top.
 * Whether each sibling sits left or right is NOT stored: the verifier works it out from
 * `index` and `leafCount`, so a proof cannot lie about the position (QA M1).
 */
function merkleProof(leaves, index) {
  const levels = buildLevels(leaves);
  const n = leaves.length;
  if (!Number.isSafeInteger(index) || index < 0 || index >= n) throw new RangeError(`index must be 0…${n - 1}`);
  const siblings = [];
  let i = index;
  for (let d = 0; d < levels.length - 1; d++) {
    const level = levels[d];
    const sib = i ^ 1;
    if (sib < level.length) siblings.push(level[sib].toString("hex")); // no sibling → node moves up unchanged
    i >>= 1;
  }
  return Object.freeze({ index, leafCount: n, siblings: Object.freeze(siblings) });
}

/**
 * Check a proof against a root. Never throws: returns true or false.
 * Rebuilds the path using only index + leafCount to decide left/right/skip, and requires
 * every sibling to be used exactly once.
 */
function verifyProof(leaf, proof, rootHex) {
  try {
    if (typeof rootHex !== "string" || !HEX64.test(rootHex)) return false;
    if (proof === null || typeof proof !== "object") return false;
    const { index, leafCount } = proof;
    const siblings = proof.siblings;
    checkCount(leafCount);
    if (!Number.isSafeInteger(index) || index < 0 || index >= leafCount) return false;
    if (!Array.isArray(siblings) || siblings.length > 64) return false;
    const sibs = [];
    for (let k = 0; k < siblings.length; k++) {
      const s = siblings[k];
      if (typeof s !== "string" || !HEX64.test(s)) return false;
      sibs.push(Buffer.from(s, "hex"));
    }
    let h = leafHash(leaf);
    let i = index;
    let width = leafCount;
    let used = 0;
    while (width > 1) {
      if (i % 2 === 1) {
        if (used >= sibs.length) return false;
        h = nodeHash(sibs[used++], h); // we are the right child
      } else if (i + 1 < width) {
        if (used >= sibs.length) return false;
        h = nodeHash(h, sibs[used++]); // we are the left child
      } // else: last node of an odd level, moves up unchanged
      i >>= 1;
      width = Math.ceil(width / 2);
    }
    if (used !== sibs.length) return false; // extra siblings = a proof for some other tree
    return finalRoot(leafCount, h).toString("hex") === rootHex;
  } catch {
    return false;
  }
}

module.exports = { merkleRoot, merkleProof, verifyProof, leafHash, nodeHash, finalRoot, MAX_LEAVES };
