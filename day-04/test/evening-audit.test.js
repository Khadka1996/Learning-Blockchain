// Day 04 — evening audit: one failing test per finding, written BEFORE the fix (see QA.md → Evening audit).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { Node, makeParams } = require("../src/node");
const { mineBlock, txRoot, blockHash } = require("../src/block");

const CHAIN = "lb-devnet";
const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
const params = makeParams({ chainId: CHAIN, bits: 8, genesis: { [sita.address]: 100 } });
const pay = (to, amount, nonce, w = sita) => createTransfer(w, { to: to.address, amount, nonce, chainId: CHAIN });
const fresh = (clock = () => 10_000) => new Node("X", params, { clock });
const mineOn = (node, parentHash, txs = [], over = {}) => {
  const p = node.getBlock(parentHash);
  return mineBlock({ chainId: CHAIN, height: p.header.height + 1, prevHash: parentHash, timestamp: p.header.timestamp + 1, bits: 8, ...over }, txs);
};
/** Same header, same hash, but one transaction's signature swapped for `sig`. */
const withSignature = (block, i, sig) => ({ header: block.header, txs: block.txs.map((t, k) => (k === i ? { ...t, signature: sig } : t)), hash: block.hash });

test("E1: the block hash commits to every signature (no 'same hash, different block')", () => {
  const tx = pay(ram, 30, 0);
  // Sita signs the very same payment again: Node's ECDSA uses a fresh random k, so the bytes differ.
  const again = pay(ram, 30, 0);
  assert.notEqual(tx.signature, again.signature);
  assert.notEqual(txRoot([tx]), txRoot([again]), "two different blocks must never share a Merkle root");

  // A corrupted signature must break the Merkle root check, not only the signature check later.
  const a = fresh();
  const b1 = a.mine([tx], 1);
  const broken = withSignature(b1, 0, "00".repeat(64));
  const v = fresh();
  assert.match(v.receive(broken).reason, /Merkle root/);
  assert.equal(v.receive(b1).status, "added");
});

test("E1: a mutated copy sent first cannot block the real block (orphan poisoning)", () => {
  const a = fresh();
  const b1 = a.mine([], 1);
  const b2 = a.mine([pay(ram, 30, 0)], 2);
  const victim = fresh();
  // Mallory forwards b2 with a broken signature before the victim has b1: it waits as an orphan.
  victim.receive(withSignature(b2, 0, "00".repeat(64)));
  // The honest b2 arrives next…
  assert.notEqual(victim.receive(b2).status, "duplicate", "the real block was dropped as a 'duplicate' of the fake");
  victim.receive(b1);
  assert.equal(victim.tip.hash, a.tip.hash, "victim must end on the honest tip");
  assert.equal(victim.ledgerAt().balanceOf(ram.address), 30);
});

test("E2: a block that failed for good is remembered, and so are its children", () => {
  const n = fresh();
  const g = n.tip.hash;
  const overspend = mineOn(n, g, [pay(ram, 500, 0)]);
  assert.match(n.receive(overspend).reason, /rejected/);
  // Sending it again must not cost a full re-check (ledger replay + every signature).
  assert.match(n.receive(overspend).reason, /known invalid block/);
  // A child of an invalid block is invalid too: refuse it at once instead of parking it as an orphan.
  const child = mineBlock({ chainId: CHAIN, height: 2, prevHash: overspend.hash, timestamp: 2, bits: 8 }, []);
  const r = n.receive(child);
  assert.equal(r.status, "rejected");
  assert.match(r.reason, /parent .* is invalid/);
  assert.equal(n.orphanCount, 0);
});

test("E2: an orphan whose parent turns out invalid is marked invalid too", () => {
  const n = fresh();
  const g = n.tip.hash;
  const bad = mineOn(n, g, [pay(ram, 500, 0)]);
  const child = mineBlock({ chainId: CHAIN, height: 2, prevHash: bad.hash, timestamp: 2, bits: 8 }, []);
  assert.equal(n.receive(child).status, "orphan");
  n.receive(bad);
  assert.equal(n.orphanCount, 0);
  assert.match(n.receive(child).reason, /known invalid block/);
});

test("E2: a temporary failure (block from the future) is NOT remembered", () => {
  let now = 0;
  const n = fresh(() => now);
  const g = n.tip.hash;
  const early = mineOn(n, g, [], { timestamp: 3 * 60 * 60 * 1000 });
  assert.match(n.receive(early).reason, /future/);
  now = 2 * 60 * 60 * 1000; // an hour later it is fine
  assert.equal(n.receive(early).status, "added");
});

test("E2: a block refused only because its 'hash' field was wrong is not blacklisted", () => {
  const a = fresh();
  const b1 = a.mine([], 1);
  const n = fresh();
  assert.match(n.receive({ ...b1, hash: "f".repeat(64) }).reason, /does not match/);
  assert.equal(n.receive(b1).status, "added");
});

test("E3: asking about an unknown block gives a clear error, not a crash inside the node", () => {
  const n = fresh();
  assert.throws(() => n.ledgerAt("ab".repeat(32)), { name: "RangeError", message: /unknown block/ });
  assert.throws(() => n.chain("nope"), { name: "RangeError", message: /unknown block/ });
});

test("E1 regression: the header hash still covers the Merkle root", () => {
  const a = fresh();
  const b = a.mine([pay(hari, 5, 0)], 1);
  assert.equal(blockHash(b.header), b.hash);
});

test("property: honest blocks + mutated copies + invalid branches, in any order → the honest tip wins", () => {
  const fc = require("fast-check");
  // Built once: an honest chain of 4 blocks with payments, plus an invalid side branch and fakes.
  const a = fresh();
  const honest = [a.mine([pay(ram, 10, 0)], 1), a.mine([], 2), a.mine([pay(hari, 5, 1)], 3), a.mine([pay(hari, 1, 0, ram)], 4)];
  const helper = fresh();
  const g = helper.tip.hash;
  const bad = mineOn(helper, g, [pay(ram, 999, 0)]); // overspend
  const badChild = mineBlock({ chainId: CHAIN, height: 2, prevHash: bad.hash, timestamp: 9, bits: 8 }, []);
  const fakes = honest.filter((b) => b.txs.length).map((b) => withSignature(b, 0, "00".repeat(64)));
  const all = [...honest, bad, badChild, ...fakes];
  fc.assert(
    fc.property(fc.array(fc.nat(all.length - 1), { maxLength: 12 }), fc.shuffledSubarray(all.map((_, i) => i), { minLength: all.length }), (extra, order) => {
      const v = fresh();
      for (const i of [...extra, ...order]) assert.doesNotThrow(() => v.receive(all[i]));
      assert.equal(v.tip.hash, a.tip.hash);
      assert.equal(v.orphanCount, 0);
    }),
    { numRuns: 200, seed: 4 },
  );
});
