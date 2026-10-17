// Day 03 (evening) — how often does a checksummed address catch a one-character typo?
"use strict";

const { toChecksumAddress, parseAddress } = require("./keys");

const HEX = "0123456789abcdef";

/** Small seeded PRNG (mulberry32) so the experiment gives the same numbers on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `trials` random addresses; in each, change ONE character to a different hex digit (typed in
 * lower or upper case at random) and see whether parseAddress refuses it.
 * Without a checksum every one of these typos would be accepted and the coins sent to nobody.
 */
function typoExperiment(trials = 10000, seed = 2026) {
  const rand = rng(seed);
  const pick = (s) => s[Math.floor(rand() * s.length)];
  let caught = 0;
  for (let t = 0; t < trials; t++) {
    let addr = "";
    for (let i = 0; i < 40; i++) addr += pick(HEX);
    const cs = toChecksumAddress(addr);
    const pos = Math.floor(rand() * 40);
    let c;
    do c = pick(HEX); while (c === addr[pos]);
    if (rand() < 0.5) c = c.toUpperCase();
    const typo = cs.slice(0, pos) + c + cs.slice(pos + 1);
    try {
      parseAddress(typo);
    } catch {
      caught++;
    }
  }
  return { caught, total: trials };
}

module.exports = { typoExperiment };

if (require.main === module) {
  const { caught, total } = typoExperiment();
  const sita = "aa8a5b204a46be63be0862c239ac0911e70f9cab";
  console.log(`Sita's address        ${sita}`);
  console.log(`with checksum         ${toChecksumAddress(sita)}`);
  console.log(`\nOne-character typos tried: ${total.toLocaleString("en-US")}`);
  console.log(`caught by the checksum:    ${caught.toLocaleString("en-US")} (${((100 * caught) / total).toFixed(2)}%)`);
  console.log(`missed:                    ${(total - caught).toLocaleString("en-US")}`);
  console.log(`without a checksum:        0 caught, every typo sends coins to an address nobody owns`);
}
