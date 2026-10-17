// Tests for the Day 03 exercise solutions.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { demoWallet } = require("../../../src/keys");
const { createTransfer, signingBytes } = require("../../../src/transaction");
const { Ledger } = require("../../../src/ledger");
const note = require("../signed-note");
const { selectForBlock, run: runPool } = require("../pending-pool");
const { makePolicy, vaultAddress, Vault, run: runVault } = require("../multisig");

const CHAIN = "lb-devnet";
const [sita, ram, hari, mallory] = ["sita", "ram", "hari", "mallory"].map(demoWallet);
const pay = (w, to, amount, nonce, chainId = CHAIN) => createTransfer(w, { to: to.address, amount, nonce, chainId });

test("easy: a note verifies only unchanged, only with the signer's key, and never as a payment", () => {
  assert.deepEqual(note.run(), { original: true, edited: false, wrongKey: false, noteSigAsPayment: false });
  // and the other way round: a payment signature is not a note signature
  const tx = pay(sita, ram, 1, 0);
  assert.equal(note.verifyNote(sita.publicKey, signingBytes(tx).toString(), tx.signature), false);
  for (const bad of ["", "x".repeat(281), "\ud800", 5]) assert.throws(() => note.signNote(sita, bad), TypeError);
  assert.equal(note.verifyNote(sita.publicKey, "", "00"), false); // never throws
});

test("medium: the selected payments are accepted by applyAll; gaps wait, replays are dropped", () => {
  const r = runPool();
  assert.equal(r.selected.length, 3);
  assert.deepEqual([sita, ram, hari].map((w) => r.ledger.balanceOf(w.address)), [65, 20, 15]);
  assert.deepEqual(r.dropped.map((d) => d.index), [3]);
  assert.deepEqual(r.waiting, [{ index: 4, reason: "waiting for nonce 2" }]);
  // already-used nonces, wrong chain and bad signatures are dropped; not enough coins waits
  const L = new Ledger(CHAIN, { [sita.address]: 10 });
  L.apply(pay(sita, ram, 1, 0));
  const res = selectForBlock(L, [pay(sita, ram, 1, 0), pay(sita, ram, 1, 1, "lb-testnet"), { ...pay(sita, ram, 2, 1), amount: 3 }, pay(sita, ram, 50, 1)]);
  assert.equal(res.selected.length, 0);
  assert.deepEqual(res.dropped.map((d) => d.index), [0, 1, 2]);
  assert.deepEqual(res.waiting, [{ index: 3, reason: "not enough coins yet" }]);
  assert.throws(() => selectForBlock(L, "nope"), TypeError);
});

test("medium property: whatever order 6 payments arrive in, the selection always applies cleanly", () => {
  const txs = [pay(sita, ram, 30, 0), pay(sita, hari, 5, 1), pay(ram, hari, 10, 0), pay(ram, sita, 5, 1), pay(hari, mallory, 15, 0), pay(sita, ram, 1, 2)];
  for (let seed = 1; seed <= 50; seed++) {
    const shuffled = [...txs].sort((a, b) => ((a.signature.charCodeAt(seed % 128) * seed) % 17) - ((b.signature.charCodeAt(seed % 128) * seed) % 17));
    const L = new Ledger(CHAIN, { [sita.address]: 100 });
    const r = selectForBlock(L, shuffled);
    assert.doesNotThrow(() => L.applyAll(r.selected));
    assert.equal(r.selected.length, 6);
    assert.equal(L.sumOfBalances(), 100);
  }
});

test("challenge: 2-of-3 vault needs two DIFFERENT owners signing the exact payment, once", () => {
  const { vault, results } = runVault();
  assert.deepEqual(results, [false, false, false, false, true, false]);
  assert.equal(vault.balance, 60);
  assert.equal(vault.nonce, 1);
});

test("challenge: policy and address rules", () => {
  const keys = [sita.publicKey, ram.publicKey, hari.publicKey];
  // key order does not matter, threshold does
  assert.equal(vaultAddress(makePolicy(2, keys)), vaultAddress(makePolicy(2, [...keys].reverse())));
  assert.notEqual(vaultAddress(makePolicy(2, keys)), vaultAddress(makePolicy(1, keys)));
  assert.throws(() => makePolicy(0, keys), RangeError);
  assert.throws(() => makePolicy(4, keys), RangeError);
  assert.throws(() => makePolicy(2, [sita.publicKey, sita.publicKey]), RangeError);
  assert.throws(() => makePolicy(1, ["02" + "00".repeat(32)]), TypeError);
  const v = new Vault(CHAIN, makePolicy(2, keys), 10);
  const p = { to: ram.address, amount: 5, nonce: 0 };
  // a vault on another chain has the same address but a different signed message
  const other = new Vault("lb-testnet", makePolicy(2, keys), 10);
  assert.throws(() => v.spend(p, [other.approve(sita, p), other.approve(ram, p)]), /does not match/);
  assert.throws(() => v.spend(p, [v.approve(sita, p), v.approve(ram, p), v.approve(hari, p), v.approve(hari, p)]), /more approvals than owners/);
  assert.throws(() => v.spend({ ...p, amount: 11 }, [v.approve(sita, { ...p, amount: 11 }), v.approve(ram, { ...p, amount: 11 })]), /insufficient/);
  assert.throws(() => { v.chainId = "x"; }, TypeError);
  assert.equal(v.spend(p, [v.approve(hari, p), v.approve(sita, p)]).amount, 5);
});
