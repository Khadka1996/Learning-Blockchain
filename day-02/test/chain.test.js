// Day 02 tests — chains, validation and tamper detection.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const fc = require("fast-check");
const blk = require("../src/block");
const ch = require("../src/chain");
const { buildDemoChain } = require("../src/demo");
const { tamperStory } = require("../src/tamper");
const { difficultyTable } = require("../src/difficulty");

const SRC = path.join(__dirname, "..", "src");
const run = (script, args = []) => spawnSync(process.execPath, [path.join(SRC, script), ...args], { encoding: "utf8", timeout: 20000 });
const D = 8; // low difficulty keeps tests fast; the rules are identical at any difficulty
const copy = (blocks) => blocks.map((b) => ({ ...b }));

test("an honestly mined chain is valid and every block links to its parent", () => {
  const { chain } = buildDemoChain(D);
  assert.deepEqual(chain.validate(), { valid: true });
  for (let i = 1; i < chain.blocks.length; i++) assert.equal(chain.blocks[i].prevHash, chain.blocks[i - 1].hash);
});

test("demo chain is reproducible: same rules → same hashes on every machine", () => {
  const a = buildDemoChain(16).chain.blocks.map((b) => b.hash);
  assert.equal(a[0].slice(0, 16), "0000d39b694b706e");
  assert.equal(a[4].slice(0, 16), "0000acbcb8c34e77");
});

test("tamper story: edit → detected; rehash → not mined; re-mine one → link broken; re-mine all → valid", () => {
  const { steps, attempts, blocksRemined } = tamperStory(D);
  const r = steps.map(([, x]) => x);
  assert.equal(r[0].valid, true);
  assert.deepEqual([r[1].index, r[1].reason], [1, "hash does not match contents (block was edited)"]);
  assert.match(r[2].reason, /Proof-of-Work/);
  assert.deepEqual([r[3].index, r[3].reason], [2, "prevHash does not point to the previous block (chain broken)"]);
  assert.equal(r[4].valid, true);
  assert.equal(blocksRemined, 4);
  assert.ok(attempts >= 4);
});

test("property: changing ANY field of ANY block is detected at that block (or earlier)", () => {
  const { chain } = buildDemoChain(D);
  const fields = ["index", "prevHash", "timestamp", "difficulty", "nonce", "data", "hash"];
  fc.assert(
    fc.property(fc.integer({ min: 0, max: chain.blocks.length - 1 }), fc.constantFrom(...fields), fc.integer({ min: 1, max: 9 }), (i, field, k) => {
      const blocks = copy(chain.blocks);
      const v = blocks[i][field];
      blocks[i][field] = typeof v === "number" ? v + k : v.slice(0, -1) + (v.endsWith("0") ? "1" : "0");
      const r = ch.validateBlocks(blocks, { difficulty: D });
      assert.equal(r.valid, false);
      assert.ok(r.index <= i);
    }),
    { numRuns: 500 }
  );
});

// F1 — v1 only compared hash == recomputed hash, so an edited block with a recomputed (unmined) hash passed.
test("F1: a forged chain with recomputed but UNMINED hashes is rejected", () => {
  const { chain } = buildDemoChain(16);
  const blocks = copy(chain.blocks);
  blocks[1].data = "Sita pays Ram 500 coins";
  for (let i = 1; i < blocks.length; i++) {
    blocks[i].prevHash = blocks[i - 1].hash;
    blocks[i].hash = blk.hashBlock(blocks[i]);
  }
  const r = ch.validateBlocks(blocks, { difficulty: 16 });
  assert.deepEqual([r.valid, r.index], [false, 1]);
  assert.match(r.reason, /Proof-of-Work/);
});

// F2 — v1 trusted the difficulty written INSIDE each block, so a forger simply wrote difficulty 1.
test("F2: blocks mined at a lower difficulty than the chain requires are rejected", () => {
  const { chain } = buildDemoChain(16);
  const blocks = copy(chain.blocks);
  for (let i = 1; i < blocks.length; i++) {
    blocks[i] = blk.mineBlock({ ...blocks[i], prevHash: blocks[i - 1].hash, difficulty: 1 }).block;
  }
  const r = ch.validateBlocks(blocks, { difficulty: 16 });
  assert.deepEqual([r.valid, r.index], [false, 1]);
  assert.match(r.reason, /wrong difficulty 1/);
});

