// Day 01 — Why hashes are one-way (preimage resistance)
// Brute-force: find any input whose hash starts with N zero hex digits.
// Each extra zero makes it ~16x harder. Reversing a FULL 64-char hash is
// effectively impossible — this same idea becomes Proof of Work on Day 02.
// Usage: node src/preimage.js 5          (1–8 zeros; input is validated)
//        node src/preimage.js --table 5  (difficulty table for 1..5 zeros: real vs expected attempts)
"use strict";

const { findLeadingZeros, parseZeros } = require("./lib");

/** Run the search for 1..maxZeros leading zeros and return one row per difficulty level. */
function difficultyTable(maxZeros, options) {
  const top = parseZeros(maxZeros);
  const rows = [];
  for (let z = 1; z <= top; z++) {
    const start = process.hrtime.bigint();
    const r = findLeadingZeros(z, options);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    rows.push({ zeros: z, found: r.found, attempts: r.attempts, expected: r.expected, ratio: r.attempts / r.expected, ms });
  }
  return rows;
}

function printTable(rows) {
  const n = (x) => x.toLocaleString("en-US");
  console.log("Zeros | Attempts (this run) | Expected avg | Ratio |   Time");
  console.log("------|--------------------:|-------------:|------:|-------:");
  for (const r of rows) {
    const attempts = r.found ? n(r.attempts) : `>${n(r.attempts)}`;
    console.log(
      `${String(r.zeros).padStart(5)} | ${attempts.padStart(19)} | ${n(r.expected).padStart(12)} | ${r.ratio.toFixed(2).padStart(5)} | ${`${Math.round(r.ms)} ms`.padStart(7)}`
    );
  }
  console.log("\nEach extra zero → ~16× more guesses on average. Single runs vary a lot (luck),");
  console.log("but there is never a shortcut: this is the work in Proof of Work.");
}

function main(argv) {
  if (argv[0] === "--table") {
    printTable(difficultyTable(argv[1] ?? 5));
    return;
  }
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

module.exports = { main, difficultyTable };
