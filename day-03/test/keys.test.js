"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const util = require("node:util");
const fc = require("fast-check");
const K = require("../src/keys");

const hex64 = (big) => big.toString(16).padStart(64, "0");
const G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // the curve's generator point

test("known answer: private key 1 → generator point G; n − 1 → −G", () => {
  assert.equal(K.walletFromPrivateKey(hex64(1n)).publicKey, G);
  assert.equal(K.walletFromPrivateKey(hex64(K.N - 1n)).publicKey, "03" + G.slice(2));
});

test("private keys outside 1 … n − 1 or badly formatted are refused", () => {
  for (const bad of [hex64(0n), hex64(K.N), "ff".repeat(32), "1", "AB".repeat(32), 5, null]) {
    assert.throws(() => K.walletFromPrivateKey(bad));
  }
});

test("demo wallets are deterministic; addresses are 40 hex and derived from the public key", () => {
  const a = K.demoWallet("sita");
  assert.equal(a.address, K.demoWallet("sita").address);
  assert.notEqual(a.address, K.demoWallet("ram").address);
  assert.match(a.address, /^[0-9a-f]{40}$/);
  assert.equal(K.addressFromPublicKey(a.publicKey), a.address);
});

test("the private key never appears in JSON or console output", () => {
  const w = K.walletFromPrivateKey(hex64(123456789n));
  const shown = JSON.stringify(w) + util.inspect(w) + String(Object.keys(w));
  assert.ok(!shown.includes(hex64(123456789n)));
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(w))).sort(), ["address", "publicKey"]);
  assert.ok(Object.isFrozen(w));
});

test("property: a signature verifies for its own key and message, and for nothing else", () => {
  const sita = K.demoWallet("sita");
  const ram = K.demoWallet("ram");
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), fc.nat(), (bytes, pos) => {
      const msg = Buffer.from(bytes);
      const sig = sita.sign(msg);
      assert.ok(K.verifySignature(sita.publicKey, msg, sig));
      assert.ok(!K.verifySignature(ram.publicKey, msg, sig)); // wrong key
      const flipped = Buffer.from(msg);
      flipped[pos % flipped.length] ^= 1 << (pos % 8); // one bit changed
      assert.ok(!K.verifySignature(sita.publicKey, flipped, sig));
    }),
    { numRuns: 200 },
  );
});

test("B4: signatures are always low-S, and the high-S twin (r, n − s) is refused", () => {
  const w = K.demoWallet("sita");
  for (let i = 0; i < 200; i++) {
    const msg = Buffer.from(`payment ${i}`);
    const sig = w.sign(msg);
    const s = BigInt("0x" + sig.slice(64));
    assert.ok(s <= K.HALF_N, "signer must output low-S");
    const twin = sig.slice(0, 64) + hex64(K.N - s);
    assert.ok(!K.verifySignature(w.publicKey, msg, twin), "high-S twin must be refused");
  }
});

test("degenerate or malformed signatures never verify and never throw", () => {
  const w = K.demoWallet("sita");
  const msg = Buffer.from("x");
  const sig = w.sign(msg);
  const cases = ["0".repeat(128), sig.slice(0, 64) + "0".repeat(64), "0".repeat(64) + sig.slice(64), hex64(K.N) + sig.slice(64), sig.toUpperCase(), sig.slice(2), "", null, 42];
  for (const bad of cases) assert.equal(K.verifySignature(w.publicKey, msg, bad), false);
});

test("B9: public keys that are not exactly one valid compressed curve point are refused cleanly", () => {
  const bad = ["02" + "00".repeat(31) + "07", "02" + "ff".repeat(32), "04" + G.slice(2) + "00".repeat(32), G.toUpperCase(), G.slice(0, 64), "zz", null];
  for (const k of bad) {
    assert.throws(() => K.addressFromPublicKey(k), TypeError);
    assert.equal(K.verifySignature(k, Buffer.from("x"), "00".repeat(64)), false);
  }
});

test("generateWallet gives fresh, working keys", () => {
  const a = K.generateWallet();
  const b = K.generateWallet();
  assert.notEqual(a.address, b.address);
  assert.ok(K.verifySignature(a.publicKey, Buffer.from("hi"), a.sign(Buffer.from("hi"))));
});
