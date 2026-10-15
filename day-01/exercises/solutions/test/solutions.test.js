// Tests for the Day 01 exercise solutions.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { sha256Hex } = require("../../../src/lib");
const { findTampered } = require("../tampered");
const { GENESIS_HEADER_HEX, hash256, blockId, leadingZeros } = require("../genesis");
const { MOVES, commit, verify, crackUnsalted } = require("../commit-reveal");

test("easy: findTampered returns exactly the edited records", () => {
  const recs = ["a", "b", "c"].map((t, i) => ({ id: i, text: t, publishedHash: sha256Hex(t) }));
  assert.deepEqual(findTampered(recs), []);
  recs[2].text = "C";
  assert.deepEqual(findTampered(recs), [2]);
  assert.deepEqual(findTampered([{ id: 9, text: "x", publishedHash: sha256Hex("x").toUpperCase() }]), []);
  assert.throws(() => findTampered("nope"), TypeError);
});

test("medium: hash256 matches the known value and the genesis block id is reproduced", () => {
  // hash256("") — a widely published value
  assert.equal(Buffer.from(hash256("")).toString("hex"), "5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456");
  const id = blockId(GENESIS_HEADER_HEX);
  assert.equal(id, "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f");
  assert.equal(leadingZeros(id), 10);
  assert.throws(() => blockId("00"), RangeError);
  // change the nonce by one → the proof of work is gone
  const tampered = GENESIS_HEADER_HEX.slice(0, -2) + "7d";
  assert.ok(leadingZeros(blockId(tampered)) < 10);
});

test("challenge: honest reveal verifies, any change fails", () => {
  for (const move of MOVES) {
    const c = commit(move);
    assert.equal(verify(c.commitment, move, c.salt), true);
    for (const other of MOVES.filter((m) => m !== move)) assert.equal(verify(c.commitment, other, c.salt), false);
  }
});

test("challenge: unsalted commitments leak, salted ones don't", () => {
  for (const move of MOVES) assert.equal(crackUnsalted(sha256Hex(move)), move);
  assert.equal(crackUnsalted(commit("paper").commitment), null);
});

test("challenge (fuzz): random salts never verify a different reveal, and garbage never throws", () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.constantFrom(...MOVES), (s1, s2, move) => {
      const c = commit(move, s1);
      const otherSalt = Buffer.from(s2).toString("hex");
      if (otherSalt !== c.salt) assert.equal(verify(c.commitment, move, otherSalt), false);
    }),
    { numRuns: 300 }
  );
  for (const bad of [[null, "rock", "00"], ["zz", "rock", "00".repeat(32)], ["0".repeat(64), "lizard", "00".repeat(32)], ["0".repeat(64), "rock", "00"]]) {
    assert.equal(verify(...bad), false);
  }
  assert.throws(() => commit("lizard"), RangeError);
  assert.throws(() => commit("rock", Buffer.alloc(8)), RangeError);
});
