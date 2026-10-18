// Day 04 — Exercise 3 (challenge): one Merkle proof for several leaves.
"use strict";

const { leafHash, nodeHash, finalRoot, merkleRoot, merkleProof, MAX_LEAVES } = require("../../src/merkle");

const HEX64 = /^[0-9a-f]{64}$/;

function levels(leaves) {
  const out = [leaves.map(leafHash)];
  while (out.at(-1).length > 1) {
    const cur = out.at(-1);
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

function checkIndexes(indexes, n) {
  if (!Array.isArray(indexes) || indexes.length === 0) throw new RangeError("give at least one index");
  const sorted = [...indexes].sort((x, y) => x - y);
  sorted.forEach((i, k) => {
    if (!Number.isSafeInteger(i) || i < 0 || i >= n) throw new RangeError(`index ${i} out of range`);
    if (k > 0 && sorted[k - 1] === i) throw new RangeError(`index ${i} given twice`);
  });
  return sorted;
}

/** Proof = the hashes the verifier cannot compute itself, level by level, left to right. */
function multiProof(leaves, indexes) {
  const L = levels(leaves);
  let known = checkIndexes(indexes, leaves.length);
  const hashes = [];
  for (let d = 0; d < L.length - 1; d++) {
    const width = L[d].length;
    const set = new Set(known);
    for (const i of known) {
      const sib = i ^ 1;
      if (sib < width && !set.has(sib)) hashes.push(L[d][sib].toString("hex"));
    }
    known = [...new Set(known.map((i) => i >> 1))];
  }
  return Object.freeze({ leafCount: leaves.length, hashes: Object.freeze(hashes) });
}

/** items = [{ index, leaf }]. Returns true/false, never throws. */
function verifyMultiProof(items, proof, rootHex) {
  try {
    if (typeof rootHex !== "string" || !HEX64.test(rootHex)) return false;
    const n = proof.leafCount;
    if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LEAVES) return false;
    const hashes = proof.hashes;
    if (!Array.isArray(hashes) || hashes.length > 64 * items.length) return false;
    const sibs = hashes.map((h) => {
      if (typeof h !== "string" || !HEX64.test(h)) throw new Error("bad hash");
      return Buffer.from(h, "hex");
    });
    const idx = checkIndexes(items.map((it) => it.index), n);
    let level = new Map(items.map((it) => [it.index, leafHash(it.leaf)]));
    level = new Map(idx.map((i) => [i, level.get(i)]));
    let used = 0;
    let width = n;
    while (width > 1) {
      const next = new Map();
      for (const [i, h] of level) {
        const parent = i >> 1;
        if (next.has(parent)) continue; // already combined with its sibling
        const sib = i ^ 1;
        let up;
        if (sib >= width) up = h; // last node of an odd level moves up unchanged
        else {
          let other = level.get(sib);
          if (other === undefined) {
            if (used >= sibs.length) return false;
            other = sibs[used++];
          }
          up = i % 2 === 0 ? nodeHash(h, other) : nodeHash(other, h);
        }
        next.set(parent, up);
      }
      level = next;
      width = Math.ceil(width / 2);
    }
    if (used !== sibs.length) return false; // every hash used exactly once
    return finalRoot(n, level.get(0)).toString("hex") === rootHex;
  } catch {
    return false;
  }
}

function run({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const leaves = Array.from({ length: 1000 }, (_, i) => `payment ${i}`);
  const root = merkleRoot(leaves);
  const picks = [3, 4, 5, 6, 100, 101, 737, 999];
  const proof = multiProof(leaves, picks);
  const separate = picks.reduce((s, i) => s + merkleProof(leaves, i).siblings.length, 0);
  const ok = verifyMultiProof(picks.map((i) => ({ index: i, leaf: leaves[i] })), proof, root);
  log(`Prove ${picks.length} of 1,000 payments: [${picks.join(", ")}]`);
  log(`  ${picks.length} separate proofs: ${separate} hashes (${separate * 32} bytes)`);
  log(`  one multiproof:     ${proof.hashes.length} hashes (${proof.hashes.length * 32} bytes)`);
  log(`  verify → ${ok}`);
  const lie = verifyMultiProof(picks.map((i) => ({ index: i, leaf: i === 737 ? "payment 7370" : leaves[i] })), proof, root);
  log(`  one leaf changed → ${lie}`);
  return { separate, multi: proof.hashes.length, ok, lie };
}

if (require.main === module) run();
module.exports = { multiProof, verifyMultiProof, run };
