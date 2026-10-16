// Day 02 — evening audit regression tests (findings E1–E5 in QA.md).
// Each test was written to FAIL against the morning code, then the code was fixed.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const blk = require("../src/block");
const ch = require("../src/chain");
const { buildDemoChain } = require("../src/demo");

const D = 8;
const base = { index: 1, prevHash: "0".repeat(64), timestamp: 1, difficulty: 4, nonce: 0 };
const hashOf = (data) => blk.hashBlock({ ...base, data });
const throwsOrDiffers = (a, b) => {
  let ha;
  let hb;
  try {
    ha = hashOf(a);
    hb = hashOf(b);
  } catch {
    return; // refusing ambiguous data is fine
  }
  assert.notEqual(ha, hb);
};

// E1 — JSON.stringify drops or rewrites values: {a: undefined} → "{}", NaN/Infinity → null, -0 → 0,
// and objects with toJSON() are hashed as whatever toJSON returns. Different payloads, same block hash.
test("E1: payloads JSON.stringify would silently merge are refused or hashed differently", () => {
  throwsOrDiffers({ a: undefined }, {});
  throwsOrDiffers([undefined], [null]);
  throwsOrDiffers(NaN, null);
  throwsOrDiffers({ x: Infinity }, { x: null });
  throwsOrDiffers(-0, 0);
  throwsOrDiffers({ amount: 500, toJSON: () => ({ amount: 5 }) }, { amount: 5 });
  throwsOrDiffers({ when: new Date(0) }, { when: "1970-01-01T00:00:00.000Z" });
  throwsOrDiffers([1, , 3], [1, null, 3]); // eslint-disable-line no-sparse-arrays
  throwsOrDiffers({ f: () => 1 }, {});
});

test("E1: the strict encoder refuses every non-JSON value with a TypeError", () => {
  class Payment { constructor() { this.amount = 5; } }
  const bad = [undefined, NaN, Infinity, -0, 10n, Symbol("s"), () => 1, new Date(0), new Map(), new Payment(), [1, , 2], { a: undefined }, { toJSON: () => 1 }]; // eslint-disable-line no-sparse-arrays
  for (const b of bad) assert.throws(() => blk.hashData(b), TypeError, String(typeof b));
});

test("E1: key order does not change the hash (canonical encoding), real JSON data still works", () => {
  assert.equal(hashOf({ from: "Sita", to: "Ram", amount: 5 }), hashOf({ amount: 5, to: "Ram", from: "Sita" }));
  assert.match(hashOf({ list: [1, "two", true, null, { n: -3.5 }], ok: false }), /^[0-9a-f]{64}$/);
  assert.match(hashOf("Sita pays Ram 5 coins"), /^[0-9a-f]{64}$/);
});

test("E1 property: two DIFFERENT accepted JSON values never give the same block hash", () => {
  const json = fc.jsonValue({ maxDepth: 3 });
  fc.assert(
    fc.property(json, json, (a, b) => {
      // compare canonically: sorted keys, so {a,b} and {b,a} count as equal
      const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
      fc.pre(canon(a) !== canon(b) && !Object.is(a, -0) && !Object.is(b, -0));
      let ha;
      let hb;
      try {
        ha = hashOf(a);
        hb = hashOf(b);
      } catch {
        return;
      }
      assert.notEqual(ha, hb);
    }),
    { numRuns: 3000 }
  );
});

// E2 — the chain stored the caller's object by reference. Changing your own variable after
// addBlock() rewrote the ledger (and the returned block WAS the stored block).
test("E2: caller objects are copied and stored blocks are frozen", () => {
  const chain = new ch.Blockchain(D);
  const payment = { from: "Sita", to: "Ram", amount: 5 };
  const { block } = chain.addBlock(payment, ch.GENESIS_TIMESTAMP + 1);
  payment.amount = 500;
  assert.equal(chain.tip.data.amount, 5);
  assert.throws(() => { "use strict"; block.data.amount = 500; }, TypeError);
  assert.throws(() => { "use strict"; chain.tip.nonce = 1; }, TypeError);
  assert.equal(chain.isValid(), true);
});

