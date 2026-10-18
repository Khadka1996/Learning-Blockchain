"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { demoWallet } = require("../../day-03/src/keys");
const { makeParams } = require("../src/node");
const { simulate } = require("../src/network");
const fork = require("../src/fork");
const demo = require("../src/demo");
const sim = require("../src/sim");

const params = makeParams({ chainId: "lb-devnet", bits: 6, genesis: { [demoWallet("sita").address]: 100 } });

test("fork story: the network splits 2–2, then everyone follows the branch with more work", () => {
  const r = fork.run({ quiet: true });
  assert.deepEqual(r.split, { A: 30, D: 30 }); // A thought Ram was paid, D thought Hari was
  assert.equal(r.reorgs.length, 2);
  assert.ok(r.reorgs.every((e) => e.depth === 1 && ["A", "B"].includes(e.node)));
  assert.equal(r.agreed, true);
  assert.deepEqual(r.final, { ram: 0, hari: 30 });
});

test("Merkle demo: 1,000 payments, a 10-hash proof, edits and wrong positions fail", () => {
  const r = demo.run({ quiet: true });
  assert.equal(r.proof.siblings.length, 10);
  assert.equal(r.proofBytes, 320);
  assert.deepEqual([r.ok, r.editedOk, r.wrongPlace], [true, false, false]);
});

test("property: whatever the timing, all nodes end on the same tip, and runs are repeatable", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 2, max: 6 }), fc.integer({ min: 1, max: 1500 }), (seed, nodes, latency) => {
    const r = simulate({ params, nodes, blocks: 25, blockTime: 500, latency, seed });
    assert.equal(r.agreed, true);
    assert.equal(r.finalHeight + r.stale, r.blocks);
    const again = simulate({ params, nodes, blocks: 25, blockTime: 500, latency, seed });
    assert.equal(again.net.node("A").tip.hash, r.net.node("A").tip.hash);
  }), { numRuns: 40 });
});

test("F1: a tie at the end is broken by one more block, as on a real network", () => {
  const r = simulate({ params, nodes: 5, blocks: 25, blockTime: 500, latency: 1000, seed: 3 });
  const ties = [];
  for (let seed = 1; seed <= 30; seed++) ties.push(simulate({ params, nodes: 5, blocks: 25, blockTime: 500, latency: 1000, seed }));
  assert.ok(ties.some((t) => t.splitAtEnd), "slow networks do end in ties sometimes");
  assert.ok(ties.every((t) => t.agreed));
  assert.equal(r.agreed, true);
});

test("slower messages → more wasted blocks (the reason Bitcoin aims for 10-minute blocks)", () => {
  const rows = sim.run({ blocks: 150, quiet: true });
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].stale >= rows[i - 1].stale);
  assert.ok(rows.every((r) => r.agreed));
});
