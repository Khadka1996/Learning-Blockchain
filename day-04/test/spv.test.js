// Day 04 (evening) — light client (SPV) tests.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { Node, makeParams } = require("../src/node");
const { mineBlock } = require("../src/block");
const { LightClient, proveTx } = require("../src/spv");

const CHAIN = "lb-devnet";
const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
const params = makeParams({ chainId: CHAIN, bits: 8, genesis: { [sita.address]: 1000 } });
const clock = () => 10_000;
const pay = (to, amount, nonce) => createTransfer(sita, { to: to.address, amount, nonce, chainId: CHAIN });

function setup() {
  const full = new Node("F", params, { clock });
  const b1 = full.mine([pay(hari, 1, 0), pay(ram, 25, 1), pay(hari, 2, 2)], 1);
  full.mine([pay(hari, 3, 3)], 2);
  full.mine([], 3);
  const phone = new LightClient(params, { clock });
  for (const h of full.chain().slice(1)) assert.equal(phone.addHeader(full.getBlock(h).header).status, "added");
  return { full, phone, b1 };
}

test("spv: the phone follows the same tip and counts confirmations", () => {
  const { full, phone, b1 } = setup();
  assert.equal(phone.tip.hash, full.tip.hash);
  const r = phone.verifyPayment(b1.txs[1], proveTx(b1, 1), b1.hash);
  assert.deepEqual(r, { ok: true, confirmations: 3 });
});

test("spv: wrong amount, wrong position, wrong block, unknown block → refused", () => {
  const { full, phone, b1 } = setup();
  const proof = proveTx(b1, 1);
  assert.equal(phone.verifyPayment(pay(ram, 250, 1), proof, b1.hash).ok, false);
  assert.equal(phone.verifyPayment(b1.txs[1], proveTx(b1, 0), b1.hash).ok, false);
  assert.equal(phone.verifyPayment(b1.txs[1], proof, full.tip.hash).ok, false);
  assert.match(phone.verifyPayment(b1.txs[1], proof, "ab".repeat(32)).reason, /unknown block/);
  // Same payment, re-signed: different signature → different leaf → the proof does not fit (E1).
  assert.equal(phone.verifyPayment(pay(ram, 25, 1), proof, b1.hash).ok, false);
});

test("spv: headers need the network's difficulty, real work and a known parent", () => {
  const { full, phone } = setup();
  const tip = full.getBlock(full.tip.hash);
  const easy = mineBlock({ chainId: CHAIN, height: 4, prevHash: tip.hash, timestamp: 4, bits: 1 }, []);
  assert.match(phone.addHeader(easy.header).reason, /difficulty/);
  const orphan = mineBlock({ chainId: CHAIN, height: 9, prevHash: "ab".repeat(32), timestamp: 4, bits: 8 }, []);
  assert.match(phone.addHeader(orphan.header).reason, /unknown parent/);
  const ok = mineBlock({ chainId: CHAIN, height: 4, prevHash: tip.hash, timestamp: 4, bits: 8 }, []);
  assert.equal(phone.addHeader(ok.header).status, "added");
  assert.equal(phone.addHeader(ok.header).status, "duplicate");
});

test("spv: a payment in a block that lost the fork is not counted; it counts again if its branch wins", () => {
  const { full, phone } = setup();
  const g = params.genesisBlock;
  const side1 = mineBlock({ chainId: CHAIN, height: 1, prevHash: g.hash, timestamp: 5, bits: 8 }, [pay(ram, 7, 0)]);
  phone.addHeader(side1.header);
  const r = phone.verifyPayment(side1.txs[0], proveTx(side1, 0), side1.hash);
  assert.match(r.reason, /not on the best chain/);
  // Build the side branch past the main one: 4 blocks > 3 blocks of work.
  let prev = side1;
  for (let h = 2; h <= 4; h++) {
    prev = mineBlock({ chainId: CHAIN, height: h, prevHash: prev.hash, timestamp: 5 + h, bits: 8 }, []);
    phone.addHeader(prev.header);
  }
  assert.notEqual(phone.tip.hash, full.tip.hash);
  assert.deepEqual(phone.verifyPayment(side1.txs[0], proveTx(side1, 0), side1.hash), { ok: true, confirmations: 4 });
});

test("spv: addHeader and verifyPayment never throw on junk", () => {
  const { phone, b1 } = setup();
  fc.assert(
    fc.property(fc.anything(), fc.anything(), fc.anything(), (a, b, c) => {
      assert.doesNotThrow(() => phone.addHeader(a));
      assert.doesNotThrow(() => phone.verifyPayment(a, b, c));
      assert.doesNotThrow(() => phone.verifyPayment(b1.txs[1], b, c));
    }),
    { numRuns: 300, seed: 4 },
  );
});

test("spv demo runs and reports the real numbers", () => {
  const r = require("../src/spv-demo").run({ blocks: 6, perBlock: 8, quiet: true });
  assert.equal(r.ok, true);
  assert.equal(r.confirmations, 2);
  assert.equal(r.proofHashes, 3);
  assert.equal(r.lie, false);
  assert.equal(r.stale, false);
  assert.equal(r.fake, "rejected");
  assert.ok(r.fullBytes > 5 * r.headerBytes);
});
