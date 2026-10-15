// Day 01 — Why hashes are one-way (preimage resistance)
// Brute-force: find any input whose hash starts with N zero hex digits.
// Each extra zero makes it ~16x harder. Reversing a FULL 64-char hash is
// effectively impossible — this same idea becomes Proof of Work on Day 02.
// Usage: node src/preimage.js 5        (1–8 zeros; input is validated)
"use strict";

const { findLeadingZeros, parseZeros } = require("./lib");

function main(argv) {
  const zeros = parseZeros(argv[0] ?? 4);
  const start = process.hrtime.bigint();
  const r = findLeadingZeros(zeros);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;

  console.log(`Target prefix : ${"0".repeat(zeros)}`);
  if (!r.found) {
    console.log(`No match within ${r.attempts.toLocaleString("en-US")} attempts.`);
    return;
  }
  console.log(`Found input   : "${r.input}"`);
  console.log(`Hash          : ${r.hash}`);
  console.log(`Attempts      : ${r.attempts.toLocaleString("en-US")} in ${Math.round(ms)} ms`);
  console.log(`Expected avg  : ~${r.expected.toLocaleString("en-US")} attempts`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error("Error:", e.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
