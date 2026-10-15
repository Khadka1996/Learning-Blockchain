// Day 01 — The avalanche effect
// Change ONE character in the input and roughly half of the 256 output bits flip.
// This is why you can't "tweak" a block's data without everyone noticing.
// Usage: node src/avalanche.js "Manish sends 10 coins" "Manish sends 11 coins"
//        node src/avalanche.js --stats 10000    (average over many random 1-char edits)
"use strict";

const { randomBytes } = require("crypto");
const { avalanche, HASH_BITS } = require("./lib");

/** Average bits flipped over `trials` random messages, each with one character changed. */
function stats(trials) {
  let total = 0;
  let min = HASH_BITS;
  let max = 0;
  for (let i = 0; i < trials; i++) {
    const msg = randomBytes(16).toString("hex"); // 32 random hex chars
    const pos = i % msg.length;
    const swapped = msg[pos] === "a" ? "b" : "a"; // guaranteed different character
    const edited = msg.slice(0, pos) + swapped + msg.slice(pos + 1);
    const { bits } = avalanche(msg, edited);
    total += bits;
    min = Math.min(min, bits);
    max = Math.max(max, bits);
  }
  return { trials, average: total / trials, min, max };
}

function main(argv) {
  if (argv[0] === "--stats") {
    const trials = Number(argv[1] || 10000);
    if (!Number.isInteger(trials) || trials < 1 || trials > 1e7) {
      throw new RangeError("trials must be a whole number from 1 to 10,000,000");
    }
    const s = stats(trials);
    console.log(`Random 1-character edits : ${s.trials.toLocaleString("en-US")}`);
    console.log(`Average bits flipped     : ${s.average.toFixed(2)} / 256 (${((s.average / 256) * 100).toFixed(2)}%)`);
    console.log(`Fewest / most flipped    : ${s.min} / ${s.max}`);
    return;
  }
  const [a = "Manish sends 10 coins", b = "Manish sends 11 coins"] = argv;
  const r = avalanche(a, b);
  console.log(`A: ${JSON.stringify(a)}\n   ${r.hashA}`);
  console.log(`B: ${JSON.stringify(b)}\n   ${r.hashB}`);
  console.log(`\nBits changed: ${r.bits} / 256 (${r.percent.toFixed(1)}%)`);
  console.log("A good hash flips ~50% of bits for any tiny input change.");
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error("Error:", e.message);
    process.exitCode = 1;
  }
}

module.exports = { stats, main };
