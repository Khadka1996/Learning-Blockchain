"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("crypto");
const fc = require("fast-check");
const { merkleRoot, merkleProof, verifyProof, leafHash, nodeHash } = require("../src/merkle");

const H = (...p) => { const h = createHash("sha256"); p.forEach((x) => h.update(x)); return h.digest(); };
const count8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const root = (n, top) => H(Buffer.of(2), count8(n), top).toString("hex");
const leaves = (n) => Array.from({ length: n }, (_, i) => `tx-${i}`);

test("known answers: empty, one leaf, three leaves (odd node moves up)", () => {
  assert.equal(merkleRoot([]), root(0, H(Buffer.alloc(0))));
  assert.equal(merkleRoot(["a"]), root(1, H(Buffer.of(0), Buffer.from("a"))));
  const [a, b, c] = ["a", "b", "c"].map((x) => H(Buffer.of(0), Buffer.from(x)));
  const ab = H(Buffer.of(1), a, b);
  assert.equal(merkleRoot(["a", "b", "c"]), root(3, H(Buffer.of(1), ab, c)));
  assert.deepEqual(leafHash("a"), a);
  assert.deepEqual(nodeHash(a, b), ab);
});

test("every proof verifies, for every size 1…70 and every position", () => {
  for (let n = 1; n <= 70; n++) {
    const L = leaves(n);
    const r = merkleRoot(L);
    for (let i = 0; i < n; i++) {
      const p = merkleProof(L, i);
      assert.ok(p.siblings.length <= Math.ceil(Math.log2(n)), `size ${n}`);
      assert.equal(verifyProof(L[i], p, r), true, `n=${n} i=${i}`);
    }
  }
});

test("property: any change to leaf, position, size or path makes the proof fail", () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 300 }), fc.nat(), fc.nat(), (n, a, b) => {
      const L = leaves(n);
      const r = merkleRoot(L);
      const i = a % n;
      const p = merkleProof(L, i);
      assert.equal(verifyProof(L[i] + "x", p, r), false);
      assert.equal(verifyProof(L[i], { ...p, index: (i + 1 + (b % (n - 1))) % n }, r), false);
      assert.equal(verifyProof(L[i], { ...p, leafCount: n + 1 }, r), false);
      if (p.siblings.length) {
        const s = [...p.siblings];
        const k = b % s.length;
        s[k] = (s[k][0] === "0" ? "1" : "0") + s[k].slice(1);
        assert.equal(verifyProof(L[i], { ...p, siblings: s }, r), false);
        assert.equal(verifyProof(L[i], { ...p, siblings: p.siblings.slice(1) }, r), false);
      }
      assert.equal(verifyProof(L[i], { ...p, siblings: [...p.siblings, "0".repeat(64)] }, r), false);
    }),
    { numRuns: 300 },
  );
});

test("A1: [a,b,c] and [a,b,c,c] have different roots (no duplicate-last trick, CVE-2012-2459)", () => {
  assert.notEqual(merkleRoot(["a", "b", "c"]), merkleRoot(["a", "b", "c", "c"]));
  assert.notEqual(merkleRoot(["a", "b"]), merkleRoot(["a", "b", "b"]));
});

test("A2: an inner node's 64 bytes cannot be proven as a leaf (second preimage)", () => {
  const L = leaves(4);
  const r = merkleRoot(L);
  const [h0, h1, h2, h3] = L.map(leafHash);
  const fake = Buffer.concat([h0, h1]);
  const tryProof = { index: 0, leafCount: 2, siblings: [nodeHash(h2, h3).toString("hex")] };
  assert.equal(verifyProof(fake, tryProof, r), false);
  assert.equal(verifyProof(fake, { index: 0, leafCount: 4, siblings: [nodeHash(h2, h3).toString("hex")] }, r), false);
});

test("M1: a proof cannot lie about the number of leaves or the position", () => {
  // In a 3-leaf tree, leaf 2 has one sibling: hash(leaf0, leaf1). Without the count in the root,
  // the same path also "proves" leaf 2 is position 1 of a 2-leaf tree.
  const L = ["a", "b", "c"];
  const r = merkleRoot(L);
  const p = merkleProof(L, 2);
  assert.equal(verifyProof("c", p, r), true);
  assert.equal(verifyProof("c", { index: 1, leafCount: 2, siblings: p.siblings }, r), false);
});

test("verifyProof never throws on garbage, and bad inputs to the builder are refused", () => {
  const r = merkleRoot(leaves(5));
  fc.assert(fc.property(fc.anything(), fc.anything(), fc.anything(), (a, b, c) => {
    assert.equal(typeof verifyProof(a, b, c), "boolean");
    assert.equal(verifyProof("tx-0", b, r), false);
  }), { numRuns: 500 });
  assert.equal(verifyProof("tx-0", { index: 0, leafCount: 2 ** 21, siblings: [] }, r), false);
  assert.throws(() => merkleRoot([, "b"]), /sparse/); // eslint-disable-line no-sparse-arrays
  assert.throws(() => merkleRoot(["\ud800"]), /broken characters/);
  assert.throws(() => merkleRoot([42]), /Buffer/);
  assert.throws(() => merkleRoot("abc"), /array/);
  assert.throws(() => merkleProof(leaves(3), 3), /index/);
});
