// Day 01 — SHA-256 basics
// Usage: node src/hash.js "any text you like"
"use strict";

const { sha256Hex, HASH_HEX_LENGTH } = require("./lib");

function main(argv) {
  // Only fall back to the demo text when NO argument is given: `hash.js ""` must hash "" (audit E3).
  const input = argv.length > 0 ? argv.join(" ") : "Hello, Blockchain!";
  const hash = sha256Hex(input);

  console.log("Input :", JSON.stringify(input));
  console.log("SHA256:", hash);
  console.log("Length:", hash.length, "hex chars =", hash.length * 4, "bits");

  // Property 1: deterministic — same input, same output, every time
  console.log("\nDeterministic?", sha256Hex(input) === hash ? "yes ✅" : "no ❌");

  // Property 2: fixed size — a 1-char input and a 10,000-char input both give 256 bits
  const tiny = sha256Hex("a");
  const huge = sha256Hex("a".repeat(10000));
  const fixed = tiny.length === HASH_HEX_LENGTH && huge.length === HASH_HEX_LENGTH;
  console.log("Fixed size?   ", fixed ? "yes ✅ (1 char and 10,000 chars → both 64 hex chars)" : "no ❌");
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main };
