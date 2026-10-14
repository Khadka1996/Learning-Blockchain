// Day 01 — Why hashes are one-way (preimage resistance)
// Brute-force: find any input whose hash starts with N zero hex digits.
// Each extra zero makes it ~16x harder. Reversing a FULL 64-char hash is
// effectively impossible — this same idea becomes Proof of Work on Day 03.
// Usage: node src/preimage.js 5
const { createHash } = require("crypto");

const zeros = Number(process.argv[2] || 4);
const target = "0".repeat(zeros);
const start = Date.now();

let nonce = 0;
let hash = "";
while (true) {
  hash = createHash("sha256").update(`manish-${nonce}`).digest("hex");
  if (hash.startsWith(target)) break;
  nonce++;
}

const ms = Date.now() - start;
console.log(`Target prefix : ${target}`);
console.log(`Found input   : "manish-${nonce}"`);
console.log(`Hash          : ${hash}`);
console.log(`Attempts      : ${(nonce + 1).toLocaleString()} in ${ms} ms`);
console.log(`Expected avg  : ~${(16 ** zeros).toLocaleString()} attempts`);
