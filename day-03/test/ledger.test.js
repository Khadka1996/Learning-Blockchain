"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { demoWallet } = require("../src/keys");
const { createTransfer } = require("../src/transaction");
const { Ledger } = require("../src/ledger");
const { run } = require("../src/demo");
const { runAttacks } = require("../src/attack");

const CHAIN = "lb-devnet";
const [sita, ram, hari, gita] = ["sita", "ram", "hari", "gita"].map(demoWallet);
const pay = (w, to, amount, nonce, chainId = CHAIN) => createTransfer(w, { to: to.address, amount, nonce, chainId });

test("demo: 100 coins → Sita 70, Ram 20, Hari 10; supply unchanged", () => {
  const { ledger } = run();
  assert.deepEqual([sita, ram, hari].map((w) => ledger.balanceOf(w.address)), [70, 20, 10]);
  assert.equal(ledger.sumOfBalances(), 100);
});

test("B3: the same signed payment cannot be applied twice (nonce)", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  const tx = pay(sita, ram, 40, 0);
  L.apply(tx);
  assert.throws(() => L.apply(tx), /already used \(replay\)/);
  assert.throws(() => L.apply(pay(sita, ram, 1, 5)), /ahead of expected 1/);
  assert.equal(L.balanceOf(ram.address), 40);
  assert.equal(L.nonceOf(sita.address), 1);
});

test("B8: a signature made for another chain is refused", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  assert.throws(() => L.apply(pay(sita, ram, 10, 0, "lb-testnet")), /cross-chain replay/);
});

test("overdraft is refused and leaves the state untouched", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  assert.throws(() => L.apply(pay(sita, ram, 101, 0)), /insufficient balance/);
  assert.equal(L.balanceOf(sita.address), 100);
  assert.equal(L.nonceOf(sita.address), 0);
});

test("B6: a batch is all-or-nothing", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  assert.throws(() => L.applyAll([pay(sita, ram, 60, 0), pay(sita, ram, 60, 1)]), /transaction 1 rejected.*nothing was applied/);
  assert.equal(L.balanceOf(sita.address), 100);
  assert.equal(L.nonceOf(sita.address), 0);
  assert.equal(L.applyAll([pay(sita, ram, 60, 0), pay(ram, hari, 60, 0)]).length, 2);
  assert.equal(L.balanceOf(hari.address), 60);
});

test("B11: genesis and recipients cannot use prototype keys; Map storage", () => {
  assert.throws(() => new Ledger(CHAIN, JSON.parse('{"__proto__": 5}')));
  assert.throws(() => new Ledger(CHAIN, { [sita.address]: 0.5 }));
  assert.throws(() => new Ledger(CHAIN, { [sita.address]: Number.MAX_SAFE_INTEGER, [ram.address]: 1 }), /too large/);
  assert.throws(() => new Ledger("Bad Chain"));
});

test("M1: a getter cannot change the amount between check and payment", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  let reads = 0;
  const tricky = { ...pay(sita, ram, 1, 0) };
  Object.defineProperty(tricky, "amount", { enumerable: true, get: () => (++reads > 1 ? 100 : 1) });
  L.apply(tricky);
  assert.equal(L.balanceOf(ram.address), 1);
  assert.equal(L.balanceOf(sita.address), 99);
});

test("self-payment keeps the balance and bumps the nonce", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 10 });
  L.apply(pay(sita, sita, 10, 0));
  assert.equal(L.balanceOf(sita.address), 10);
  assert.equal(L.nonceOf(sita.address), 1);
});

test("invariant (fuzz): random valid and invalid payments never create or destroy coins", () => {
  const wallets = [sita, ram, hari, gita];
  const step = fc.record({ from: fc.nat(3), to: fc.nat(3), amount: fc.integer({ min: 1, max: 80 }), nonceSkew: fc.constantFrom(0, 0, 0, -1, 1), wrongChain: fc.boolean() });
  fc.assert(
    fc.property(fc.array(step, { maxLength: 25 }), (steps) => {
      const L = new Ledger(CHAIN, { [sita.address]: 100, [ram.address]: 50 });
      for (const s of steps) {
        const w = wallets[s.from];
        const before = L.nonceOf(w.address);
        const tx = pay(w, wallets[s.to], s.amount, Math.max(0, before + s.nonceSkew), s.wrongChain && s.amount % 4 === 0 ? "lb-testnet" : CHAIN);
        try { L.apply(tx); } catch { /* refused: fine */ }
        assert.equal(L.sumOfBalances(), 150);
        for (const x of wallets) assert.ok(L.balanceOf(x.address) >= 0);
        assert.ok(L.nonceOf(w.address) - before <= 1);
      }
    }),
    { numRuns: 60 },
  );
});

test("attack script: all 13 of Mallory's attacks are refused", () => {
  const results = runAttacks();
  assert.equal(results.length, 13);
  for (const r of results) assert.ok(r.refused, `${r.name}: ${r.reason}`);
});
