// Tests for the Day 02 exercise solutions.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findBreak } = require("../find-break");
const { attackerSuccessProbability, confirmationsNeeded } = require("../attacker-odds");
const { GENESIS_HEADER_HEX, compactToTarget, checkHeaderPow } = require("../bitcoin-target");
const { buildDemoChain } = require("../../../src/demo");

test("easy: findBreak reports the first edited block and how many blocks must be re-mined", () => {
  const { chain } = buildDemoChain(8);
  const blocks = chain.blocks.map((b) => ({ ...b }));
  assert.equal(findBreak(blocks, 8), null);
  for (const i of [0, 1, 4]) {
    const copy = blocks.map((b) => ({ ...b }));
    copy[i] = { ...copy[i], data: "edited" };
    const r = findBreak(copy, 8);
    assert.equal(r.firstBad, i);
    assert.equal(r.mustRemine, blocks.length - i);
  }
});

test("medium: reproduces the tables in the Bitcoin whitepaper (section 11)", () => {
  // q = 0.1 column, values as printed in the whitepaper (7 decimals)
  const paper = { 0: 1.0, 1: 0.2045873, 2: 0.0509779, 3: 0.0131722, 4: 0.0034552, 5: 0.0009137, 6: 0.0002428, 7: 0.0000647, 8: 0.0000173, 9: 0.0000046, 10: 0.0000012 };
  for (const [z, p] of Object.entries(paper)) assert.equal(attackerSuccessProbability(0.1, Number(z)).toFixed(7), p.toFixed(7), `z=${z}`);
  const q3 = { 0: 1.0, 5: 0.1773523, 10: 0.0416605, 15: 0.0101008, 20: 0.0024804, 25: 0.0006132, 30: 0.0001522, 35: 0.0000379, 40: 0.0000095, 45: 0.0000024, 50: 0.0000006 };
  for (const [z, p] of Object.entries(q3)) assert.equal(attackerSuccessProbability(0.3, Number(z)).toFixed(7), p.toFixed(7), `q=0.3 z=${z}`);
  const needed = { 0.1: 5, 0.15: 8, 0.2: 11, 0.25: 15, 0.3: 24, 0.35: 41, 0.4: 89, 0.45: 340 };
  for (const [q, z] of Object.entries(needed)) assert.equal(confirmationsNeeded(Number(q)), z, `q=${q}`);
  assert.equal(attackerSuccessProbability(0.5, 100), 1); // majority attacker
  for (const bad of [-0.1, 1, NaN, "0.1"]) assert.throws(() => attackerSuccessProbability(bad, 1), RangeError);
  assert.throws(() => attackerSuccessProbability(0.1, 1.5), RangeError);
});

test("challenge: compact target decoding matches the Bitcoin developer reference examples", () => {
  assert.equal(compactToTarget(0x01003456), 0x00n);
  assert.equal(compactToTarget(0x01123456), 0x12n);
  assert.equal(compactToTarget(0x02008000), 0x80n);
  assert.equal(compactToTarget(0x05009234), 0x92340000n);
  assert.equal(compactToTarget(0x04123456), 0x12345600n);
  assert.throws(() => compactToTarget(0x04923456), /negative/);
  assert.equal(compactToTarget(0x1d00ffff), 0xffffn << 208n);
  assert.throws(() => compactToTarget(0x2200ffff), /overflows/);
  assert.throws(() => compactToTarget(-1), RangeError);
});

test("challenge: the genesis block's PoW checks out, and any edit breaks it", () => {
  const r = checkHeaderPow(GENESIS_HEADER_HEX);
  assert.equal(r.id, "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f");
  assert.equal(r.ok, true);
  assert.equal(r.leadingZeroBits, 43);
  const nonce1 = GENESIS_HEADER_HEX.slice(0, 152) + "1dac2b7d";
  assert.equal(checkHeaderPow(nonce1).ok, false);
  const harder = GENESIS_HEADER_HEX.slice(0, 144) + "ffff0019" + GENESIS_HEADER_HEX.slice(152); // bits 0x1900ffff
  assert.equal(checkHeaderPow(harder).ok, false);
  assert.throws(() => checkHeaderPow("00"), RangeError);
});
