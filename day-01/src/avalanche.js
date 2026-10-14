// Day 01 — The avalanche effect
// Change ONE character in the input and roughly half of the 256 output bits flip.
// This is why you can't "tweak" a block's data without everyone noticing.
// Usage: node src/avalanche.js "Manish sends 10 coins" "Manish sends 11 coins"
const { createHash } = require("crypto");

const sha256Buf = (s) => createHash("sha256").update(s).digest();

function bitsDifferent(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      diff += x & 1;
      x >>= 1;
    }
  }
  return diff;
}

const [a = "Manish sends 10 coins", b = "Manish sends 11 coins"] = process.argv.slice(2);
const ha = sha256Buf(a);
const hb = sha256Buf(b);
const diff = bitsDifferent(ha, hb);

console.log(`A: ${JSON.stringify(a)}\n   ${ha.toString("hex")}`);
console.log(`B: ${JSON.stringify(b)}\n   ${hb.toString("hex")}`);
console.log(`\nBits changed: ${diff} / 256 (${((diff / 256) * 100).toFixed(1)}%)`);
console.log("A good hash flips ~50% of bits for any tiny input change.");