// E3 — extra fields outside the hashed header (e.g. a second "amount") were accepted as VALID.
test("E3: blocks with fields that are not covered by the hash are rejected", () => {
  const { chain } = buildDemoChain(D);
  const blocks = chain.blocks.map((b) => ({ ...b }));
  blocks[2] = { ...blocks[2], amount: 500 };
  const r = ch.validateBlocks(blocks, { difficulty: D });
  assert.deepEqual([r.valid, r.index], [false, 2]);
  assert.match(r.reason, /unexpected field "amount"/);
  const g = ch.validateBlocks([{ ...chain.blocks[0], note: "x" }], { difficulty: D });
  assert.equal(g.valid, false);
});

// E4 — addBlock() mined and appended blocks that its own validator rejects (far-future time),
// and silently replaced a too-early timestamp with the parent's.
test("E4: addBlock refuses blocks that would make the chain invalid", () => {
  const chain = new ch.Blockchain(D);
  assert.throws(() => chain.addBlock("x", Date.now() + 3 * 3600_000), /future/);
  assert.throws(() => chain.addBlock("x", ch.GENESIS_TIMESTAMP - 1), /earlier/);
  assert.throws(() => chain.addBlock("x", "soon"), /timestamp/);
  assert.equal(chain.blocks.length, 1);
  assert.equal(chain.isValid(), true);
});

// E5 — payload size was unbounded: every validator must hash whatever a miner stuffs in a block.
test("E5: payloads above 1 MB are refused (cheap to reject, expensive to validate)", () => {
  assert.throws(() => blk.hashData("x".repeat(blk.MAX_DATA_BYTES)), /too large/);
  assert.match(blk.hashData("x".repeat(blk.MAX_DATA_BYTES - 2)), /^[0-9a-f]{64}$/); // + 2 quote chars = limit
  let deep = 0;
  for (let i = 0; i < 100; i++) deep = [deep];
  assert.throws(() => blk.hashData(deep), /nested/);
});

test("checked, not vulnerable: lone surrogates (Day 01 E1) do not collide inside block data", () => {
  throwsOrDiffers("\uD800", "�");
  throwsOrDiffers("\uDC00", "\uD800");
});

// ---------- audit round 2: re-attack the fixes ----------
test("round 2: getters, __proto__ keys and cycles cannot sneak around the encoder", () => {
  let n = 0;
  const sneaky = { get amount() { return (n += 5); } }; // returns 5, then 10, …
  const chain = new ch.Blockchain(D);
  chain.addBlock(sneaky, ch.GENESIS_TIMESTAMP + 1);
  assert.equal(chain.tip.data.amount, 5); // stored copy == the bytes that were hashed
  assert.equal(chain.isValid(), true);

  const polluted = JSON.parse('{"__proto__": {"admin": true}, "x": 1}');
  const h = hashOf(polluted);
  assert.notEqual(h, hashOf({ x: 1 }));
  assert.equal({}.admin, undefined);
  const loaded = JSON.parse(JSON.stringify(chain.blocks));
  loaded[1] = JSON.parse(JSON.stringify(chain.blocks[1]).replace('"nonce"', '"__proto__":{},"nonce"'));
  assert.match(ch.validateBlocks(loaded, { difficulty: D }).reason, /unexpected field "__proto__"/);

  const cyc = { a: 1 };
  cyc.self = cyc;
  assert.throws(() => blk.hashData(cyc), TypeError);
});

// ---------- evening improvement: difficulty adjustment ----------
const RT = { interval: 5, targetMs: 1000 };
const fakeBlocks = (gapsMs, difficulty = 10) => {
  const out = [{ timestamp: 0, difficulty }];
  let t = 1_000;
  for (const g of gapsMs) out.push({ timestamp: (t += g), difficulty });
  return out;
};

