"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { Node, makeParams, MAX_ORPHANS } = require("../src/node");
const { mineBlock, txRoot } = require("../src/block");

const CHAIN = "lb-devnet";
const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
const params = makeParams({ chainId: CHAIN, bits: 8, genesis: { [sita.address]: 100 } });
const pay = (to, amount, nonce, w = sita) => createTransfer(w, { to: to.address, amount, nonce, chainId: CHAIN });
const fresh = (clock = () => 10_000) => new Node("X", params, { clock });
/** Mine a block on any parent (not just the tip), for building forks by hand. */
const mineOn = (node, parentHash, txs = [], over = {}) => {
  const p = node.getBlock(parentHash);
  return mineBlock({ chainId: CHAIN, height: p.header.height + 1, prevHash: parentHash, timestamp: p.header.timestamp + 1, bits: 8, ...over }, txs);
};

test("all nodes build the same genesis; different balances → different genesis", () => {
  assert.equal(fresh().tip.hash, fresh().tip.hash);
  const other = makeParams({ chainId: CHAIN, bits: 8, genesis: { [sita.address]: 101 } });
  assert.notEqual(other.genesisBlock.hash, params.genesisBlock.hash);
});

test("mine, share and follow a chain; balances come from Day 03's ledger", () => {
  const a = fresh();
  const b = fresh();
  const b1 = a.mine([pay(ram, 30, 0)], 1);
  const b2 = a.mine([pay(hari, 10, 0, ram)], 2);
  assert.equal(b.receive(b1).status, "added");
  assert.equal(b.receive(b2).status, "added");
  assert.equal(b.receive(b2).status, "duplicate");
  assert.equal(b.tip.hash, a.tip.hash);
  assert.equal(b.tip.height, 2);
  const L = b.ledgerAt();
  assert.deepEqual([sita, ram, hari].map((w) => L.balanceOf(w.address)), [70, 20, 10]);
});

test("A3: difficulty is a network rule; a block cannot lower its own", () => {
  const n = fresh();
  const g = n.tip.hash;
  const easy = mineOn(n, g, [], { bits: 1 });
  assert.match(n.receive(easy).reason, /difficulty must be 8 bits/);
  // Right bits written in the header, but the hash does not have them.
  let lazy;
  for (let nonce = 0; ; nonce++) {
    const b = mineOn(n, g, [], { bits: 0 });
    const h = { ...b.header, bits: 8, nonce };
    const { blockHash, leadingZeroBits } = require("../src/block");
    if (leadingZeroBits(blockHash(h)) < 8) { lazy = { header: h, txs: [] }; break; }
  }
  assert.match(n.receive(lazy).reason, /not enough Proof of Work/);
});

test("blocks with a wrong Merkle root, chain, height, time or hash field are refused", () => {
  const n = fresh();
  const g = n.tip.hash;
  const good = mineOn(n, g, [pay(ram, 1, 0)]);
  assert.match(n.receive({ header: good.header, txs: [pay(ram, 2, 0)] }).reason, /Merkle root/);
  assert.match(n.receive({ header: good.header, txs: [] }).reason, /Merkle root/);
  assert.match(n.receive({ ...good, hash: "0".repeat(64) }).reason, /hash does not match/);
  assert.match(n.receive(mineOn(n, g, [], { chainId: "lb-testnet" })).reason, /chain "lb-testnet"/);
  assert.match(n.receive(mineOn(n, g, [], { height: 5 })).reason, /height must be 1/);
  assert.match(n.receive(mineOn(n, g, [], { timestamp: 10_000 + 3 * 3600_000 })).reason, /future/);
  const b1 = mineOn(n, g, [], { timestamp: 500 });
  n.receive(b1);
  assert.match(n.receive(mineOn(n, b1.hash, [], { timestamp: 499 })).reason, /earlier than the parent/);
  assert.match(n.receive({ header: good.header, txs: good.txs, extra: 1 }).reason, /unexpected field/);
});

test("blocks with an invalid payment are refused: overspend, replay across blocks, forged", () => {
  const n = fresh();
  const tx = pay(ram, 30, 0);
  const b1 = n.mine([tx], 1);
  assert.match(n.receive(mineOn(n, b1.hash, [tx])).reason, /already used \(replay\)/);
  assert.match(n.receive(mineOn(n, b1.hash, [pay(ram, 71, 1)])).reason, /insufficient balance/);
  assert.match(n.receive(mineOn(n, b1.hash, [pay(ram, 1, 1), pay(ram, 1, 1)])).reason, /already used/);
  const forged = { ...pay(ram, 5, 1), amount: 50 };
  const forgedBlock = mineOn(n, b1.hash, [forged]); // a miner can put anything in a block…
  assert.match(n.receive(forgedBlock).reason, /signature/); // …but every node checks it
  assert.equal(n.tip.hash, b1.hash);
});

