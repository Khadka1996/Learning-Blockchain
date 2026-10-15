// Day 01 — Hashes as fingerprints
// Hash any file. If even one byte changes, the fingerprint changes completely.
// Blockchains use this to prove data hasn't been tampered with.
// Usage: node src/file-fingerprint.js path/to/file [expected-hex]
//        (with expected-hex it verifies the file and exits 1 on mismatch)
"use strict";

const { hashFile } = require("./lib");

async function main(argv) {
  const file = argv[0] || __filename;
  const expected = argv[1]?.toLowerCase();
  if (expected !== undefined && !/^[0-9a-f]{64}$/.test(expected)) {
    throw new RangeError("expected fingerprint must be 64 hex characters");
  }
  const { bytes, hex } = await hashFile(file);
  console.log(`File       : ${file}`);
  console.log(`Size       : ${bytes.toLocaleString("en-US")} bytes`);
  console.log(`Fingerprint: ${hex}`);
  if (expected !== undefined) {
    const ok = expected === hex;
    console.log(`Verified   : ${ok ? "match ✅ — file is unchanged" : "MISMATCH ❌ — file was changed"}`);
    if (!ok) process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error("Could not fingerprint file:", e.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
