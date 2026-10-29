"use strict";
// Exercise 1 — how many of the 256 fingerprint bits change when one letter changes?
const Cert = require("../../src/certificate");

function popcount(n) {
  let c = 0;
  while (n > 0n) {
    c += Number(n & 1n);
    n >>= 1n;
  }
  return c;
}

/** Number of differing bits between the fingerprints of two certificates (0..256). */
function bitsChanged(a, b) {
  return popcount(BigInt(Cert.hash(a)) ^ BigInt(Cert.hash(b)));
}

module.exports = { bitsChanged, popcount };

if (require.main === module) {
  const base = { registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3", chainId: 31337, issuer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", id: "LB-001", recipient: "Manish Khadka", course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29" };
  const a = Cert.create(base);
  const b = { ...a, recipient: "Manish Khadkq" }; // ONE letter changed, same salt
  const reordered = Object.fromEntries(Object.entries(a).reverse()); // same data, keys in the opposite order
  console.log(`one letter changed  -> ${bitsChanged(a, b)} of 256 bits differ`);
  console.log(`keys reordered      -> ${bitsChanged(a, reordered)} of 256 bits differ (canonical JSON)`);
}
