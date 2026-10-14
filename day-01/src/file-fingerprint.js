// Day 01 — Hashes as fingerprints
// Hash any file. If even one byte changes, the fingerprint changes completely.
// Blockchains use this to prove data hasn't been tampered with.
// Usage: node src/file-fingerprint.js path/to/file
const { createHash } = require("crypto");
const fs = require("fs");

const file = process.argv[2] || __filename;
const hash = createHash("sha256");

fs.createReadStream(file)
  .on("data", (chunk) => hash.update(chunk))
  .on("end", () => {
    console.log(`File       : ${file}`);
    console.log(`Size       : ${fs.statSync(file).size} bytes`);
    console.log(`Fingerprint: ${hash.digest("hex")}`);
  })
  .on("error", (e) => console.error("Could not read file:", e.message));
