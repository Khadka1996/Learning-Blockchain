// Evening audit — one failing-first regression test per finding (E1–E4), plus the checksum improvement.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const K = require("../src/keys");
const { createTransfer } = require("../src/transaction");
const { Ledger } = require("../src/ledger");
const { typoExperiment } = require("../src/typo");

const CHAIN = "lb-devnet";
const [sita, ram, mallory] = ["sita", "ram", "mallory"].map(K.demoWallet);
const pay = (w, to, amount, nonce, chainId = CHAIN) => createTransfer(w, { to: to.address, amount, nonce, chainId });

test("E1: ledger state cannot be changed without a signed transaction", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  // v1: L.balances.set(mallory, 1e6) minted coins; L.chainId = "lb-testnet" re-enabled cross-chain replay.
  assert.equal(L.balances, undefined, "balances must not be a public, mutable field");
  assert.equal(L.nonces, undefined, "nonces must not be a public, mutable field");
  assert.throws(() => { L.chainId = "lb-testnet"; }, TypeError);
  assert.throws(() => { L.totalSupply = 1e9; }, TypeError);
  assert.throws(() => { L.balanceOf = () => 1e9; }, TypeError);
  assert.throws(() => { Ledger.prototype.balanceOf = () => 1e9; }, TypeError);
  assert.equal(L.chainId, CHAIN);
  assert.equal(L.totalSupply, 100);
  assert.throws(() => L.apply(pay(sita, ram, 5, 0, "lb-testnet")), /cross-chain replay/);
  // The read-only view is a copy: editing it changes nothing.
  const view = L.accounts();
  view[0].balance = 1e9;
  assert.equal(L.balanceOf(sita.address), 100);
  assert.equal(L.balanceOf(mallory.address), 0);
});

test("E2: applyAll refuses holes and reads the list exactly once", () => {
  const L = new Ledger(CHAIN, { [sita.address]: 100 });
  const sparse = [pay(sita, ram, 5, 0)];
  sparse.length = 3; // v1 returned 1 id for a "3-transaction" batch and applied it
  assert.throws(() => L.applyAll(sparse), /transaction 1 is missing/);
  assert.equal(L.balanceOf(sita.address), 100);
  // A getter element is read once: it cannot pass the check and then become something else.
  let reads = 0;
  const tx = pay(sita, ram, 5, 0);
  const tricky = [];
  Object.defineProperty(tricky, 0, { enumerable: true, get: () => (++reads, tx) });
  L.applyAll(tricky);
  assert.equal(reads, 1);
  assert.equal(L.balanceOf(ram.address), 5);
});

test("E3: genesis must be a plain object of address → whole coins", () => {
  // v1: a Map was silently read as "no accounts" (supply 0); null crashed with a raw TypeError.
  assert.throws(() => new Ledger(CHAIN, new Map([[sita.address, 100]])), /genesis must be a plain object/);
  assert.throws(() => new Ledger(CHAIN, null), /genesis must be a plain object/);
  assert.throws(() => new Ledger(CHAIN, [100]), /genesis must be a plain object/);
  assert.equal(new Ledger(CHAIN, Object.assign(Object.create(null), { [sita.address]: 7 })).totalSupply, 7);
  assert.equal(new Ledger(CHAIN).totalSupply, 0);
});

test("E4: sign/verify take bytes or well-formed text only; verify never throws", () => {
  const sig = sita.sign(Buffer.from("hi"));
  // v1: [360, 361] was silently reduced mod 256 to the bytes of "hi" and verified as true.
  assert.equal(K.verifySignature(sita.publicKey, [360, 361], sig), false);
  assert.equal(K.verifySignature(sita.publicKey, [104, 105], sig), false);
  // v1: these threw a raw TypeError from Buffer.from although verify is documented as "never throws".
  for (const m of [5, null, undefined, {}, { length: 3 }]) assert.equal(K.verifySignature(sita.publicKey, m, sig), false);
  assert.equal(K.verifySignature(sita.publicKey, "hi", sig), true);
  assert.equal(K.verifySignature(sita.publicKey, new Uint8Array([104, 105]), sig), true);
  // v1: lone surrogates were replaced by U+FFFD, so a signature on "\ud800" also verified "\udc00".
  assert.throws(() => sita.sign("\ud800"), /well-formed/);
  const fffd = sita.sign("�");
  assert.equal(K.verifySignature(sita.publicKey, "\udc00", fffd), false);
  assert.throws(() => sita.sign(42), TypeError);
});

test("checked, not vulnerable: a compressed key with x ≥ p (an alias of a real x) is refused", () => {
  const p = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  const hex = (x) => "02" + x.toString(16).padStart(64, "0");
  assert.doesNotThrow(() => K.publicKeyObject(hex(1n))); // x = 1 is on the curve
  assert.throws(() => K.publicKeyObject(hex(1n + p)), /not a point/);
});

test("improvement: checksummed addresses round-trip and catch typos", () => {
  const cs = K.toChecksumAddress(sita.address);
  assert.equal(cs.toLowerCase(), sita.address);
  assert.notEqual(cs, sita.address, "a 40-hex address with letters gets mixed case");
  assert.equal(K.parseAddress(cs), sita.address);
  assert.equal(K.isChecksumAddress(cs), true);
  // Swap the case of one letter → caught.
  const i = [...cs].findIndex((c) => /[a-fA-F]/.test(c));
  const flipped = cs.slice(0, i) + (cs[i] === cs[i].toLowerCase() ? cs[i].toUpperCase() : cs[i].toLowerCase()) + cs.slice(i + 1);
  assert.throws(() => K.parseAddress(flipped), /checksum/);
  assert.throws(() => K.parseAddress(sita.address), /no checksum/);
  assert.equal(K.parseAddress(sita.address, { allowLowercase: true }), sita.address);
  for (const bad of ["", "0x" + cs, cs + "0", 7, null]) assert.throws(() => K.parseAddress(bad), TypeError);
});

test("improvement property: random one-character typos in a checksummed address are almost always caught", () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (bytes) => {
      const cs = K.toChecksumAddress(Buffer.from(bytes).toString("hex"));
      assert.equal(K.parseAddress(cs), Buffer.from(bytes).toString("hex"));
    }),
    { numRuns: 500 },
  );
  const { caught, total } = typoExperiment(2000, 7);
  assert.ok(caught / total > 0.99, `caught only ${caught}/${total}`);
});