test("improvement: retarget rule — faster window adds bits, slower removes, capped at ±2", () => {
  const at = (gap) => ch.expectedDifficulty(fakeBlocks(Array(5).fill(gap)), 6, 10, RT);
  assert.equal(at(1000), 10); // on target → no change
  assert.equal(at(500), 11); // 2× too fast → +1 bit (2× more work)
  assert.equal(at(2000), 9); // 2× too slow → −1 bit
  assert.equal(at(1), 12); // 1000× too fast → capped at +2
  assert.equal(at(0), 12); // same-millisecond blocks: no divide-by-zero
  assert.equal(at(1e6), 8); // capped at −2
  assert.equal(ch.expectedDifficulty(fakeBlocks(Array(5).fill(1)), 5, 10, RT), 10); // not a retarget height
  assert.equal(ch.expectedDifficulty(fakeBlocks(Array(5).fill(1)), 6, 10, null), 10); // retarget off
  assert.equal(ch.expectedDifficulty(fakeBlocks(Array(5).fill(1), 32), 6, 32, RT), 32); // never above 32
  assert.equal(ch.expectedDifficulty(fakeBlocks(Array(5).fill(1e6), 1), 6, 1, RT), 1); // never below 1
});

test("improvement: a retargeting chain raises difficulty for fast blocks and re-validates every step", () => {
  const chain = new ch.Blockchain(4, { retarget: RT });
  const t0 = ch.GENESIS_TIMESTAMP;
  for (let i = 1; i <= 16; i++) chain.addBlock(`b${i}`, t0 + i, t0); // 1 ms apart: far too fast
  assert.deepEqual(chain.blocks.map((b) => b.difficulty), [4, 4, 4, 4, 4, 4, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 10]);
  assert.equal(chain.isValid(t0), true);
  // a miner that ignores the rule and keeps the old, easier difficulty is rejected
  const cheat = chain.blocks.slice(0, 11).map((b) => ({ ...b }));
  const p = cheat[10];
  cheat.push(blk.mineBlock({ index: 11, prevHash: p.hash, timestamp: p.timestamp + 1, data: "cheap", difficulty: 6 }).block);
  const r = ch.validateBlocks(cheat, { difficulty: 4, retarget: RT, now: t0 });
  assert.deepEqual([r.index, r.reason], [11, "wrong difficulty 6 (chain requires 8)"]);
});

test("improvement: retarget settings are validated", () => {
  for (const bad of [{}, { interval: 1, targetMs: 10 }, { interval: 5, targetMs: 0 }, { interval: "0x5", targetMs: 10 }, { interval: 5, targetMs: 1e9 }]) {
    assert.throws(() => new ch.Blockchain(8, { retarget: bad }), RangeError, JSON.stringify(bad));
  }
});

test("known issue K1 (time-warp): fake slow timestamps lower difficulty — but only by 2 bits per window", () => {
  const chain = new ch.Blockchain(12, { retarget: RT });
  const t0 = ch.GENESIS_TIMESTAMP;
  for (let i = 1; i <= 6; i++) chain.addBlock(`b${i}`, t0 + i * 3_600_000, t0 + 7 * 3_600_000); // claims 1 h per block
  assert.equal(chain.blocks[6].difficulty, 10);
  assert.equal(chain.isValid(t0 + 7 * 3_600_000), true);
});

// E6 (round 3) — a bad `now` (NaN, a string) made "timestamp > now + 2h" always false, switching the
// future-time rule off without any error.
test("E6: an invalid clock value is refused instead of silently disabling the future-time rule", () => {
  const { chain } = buildDemoChain(D);
  for (const bad of [NaN, "x", -1, 1.5, null]) {
    assert.throws(() => ch.validateBlocks(chain.blocks, { difficulty: D, now: bad }), /now must be/, String(bad));
    assert.throws(() => chain.addBlock("x", chain.tip.timestamp + 1, bad), /now must be/, String(bad));
  }
});

test("improvement: retarget demo runs end to end and rejects bad arguments", () => {
  const { runRetarget } = require("../src/retarget");
  const { windows, valid } = runRetarget(4, 5, 10);
  assert.equal(valid, true);
  assert.deepEqual(windows.map((w) => w.from), [1, 6]);
  assert.throws(() => runRetarget(4, 5, 2), RangeError);
  assert.throws(() => runRetarget(4, 0, 10), RangeError);
});