// F4 — v1 never checked block 0: a different genesis (a whole fake history) or an edited genesis passed.
test("F4: a foreign or edited genesis block is rejected", () => {
  const fake = blk.mineBlock({ index: 0, prevHash: ch.ZERO_HASH, timestamp: 5, data: "evil genesis", difficulty: D }).block;
  assert.deepEqual(ch.validateBlocks([fake], { difficulty: D }).index, 0);
  const { chain } = buildDemoChain(D);
  const blocks = copy(chain.blocks);
  blocks[0].data = "hacked";
  assert.equal(ch.validateBlocks(blocks, { difficulty: D }).index, 0);
  assert.equal(ch.validateBlocks([], { difficulty: D }).valid, false);
  assert.equal(ch.validateBlocks("nope", { difficulty: D }).valid, false);
  assert.equal(ch.validateBlocks([null], { difficulty: D }).valid, false);
});

// F6 — v1 accepted index 99 after index 1 and timestamps far in the past/future.
test("F6: wrong index, time travel backwards and far-future timestamps are rejected", () => {
  const { chain } = buildDemoChain(D);
  const tip = chain.tip;
  const next = (over) => blk.mineBlock({ index: tip.index + 1, prevHash: tip.hash, timestamp: tip.timestamp + 1, data: "n", difficulty: D, ...over }).block;
  const now = tip.timestamp;
  const check = (b) => ch.validateBlocks([...chain.blocks, b], { difficulty: D, now });
  assert.equal(check(next({})).valid, true);
  assert.match(check(next({ index: 99 })).reason, /index 99 should be 5/);
  assert.match(check(next({ timestamp: tip.timestamp - 1 })).reason, /earlier/);
  assert.equal(check(next({ timestamp: now + ch.MAX_FUTURE_MS })).valid, true); // exactly 2 h: allowed
  assert.match(check(next({ timestamp: now + ch.MAX_FUTURE_MS + 1 })).reason, /future/);
});

test("malformed blocks inside a chain give a reason instead of crashing", () => {
  const { chain } = buildDemoChain(D);
  for (const bad of [null, 5, "x", {}, { ...chain.blocks[1], nonce: -1 }]) {
    const blocks = copy(chain.blocks);
    blocks[2] = bad;
    const r = ch.validateBlocks(blocks, { difficulty: D });
    assert.deepEqual([r.valid, r.index], [false, 2]);
  }
});

test("difficulty table: averages are in the right range of 2^d (deterministic samples)", () => {
  const rows = difficultyTable(12, 8);
  assert.deepEqual(rows.map((r) => r.difficulty), [4, 8, 12]);
  for (const r of rows) assert.ok(r.avgAttempts > r.expected / 4 && r.avgAttempts < r.expected * 4, JSON.stringify(r));
  assert.deepEqual(difficultyTable(12, 8).map((r) => r.avgAttempts), rows.map((r) => r.avgAttempts));
  assert.throws(() => difficultyTable(12, 0), RangeError);
});

test("CLIs: bad arguments → one clean error line and exit code 1; good run → exit 0", () => {
  for (const [script, args] of [["demo.js", ["abc"]], ["demo.js", ["99"]], ["tamper.js", ["0"]], ["difficulty.js", ["12", "1e3"]]]) {
    const r = run(script, args);
    assert.equal(r.status, 1, `${script} ${args}`);
    assert.match(r.stderr, /^Error: /);
    assert.doesNotMatch(r.stderr, /at .*\.js:\d+/); // no stack trace
  }
  const ok = run("demo.js", ["8"]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /Chain valid: true/);
});

test("requiring a script has no side effects", () => {
  const r = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(SRC, "tamper.js"))})`], { encoding: "utf8" });
  assert.equal(r.stdout, "");
});
