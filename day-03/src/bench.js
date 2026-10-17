// Day 03 — how fast is signing vs. verifying? (times depend on your CPU)
"use strict";

const { demoWallet, verifySignature } = require("./keys");

function bench(count = 2000) {
  const w = demoWallet("sita");
  const msgs = Array.from({ length: count }, (_, i) => Buffer.from(`Sita pays Ram ${i} coins`));
  let t = process.hrtime.bigint();
  const sigs = msgs.map((m) => w.sign(m));
  const signMs = Number(process.hrtime.bigint() - t) / 1e6;
  t = process.hrtime.bigint();
  const ok = msgs.every((m, i) => verifySignature(w.publicKey, m, sigs[i]));
  const verifyMs = Number(process.hrtime.bigint() - t) / 1e6;
  return { count, signMs, verifyMs, ok };
}

module.exports = { bench };

if (require.main === module) {
  const r = bench();
  console.log(`Signed   ${r.count} payments in ${r.signMs.toFixed(0)} ms  (${(r.signMs / r.count).toFixed(3)} ms each)`);
  console.log(`Verified ${r.count} payments in ${r.verifyMs.toFixed(0)} ms  (${(r.verifyMs / r.count).toFixed(3)} ms each), all valid: ${r.ok}`);
}
