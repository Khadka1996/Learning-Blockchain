"use strict";
// Exercise 1 (easy): the contract limits a message in BYTES, not characters.
const MAX_BYTES = 140;
const byteLength = (s) => new TextEncoder().encode(s).length;
const fits = (s) => byteLength(s) >= 1 && byteLength(s) <= MAX_BYTES;
/** Longest prefix of `s` (whole characters only) that fits in MAX_BYTES. */
function truncateToFit(s) {
  let out = "";
  for (const ch of s) { // iterates by code point, so an emoji is never cut in half
    if (byteLength(out + ch) > MAX_BYTES) break;
    out += ch;
  }
  return out;
}
module.exports = { byteLength, fits, truncateToFit, MAX_BYTES };
if (require.main === module) {
  for (const s of ["hello", "नमस्ते", "🔗".repeat(36), "a".repeat(200)]) {
    console.log(`${[...s].length} characters = ${byteLength(s)} bytes, fits: ${fits(s)}, truncated to ${byteLength(truncateToFit(s))} bytes`);
  }
}
