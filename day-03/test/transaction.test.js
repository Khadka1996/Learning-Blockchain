"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { demoWallet } = require("../src/keys");
const T = require("../src/transaction");

const sita = demoWallet("sita");
const ram = demoWallet("ram");
const base = () => T.createTransfer(sita, { to: ram.address, amount: 5, nonce: 0, chainId: "lb-devnet" });

test("a fresh transfer verifies and names Sita's address as sender", () => {
  const v = T.verifyTransfer(base());
  assert.ok(v.ok);
  assert.equal(v.sender, sita.address);
  assert.match(v.id, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(base()));
});

test("the transaction id covers the contents, not the signature", () => {
  const a = base();
  const b = base(); // ECDSA signatures use a fresh random k, so the signature differs
  assert.notEqual(a.signature, b.signature);
  assert.equal(T.txId(a), T.txId(b));
});

test("B2 property: changing any signed field after signing is detected", () => {
  const mutations = {
    chainId: () => "lb-mainnet",
    from: () => ram.publicKey,
    to: () => demoWallet("mallory").address,
    amount: (v) => v + 1,
    nonce: (v) => v + 1,
    version: () => 2,
  };
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1e9 }), fc.nat(1e6), fc.constantFrom(...Object.keys(mutations)), (amount, nonce, field) => {
      const tx = T.createTransfer(sita, { to: ram.address, amount, nonce, chainId: "lb-devnet" });
      assert.ok(T.verifyTransfer(tx).ok);
      assert.equal(T.verifyTransfer({ ...tx, [field]: mutations[field](tx[field]) }).ok, false);
    }),
    { numRuns: 200 },
  );
});

test("B5/B10/B7: amounts must be safe whole numbers ≥ 1; recipient must be a real address", () => {
  for (const amount of [0, -1, 0.1, 1.5, NaN, Infinity, 2 ** 53, "5", 5n, null]) {
    assert.throws(() => T.createTransfer(sita, { to: ram.address, amount, nonce: 0, chainId: "lb-devnet" }), undefined, `amount ${String(amount)}`);
  }
  for (const to of ["hello", "__proto__", ram.address.toUpperCase(), ram.address.slice(2), "", null]) {
    assert.throws(() => T.createTransfer(sita, { to, amount: 1, nonce: 0, chainId: "lb-devnet" }));
  }
  for (const chainId of ["", "UPPER", "a".repeat(33), "has space", 1]) {
    assert.throws(() => T.createTransfer(sita, { to: ram.address, amount: 1, nonce: 0, chainId }));
  }
});

test("unexpected fields (not covered by the signature) are refused", () => {
  const v = T.verifyTransfer({ ...base(), memo: "please pay Mallory" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /unexpected field "memo"/);
});

test("verifyTransfer never throws on garbage", () => {
  for (const junk of [null, undefined, 1, "tx", [], {}, { ...base(), signature: 7 }]) {
    assert.equal(T.verifyTransfer(junk).ok, false);
  }
});

test("M1: verifyTransfer reads each field once and returns a frozen snapshot", () => {
  const signed = base();
  let reads = 0;
  const tricky = { ...signed };
  Object.defineProperty(tricky, "amount", { enumerable: true, get: () => (++reads === 1 ? 5 : 500) });
  const v = T.verifyTransfer(tricky);
  assert.ok(v.ok);
  assert.equal(reads, 1);
  assert.equal(v.tx.amount, 5);
  assert.ok(Object.isFrozen(v.tx));
});
