// Day 02 tests — blocks, hashing and Proof of Work. Run with `npm test`.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const blk = require("../src/block");

const HEX64 = fc.hexaString({ minLength: 64, maxLength: 64 }).map((h) => h.toLowerCase());
const header = fc.record({
  index: fc.nat(1e6),
  prevHash: HEX64,
  timestamp: fc.nat(2 ** 45),
  difficulty: fc.integer({ min: 1, max: 32 }),
  nonce: fc.nat(2 ** 32),
  data: fc.string({ maxLength: 20 }),
});

test("hashBlock is deterministic and always 64 lowercase hex characters", () => {
  fc.assert(
    fc.property(header, (h) => {
      const x = blk.hashBlock(h);
      assert.match(x, /^[0-9a-f]{64}$/);
      assert.equal(blk.hashBlock({ ...h }), x);
    }),
    { numRuns: 1000 }
  );
});

// F3 — v1 glued fields together as text: index 1, prevHash "ab", timestamp 12 == index 1, prevHash "ab1", timestamp 2.
test("F3: field boundaries are unambiguous (v1 collision pair now hashes differently)", () => {
  const p = "a".repeat(63);
  const a = { index: 1, prevHash: p + "b", timestamp: 12, difficulty: 4, nonce: 3, data: "x" };
  const b = { index: 11, prevHash: p + "b", timestamp: 2, difficulty: 4, nonce: 3, data: "x" };
  const c = { index: 1, prevHash: p + "b", timestamp: 12, difficulty: 4, nonce: 34, data: "x" };
  const d = { index: 1, prevHash: p + "b", timestamp: 12, difficulty: 13, nonce: 4, data: "x" };
  assert.notEqual(blk.hashBlock(a), blk.hashBlock(b));
  assert.notEqual(blk.hashBlock(c), blk.hashBlock(d));
});

test("F3 property: two different headers never serialise to the same bytes", () => {
  fc.assert(
    fc.property(header, header, (a, b) => {
      fc.pre(JSON.stringify(a) !== JSON.stringify(b));
      assert.notEqual(blk.serializeHeader(a), blk.serializeHeader(b));
    }),
    { numRuns: 3000 }
  );
});

test("mined blocks really meet the target, and the fast bit check agrees with the BigInt check", () => {
  for (const d of [1, 4, 8, 12]) {
    const { block, attempts } = blk.mineBlock({ index: 1, prevHash: "0".repeat(64), timestamp: 1, data: "x", difficulty: d });
    assert.ok(blk.meetsDifficulty(block.hash, d));
    assert.ok(blk.leadingZeroBits(block.hash) >= d);
    assert.equal(block.hash, blk.hashBlock(block));
    assert.equal(attempts, block.nonce + 1);
  }
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.integer({ min: 1, max: 32 }), (bytes, d) => {
      const hex = Buffer.from(bytes).toString("hex");
      assert.equal(blk.hasLeadingZeroBits(bytes, d), blk.meetsDifficulty(hex, d));
      assert.equal(blk.leadingZeroBits(hex) >= d, blk.meetsDifficulty(hex, d));
    }),
    { numRuns: 3000 }
  );
});

test("boundary values of the target: exactly d zero bits passes, d−1 fails", () => {
  const withZeros = (z) => (BigInt(1) << BigInt(255 - z)).toString(16).padStart(64, "0"); // first 1-bit at position z
  for (const d of [1, 7, 8, 9, 16, 31, 32]) {
    assert.equal(blk.meetsDifficulty(withZeros(d), d), true, `d=${d}`);
    assert.equal(blk.meetsDifficulty(withZeros(d - 1), d), false, `d=${d}`);
    assert.equal(blk.leadingZeroBits(withZeros(d)), d);
  }
  assert.equal(blk.leadingZeroBits("0".repeat(64)), 256);
});

// F7/F8 — v1: meetsDifficulty(h, 300) threw a raw BigInt error; mineBlock(difficulty 256) looped forever.
test("F7/F8: difficulty outside 1–32 bits is refused with a clear error, before any mining", () => {
  for (const bad of [0, -1, 33, 256, 300, 1.5, NaN, "0x10", "1e1", "", null, undefined, [8]]) {
    assert.throws(() => blk.parseDifficulty(bad), RangeError, String(bad));
    assert.throws(() => blk.mineBlock({ index: 1, prevHash: "0".repeat(64), timestamp: 1, data: "x", difficulty: bad }), /difficulty/);
  }
  assert.equal(blk.parseDifficulty("16"), 16);
});

test("F8: mining always terminates (maxAttempts)", () => {
  assert.throws(
    () => blk.mineBlock({ index: 1, prevHash: "0".repeat(64), timestamp: 1, data: "x", difficulty: 32 }, { maxAttempts: 1000 }),
    /no valid nonce found in 1000 attempts/
  );
  assert.throws(() => blk.mineBlock({ index: 1, prevHash: "0".repeat(64), timestamp: 1, data: "x", difficulty: 4 }, { maxAttempts: 0 }), RangeError);
});

// F5 — v1 hashed whatever it was given: missing fields became the text "undefined".
test("F5: malformed headers are rejected instead of hashed", () => {
  const ok = { index: 1, prevHash: "0".repeat(64), timestamp: 1, difficulty: 4, nonce: 0, data: "x" };
  const bad = [
    null, 42, {},
    { ...ok, index: -1 }, { ...ok, index: "1" }, { ...ok, index: 1.5 },
    { ...ok, prevHash: "abc" }, { ...ok, prevHash: "A".repeat(64) },
    { ...ok, timestamp: -5 }, { ...ok, timestamp: 2 ** 60 },
    { ...ok, nonce: -1 }, { ...ok, nonce: "7" },
    { ...ok, data: undefined }, { ...ok, data: () => 1 },
  ];
  for (const b of bad) assert.throws(() => blk.hashBlock(b), TypeError, JSON.stringify(b));
  assert.equal(blk.meetsDifficulty("not a hash", 4), false);
});