test("fork choice: equal work keeps the first block seen; more work wins and reports the reorg", () => {
  const n = fresh();
  const g = n.tip.hash;
  const a2 = mineOn(n, g, [pay(ram, 30, 0)]);
  const c2 = mineOn(n, g, [pay(hari, 30, 0)]);
  n.receive(a2);
  const r = n.receive(c2);
  assert.equal(r.status, "added");
  assert.equal(r.tipChanged, false);
  assert.equal(n.tip.hash, a2.hash);
  assert.equal(n.ledgerAt().balanceOf(ram.address), 30);
  const r3 = n.receive(mineOn(n, c2.hash));
  assert.equal(r3.reorg.depth, 1);
  assert.equal(r3.reorg.forkPoint, g);
  assert.equal(n.ledgerAt().balanceOf(ram.address), 0); // Ram's payment is gone
  assert.equal(n.ledgerAt().balanceOf(hari.address), 30);
  assert.equal(n.ledgerAt(a2.hash).balanceOf(ram.address), 30); // the old branch is still stored
});

test("orphans: a child that arrives before its parent is kept, then connected", () => {
  const a = fresh();
  const b = fresh();
  const b1 = a.mine([], 1);
  const b2 = a.mine([], 2);
  const b3 = a.mine([], 3);
  assert.equal(b.receive(b3).status, "orphan");
  assert.equal(b.receive(b2).missing, b1.hash);
  const r = b.receive(b1);
  assert.deepEqual(r.added, [b1.hash, b2.hash, b3.hash]);
  assert.equal(b.tip.hash, b3.hash);
  assert.equal(b.orphanCount, 0);
});

test("orphans: 30 blocks in reverse order all connect; children of an invalid block never do", () => {
  const a = fresh();
  const b = fresh();
  const blocks = Array.from({ length: 30 }, (_, i) => a.mine([], i + 1));
  for (const blk of [...blocks].reverse()) b.receive(blk);
  assert.equal(b.tip.hash, a.tip.hash);
  assert.equal(b.orphanCount, 0);
  const c = fresh();
  const bad = mineOn(c, c.tip.hash, [{ ...pay(ram, 5, 0), amount: 50 }]); // forged payment
  const child = mineBlock({ chainId: CHAIN, height: 2, prevHash: bad.hash, timestamp: 9, bits: 8 }, []);
  assert.equal(c.receive(child).status, "orphan");
  assert.equal(c.receive(bad).status, "rejected");
  assert.equal(c.tip.height, 0);
});

test("L2: mining refuses bad payments before doing any work", () => {
  const n = fresh();
  assert.throws(() => n.mine([pay(ram, 101, 0)]), /insufficient balance/);
  assert.equal(n.tip.height, 0);
});

test("A4: the orphan pool is bounded", () => {
  const n = fresh();
  for (let i = 0; i < MAX_ORPHANS + 50; i++) {
    const header = { version: 1, chainId: CHAIN, height: 7, prevHash: i.toString(16).padStart(64, "0"), merkleRoot: txRoot([]), timestamp: 1, bits: 8, nonce: 0 };
    const b = mineBlock(header, []);
    n.receive(b);
  }
  assert.equal(n.orphanCount, MAX_ORPHANS);
});

test("M2: a payment with a getter cannot change after the block is accepted (node stays usable)", () => {
  const n = fresh();
  const real = pay(ram, 1, 0);
  let honest = true;
  const tricky = { ...real };
  Object.defineProperty(tricky, "amount", { enumerable: true, get: () => (honest ? 1 : 100) });
  const b = mineOn(n, n.tip.hash, [tricky]);
  assert.equal(n.receive(b).status, "added");
  honest = false; // v2: from now on every replay of the chain failed, and so did every new block
  assert.ok(Object.isFrozen(n.getBlock(b.hash).txs[0]));
  assert.equal(n.ledgerAt().balanceOf(ram.address), 1);
  assert.equal(n.mine([pay(ram, 2, 1)], 5).header.height, 2);
});

test("receive never throws, whatever it is given", () => {
  const n = fresh();
  fc.assert(fc.property(fc.anything(), (x) => {
    assert.ok(["rejected", "orphan", "duplicate", "added"].includes(n.receive(x).status));
  }), { numRuns: 500 });
  for (const x of [null, [], { header: null, txs: [] }, { header: {}, txs: {} }]) assert.equal(n.receive(x).status, "rejected");
});

test("a node's state cannot be changed from outside", () => {
  const n = fresh();
  assert.throws(() => { n.tip = "x"; }, TypeError);
  assert.throws(() => { n.receive = () => ({ status: "added" }); }, TypeError);
  assert.throws(() => { Node.prototype.receive = () => {}; }, TypeError);
  assert.throws(() => { params.bits = 1; }, TypeError);
});
