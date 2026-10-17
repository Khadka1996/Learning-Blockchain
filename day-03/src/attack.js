// Day 03 — Mallory (the attacker) tries to steal from Sita. Every attempt must be refused.
"use strict";

const { demoWallet, N } = require("./keys");
const { createTransfer } = require("./transaction");
const { Ledger } = require("./ledger");

const CHAIN = "lb-devnet";

/** Thrown by an attack that checks its own result and finds it WORKED. */
class Breach extends Error {}

/** Each attack gets a fresh ledger where Sita owns 100 coins. Returns [{ name, refused, reason }]. */
function runAttacks() {
  const sita = demoWallet("sita");
  const ram = demoWallet("ram");
  const mallory = demoWallet("mallory");
  const fresh = () => new Ledger(CHAIN, { [sita.address]: 100 });
  const pay = (w, amount, nonce = 0, chainId = CHAIN, to = ram.address) => createTransfer(w, { to, amount, nonce, chainId });

  const attacks = [
    ["Sign as Sita with Mallory's own key", (L) => L.apply({ ...pay(mallory, 50, 0, CHAIN, mallory.address), from: sita.publicKey })],
    ["Change 5 coins to 50 after Sita signed", (L) => L.apply({ ...pay(sita, 5), amount: 50 })],
    ["Redirect Sita's payment to Mallory", (L) => L.apply({ ...pay(sita, 5), to: mallory.address })],
    ["Replay the same signed payment twice", (L) => { const tx = pay(sita, 40); L.apply(tx); L.apply(tx); }],
    ["Replay a testnet signature on this chain", (L) => L.apply(pay(sita, 10, 0, "lb-testnet"))],
    ["Flip s → n − s (a second valid-looking signature)", (L) => {
      const tx = pay(sita, 5);
      const s = BigInt("0x" + tx.signature.slice(64));
      L.apply({ ...tx, signature: tx.signature.slice(0, 64) + (N - s).toString(16).padStart(64, "0") });
    }],
    ["Spend more than the balance", (L) => L.apply(pay(sita, 101))],
    ["Send 0.1 coins (fractions)", (L) => L.apply(pay(sita, 0.1))],
    ["Send 2^53 + 1 coins (precision loss)", (L) => L.apply(pay(sita, 2 ** 53 + 1))],
    ["Pay to a fake address \"__proto__\"", (L) => L.apply(pay(sita, 1, 0, CHAIN, "__proto__"))],
    ["Batch: 1 good + 1 bad payment, hope half sticks", (L) => L.applyAll([pay(sita, 60, 0), pay(sita, 60, 1)])],
    ["Garbage public key", (L) => L.apply({ ...pay(sita, 1), from: "02" + "ff".repeat(32) })],
    ["Getter: amount reads 1 when checked, 100 when paid", (L) => {
      const signed = pay(sita, 1);
      let reads = 0;
      const tricky = { ...signed };
      Object.defineProperty(tricky, "amount", { enumerable: true, get: () => (++reads > 4 ? 100 : 1) });
      L.apply(tricky);
      if (L.balanceOf(ram.address) !== 1) throw new Breach(`Sita signed for 1 coin, ledger paid ${L.balanceOf(ram.address)}`);
      return "ledger paid exactly the 1 coin Sita signed for (fields are read once, then frozen)";
    }],
  ];

  return attacks.map(([name, fn]) => {
    const L = fresh();
    const before = L.balanceOf(sita.address);
    try {
      const defended = fn(L);
      if (typeof defended === "string") return { name, refused: true, reason: defended };
      return { name, refused: false, reason: `ACCEPTED (Sita now has ${L.balanceOf(sita.address)} of ${before})` };
    } catch (e) {
      if (e instanceof Breach) return { name, refused: false, reason: `GOT THROUGH: ${e.message}` };
      return { name, refused: true, reason: e.message };
    }
  });
}

module.exports = { runAttacks };

if (require.main === module) {
  const results = runAttacks();
  results.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.refused ? "REFUSED " : "ACCEPTED"} ${r.name}\n      → ${r.reason}`));
  const refused = results.filter((r) => r.refused).length;
  console.log(`\nMallory tried ${results.length} attacks: ${refused} refused, ${results.length - refused} got through.`);
  if (refused !== results.length) process.exitCode = 1;
}
