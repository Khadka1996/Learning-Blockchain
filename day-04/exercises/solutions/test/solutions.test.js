"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { merkleRoot } = require("../../../src/merkle");
const { proofLength, run: runEasy } = require("../proof-length");
const { findDifferences, run: runMedium } = require("../find-diff");
const { multiProof, verifyMultiProof, run: runChallenge } = require("../multiproof");

test("easy: proofLength matches merkleProof for every size 1…64", () => {
  const r = runEasy({ quiet: true });
  assert.equal(r.checked, 2080);
  assert.deepEqual(r.five, [3, 3, 3, 3, 1]);
  assert.throws(() => proofLength(0, 0), RangeError);
  assert.throws(() => proofLength(5, 5), RangeError);
});

test("medium: findDifferences finds exactly the changed leaves, cheaply", () => {
  const rows = runMedium({ quiet: true });
  for (const r of rows) assert.deepEqual(r.indexes, r.changed);
  assert.equal(rows[1].compared, 21);
  assert.throws(() => findDifferences(["a"], ["a", "b"]), RangeError);
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 80 }), fc.array(fc.nat(79)), (n, picks) => {
      const a = Array.from({ length: n }, (_, i) => `t${i}`);
      const b = a.slice();
      const changed = [...new Set(picks.filter((i) => i < n))].sort((x, y) => x - y);
      for (const i of changed) b[i] += "!";
      assert.deepEqual(findDifferences(a, b).indexes, changed);
    }),
    { numRuns: 200, seed: 4 },
  );
});

test("challenge: a multiproof is smaller than separate proofs and verifies", () => {
  const r = runChallenge({ quiet: true });
  assert.deepEqual([r.separate, r.multi, r.ok, r.lie], [78, 27, true, false]);
});

test("challenge: random trees and subsets verify; any tampering fails; never throws", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 70 }), fc.array(fc.nat(69), { minLength: 1, maxLength: 10 }), fc.nat(), (n, raw, seed) => {
      const leaves = Array.from({ length: n }, (_, i) => `t${i}`);
      const idx = [...new Set(raw.map((i) => i % n))];
      const root = merkleRoot(leaves);
      const items = idx.map((i) => ({ index: i, leaf: leaves[i] }));
      const proof = multiProof(leaves, idx);
      assert.equal(verifyMultiProof(items, proof, root), true);
      // wrong leaf
      const k = seed % items.length;
      assert.equal(verifyMultiProof(items.map((it, j) => (j === k ? { ...it, leaf: it.leaf + "x" } : it)), proof, root), false);
      // extra / missing hash
      assert.equal(verifyMultiProof(items, { ...proof, hashes: [...proof.hashes, "ab".repeat(32)] }, root), false);
      if (proof.hashes.length) assert.equal(verifyMultiProof(items, { ...proof, hashes: proof.hashes.slice(1) }, root), false);
      // duplicate index, wrong count, junk
      assert.equal(verifyMultiProof([...items, items[0]], proof, root), false);
      assert.equal(verifyMultiProof(items, { ...proof, leafCount: n + 1 }, root), false);
      assert.equal(verifyMultiProof(null, proof, root), false);
      assert.equal(verifyMultiProof(items, null, root), false);
    }),
    { numRuns: 300, seed: 4 },
  );
});
