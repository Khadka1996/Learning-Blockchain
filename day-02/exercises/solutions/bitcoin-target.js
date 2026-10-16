// Exercise 3 (challenge) — check Bitcoin's real Proof of Work: decode the compact "bits" field into a
// 256-bit target and verify that the genesis block's hash is below it.
"use strict";

const { createHash } = require("crypto");

// Genesis block header (80 bytes): version | prev hash | Merkle root | time | bits | nonce (from Day 01)
const GENESIS_HEADER_HEX =
  "01000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a" +
  "29ab5f49" +
  "ffff001d" +
  "1dac2b7c";

const sha256 = (b) => createHash("sha256").update(b).digest();

/**
 * Compact target ("nBits") → BigInt. Format: 1 byte exponent E, 3 bytes mantissa M;
 * target = M × 256^(E − 3). Bit 0x00800000 of M is a sign bit — negative targets are invalid.
 */
function compactToTarget(bits) {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xffffffff) throw new RangeError("bits must be a 32-bit unsigned integer");
  const exponent = bits >>> 24;
  const mantissa = bits & 0x007fffff;
  if (bits & 0x00800000 && mantissa !== 0) throw new RangeError("negative target (sign bit set)");
  const target = exponent <= 3 ? BigInt(mantissa >>> (8 * (3 - exponent))) : BigInt(mantissa) << BigInt(8 * (exponent - 3));
  if (target >= 1n << 256n) throw new RangeError("target overflows 256 bits");
  return target;
}

/** Verify an 80-byte header's Proof of Work. Returns { id, target, hashValue, ok, leadingZeroBits }. */
function checkHeaderPow(headerHex) {
  if (typeof headerHex !== "string" || !/^[0-9a-fA-F]{160}$/.test(headerHex)) throw new RangeError("a block header is exactly 80 bytes (160 hex characters)");
  const header = Buffer.from(headerHex, "hex");
  const target = compactToTarget(header.readUInt32LE(72));
  const digest = sha256(sha256(header)); // hash256 = double SHA-256
  const id = Buffer.from(digest).reverse().toString("hex"); // Bitcoin compares the hash as a little-endian number
  const hashValue = BigInt("0x" + id);
  return { id, target, hashValue, ok: hashValue <= target, leadingZeroBits: 256 - hashValue.toString(2).length };
}

function demo() {
  const r = checkHeaderPow(GENESIS_HEADER_HEX);
  console.log(`bits 0x1d00ffff → target ${r.target.toString(16).padStart(64, "0")}`);
  console.log(`genesis hash          ${r.id}`);
  console.log(`hash ≤ target?        ${r.ok}  (hash starts with ${r.leadingZeroBits} zero bits; the target needs 32)`);
  const forged = GENESIS_HEADER_HEX.slice(0, 152) + "1dac2b7d"; // nonce + 1
  console.log(`nonce + 1 → valid?    ${checkHeaderPow(forged).ok}`);
}

if (require.main === module) demo();

module.exports = { GENESIS_HEADER_HEX, compactToTarget, checkHeaderPow };
