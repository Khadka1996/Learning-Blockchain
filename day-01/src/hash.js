// Day 01 — SHA-256 basics
// Usage: node src/hash.js "any text you like"
const crypto = require("crypto");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

const input = process.argv.slice(2).join(" ") || "Hello, Blockchain!";
const hash = sha256(input);

console.log("Input :", JSON.stringify(input));
console.log("SHA256:", hash);
console.log("Length:", hash.length, "hex chars =", hash.length * 4, "bits");

// Property 1: deterministic — same input, same output, every time
console.log("\nDeterministic?", sha256(input) === hash ? "yes ✅" : "no ❌");

// Property 2: fixed size — a 1-char input and a 10,000-char input both give 256 bits
const tiny = sha256("a");
const huge = sha256("a".repeat(10000));
console.log("Fixed size?   ", tiny.length === huge.length ? "yes ✅ (both 64 hex chars)" : "no ❌");

module.exports = { sha256 };
