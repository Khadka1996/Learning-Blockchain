// Day 01 — reusable hashing helpers (pure functions, no side effects).
// Every CLI script in src/ and every test in test/ uses these, so the
// behaviour you read about in the README is exactly what gets tested.
"use strict";

const { createHash } = require("crypto");
const fs = require("fs");

const HASH_BITS = 256;
const HASH_HEX_LENGTH = HASH_BITS / 4; // 64 hex characters
const MAX_ZEROS = 8; // 8 leading hex zeros ≈ 4.3 billion guesses — a sane cap for a demo

/**
 * True if a JS string is valid Unicode (no lone UTF-16 surrogates).
 * A lone surrogate has no UTF-8 form, so Node silently replaces it with U+FFFD —
 * meaning "\uD800", "\uDC00" and "\uFFFD" would all produce the SAME hash (audit E1).
 */
function isWellFormed(str) {
  if (typeof str.isWellFormed === "function") return str.isWellFormed(); // Node 20+
  return !/\p{Surrogate}/u.test(str); // Node 18 fallback: in /u mode only LONE surrogates match
}

/** Accept only data we can hash unambiguously: well-formed strings, Buffers and Uint8Arrays. */
function assertHashable(input) {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw new TypeError(
      `sha256 expects a string, Buffer or Uint8Array, got ${input === null ? "null" : typeof input}`
    );
  }
  if (typeof input === "string" && !isWellFormed(input)) {
    throw new TypeError("sha256 expects a well-formed Unicode string (found a lone UTF-16 surrogate)");
  }
}

/**
 * Parse a whole number from untrusted CLI/API input. Numbers must be integers; strings must be
 * plain decimal digits ("5" ok; "0x5", "1e3", "5abc", "" rejected). Anything else → NaN.
 */
function toWholeNumber(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

/** SHA-256 of a string (UTF-8) or bytes → 32-byte Buffer. */
function sha256Bytes(input) {
  assertHashable(input);
  return createHash("sha256").update(input).digest();
}

/** SHA-256 of a string (UTF-8) or bytes → 64-char lowercase hex string. */
function sha256Hex(input) {
  return sha256Bytes(input).toString("hex");
}

/** Count bits that differ between two equal-length byte arrays (Hamming distance). */
function bitsDifferent(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
    throw new TypeError("bitsDifferent expects two Buffers / Uint8Arrays");
  }
  if (a.length !== b.length) {
    throw new RangeError(`length mismatch: ${a.length} vs ${b.length} bytes`);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      diff += x & 1;
      x >>>= 1;
    }
  }
  return diff;
}

/** Compare the hashes of two inputs and report how many of the 256 bits flipped. */
function avalanche(a, b) {
  const ha = sha256Bytes(a);
  const hb = sha256Bytes(b);
  const bits = bitsDifferent(ha, hb);
  return { hashA: ha.toString("hex"), hashB: hb.toString("hex"), bits, percent: (bits / HASH_BITS) * 100 };
}

/** Validate the "number of leading zeros" argument (CLI input is untrusted). */
function parseZeros(value) {
  const n = toWholeNumber(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ZEROS) {
    throw new RangeError(`zeros must be a whole number from 1 to ${MAX_ZEROS}, got "${value}"`);
  }
  return n;
}

/**
 * Brute-force search: find a nonce so that sha256(`${prefix}${nonce}`) starts with
 * `zeros` hex zeros. This is the core idea behind Proof of Work (Day 02).
 * `maxAttempts` guarantees the loop always ends.
 */
function findLeadingZeros(zeros, { prefix = "manish-", maxAttempts = 2 ** 32 } = {}) {
  const z = parseZeros(zeros);
  if (typeof prefix !== "string") throw new TypeError("prefix must be a string");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive safe integer");
  }
  const target = "0".repeat(z);
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const input = `${prefix}${nonce}`;
    const hash = sha256Hex(input);
    if (hash.startsWith(target)) return { found: true, input, nonce, hash, attempts: nonce + 1, expected: 16 ** z };
  }
  return { found: false, attempts: maxAttempts, expected: 16 ** z };
}

/**
 * Stream a file through SHA-256. The size reported is the number of bytes actually
 * hashed (counted while streaming, not taken from stat), so the two always agree.
 */
async function hashFile(path) {
  // Only regular files: a directory errors, and a device like /dev/zero or a pipe
  // would stream forever and hang the program.
  // Open ONCE and check the handle we actually read from. Checking the path with stat() and
  // then opening the path again leaves a gap where it can be swapped for a pipe (audit E2).
  // O_NONBLOCK stops open() itself from blocking on a FIFO that has no writer.
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);
  const handle = await fs.promises.open(path, flags);
  let info;
  try {
    info = await handle.stat();
  } catch (e) {
    await handle.close();
    throw e;
  }
  if (!info.isFile()) {
    await handle.close();
    throw new Error(`not a regular file: ${path}`);
  }
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    handle
      .createReadStream() // autoClose: the handle is closed when the stream ends or errors
      .on("data", (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
      })
      .on("end", () => resolve({ bytes, hex: hash.digest("hex") }))
      .on("error", reject);
  });
}

module.exports = {
  HASH_BITS,
  HASH_HEX_LENGTH,
  MAX_ZEROS,
  sha256Bytes,
  sha256Hex,
  bitsDifferent,
  avalanche,
  isWellFormed,
  toWholeNumber,
  parseZeros,
  findLeadingZeros,
  hashFile,
};
