// Day 02 — a block, its hash, and Proof of Work (mining).
// Pure functions, no side effects: every script in src/ and every test in test/ uses these.
"use strict";

const { createHash } = require("crypto");

const HASH_BITS = 256;
const MIN_DIFFICULTY = 1; // difficulty = number of leading ZERO BITS the block hash must have
const MAX_DIFFICULTY = 32; // 32 bits ≈ 4.3 billion guesses on average — a sane cap for a laptop demo
const MAX_ATTEMPTS = 2 ** 32; // mining always ends (Bitcoin's nonce is 32 bits, too)
const HEADER_VERSION = 1;
const HEX64 = /^[0-9a-f]{64}$/;

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

/** Parse a whole number from untrusted CLI input ("12" ok; "0x10", "1e3", "12abc", "" rejected). */
function toWholeNumber(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

/** Difficulty must be a whole number of bits from 1 to 32 (audit F7/F8). */
function parseDifficulty(value) {
  const d = toWholeNumber(value);
  if (!Number.isInteger(d) || d < MIN_DIFFICULTY || d > MAX_DIFFICULTY) {
    throw new RangeError(`difficulty must be a whole number of bits from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}, got "${value}"`);
  }
  return d;
}

const MAX_DATA_BYTES = 1_000_000; // 1 MB — Bitcoin's original block-size limit (audit E5)
const MAX_DEPTH = 32; // nesting limit for payload objects/arrays (audit E5)
const HEADER_KEYS = ["index", "prevHash", "timestamp", "difficulty", "nonce", "data"];

/**
 * Canonical, strict JSON encoding of a block payload (audit E1).
 * Plain JSON.stringify silently merges different values: {a: undefined} → "{}", NaN → null,
 * -0 → 0, and an object's toJSON() decides what gets hashed. Here every value is either encoded
 * exactly or refused, and object keys are sorted so {a, b} and {b, a} give the same bytes.
 * Allowed: null, true/false, finite numbers (not -0), strings, dense arrays, plain objects.
 */
function canonicalJson(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new TypeError(`block data is nested more than ${MAX_DEPTH} levels`);
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value); // lone surrogates are escaped (\ud800), never merged
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`block data cannot contain ${Object.is(value, -0) ? "-0" : value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new TypeError("block data cannot contain sparse arrays (holes)");
      parts.push(canonicalJson(value[i], depth + 1));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("block data objects must be plain objects (no Date, Map, class instances)");
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError("block data cannot contain symbol keys");
    const keys = Object.keys(value).sort();
    if (keys.includes("toJSON")) throw new TypeError('block data cannot define "toJSON"');
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError(`block data cannot contain ${typeof value}`); // undefined, function, symbol, bigint
}

/** Canonical bytes of a payload, with the 1 MB size limit applied (audit E5). */
function encodeData(data) {
  const json = canonicalJson(data);
  if (Buffer.byteLength(json, "utf8") > MAX_DATA_BYTES) throw new RangeError(`block data is too large (limit ${MAX_DATA_BYTES} bytes)`);
  return json;
}

/** Fingerprint of the block's payload. In Bitcoin this slot holds the Merkle root (Day 04). */
function hashData(data) {
  return sha256Hex(encodeData(data));
}

/** Recursively freeze plain data. */
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * A frozen, independent copy of a payload, rebuilt from the exact bytes that were hashed —
 * so the stored data is precisely what the hash covers, and later edits to the caller's
 * object (or tricks like a getter that returns a new value each time) cannot reach it (audit E2).
 */
function freezeData(data) {
  return deepFreeze(JSON.parse(encodeData(data)));
}

/**
 * The exact bytes that get hashed. Every field has a fixed type and its own slot in a JSON
 * array, so two different headers can never produce the same string. (v1 glued the fields
 * together as text, so index 1 + timestamp 12 looked exactly like index 11 + timestamp 2 — audit F3.)
 */
function serializeHeader(b, dataHash = hashData(b.data)) {
  return JSON.stringify([HEADER_VERSION, b.index, b.prevHash, b.timestamp, b.difficulty, b.nonce, dataHash]);
}

/** True if the first `bits` bits of a byte array are zero (fast check used while mining). */
function hasLeadingZeroBits(bytes, bits) {
  const full = bits >>> 3;
  for (let i = 0; i < full; i++) if (bytes[i] !== 0) return false;
  const rest = bits & 7;
  return rest === 0 || bytes[full] >>> (8 - rest) === 0;
}

/** Throw a clear error if a block header has the wrong shape (audit F5). */
function assertHeaderShape(b) {
  if (b === null || typeof b !== "object") throw new TypeError("block must be an object");
  for (const k of Object.keys(b)) {
    if (k !== "hash" && !HEADER_KEYS.includes(k)) throw new TypeError(`unexpected field "${k}" (not covered by the hash)`); // E3
  }
  const isUint = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!isUint(b.index)) throw new TypeError("index must be a whole number ≥ 0");
  if (typeof b.prevHash !== "string" || !HEX64.test(b.prevHash)) throw new TypeError("prevHash must be 64 lowercase hex characters");
  if (!isUint(b.timestamp)) throw new TypeError("timestamp must be whole milliseconds ≥ 0");
  parseDifficulty(b.difficulty);
  if (!isUint(b.nonce)) throw new TypeError("nonce must be a whole number ≥ 0");
}

/** SHA-256 of the serialised header → 64 hex characters. This is the block's id. */
function hashBlock(b) {
  assertHeaderShape(b);
  return sha256Hex(serializeHeader(b));
}

/** True if the hash, read as a 256-bit number, is below 2^(256 − difficulty) — i.e. it starts with `difficulty` zero bits. */
function meetsDifficulty(hash, difficulty) {
  if (typeof hash !== "string" || !HEX64.test(hash)) return false;
  const d = parseDifficulty(difficulty);
  return BigInt("0x" + hash) < 1n << BigInt(HASH_BITS - d);
}

/** Count leading zero bits of a hex hash (for display). */
function leadingZeroBits(hash) {
  let bits = 0;
  for (const ch of hash) {
    const v = parseInt(ch, 16);
    if (v === 0) { bits += 4; continue; }
    return bits + Math.clz32(v) - 28;
  }
  return bits;
}

/**
 * Proof of Work: try nonce = 0, 1, 2, … until the block hash has `difficulty` leading zero bits.
 * Nobody can predict which nonce works — the only way is to guess. That is "mining".
 */
function mineBlock({ index, prevHash, timestamp, data, difficulty }, { maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be a positive whole number");
  const header = { index, prevHash, timestamp, difficulty, nonce: 0, data };
  assertHeaderShape(header);
  // Read the caller's payload exactly ONCE: encode it, hash those bytes, store a frozen copy of them (E2).
  const json = encodeData(data);
  const dataHash = sha256Hex(json); // the payload does not change while mining — hash it once
  header.data = deepFreeze(JSON.parse(json));
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    header.nonce = nonce;
    const digest = createHash("sha256").update(serializeHeader(header, dataHash)).digest();
    if (hasLeadingZeroBits(digest, difficulty)) {
      return { block: Object.freeze({ ...header, hash: digest.toString("hex") }), attempts: nonce + 1 };
    }
  }
  throw new Error(`no valid nonce found in ${maxAttempts} attempts`);
}

module.exports = {
  HASH_BITS,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  MAX_ATTEMPTS,
  HEADER_VERSION,
  MAX_DATA_BYTES,
  MAX_DEPTH,
  HEADER_KEYS,
  canonicalJson,
  encodeData,
  deepFreeze,
  freezeData,
  sha256Hex,
  toWholeNumber,
  parseDifficulty,
  hashData,
  serializeHeader,
  hasLeadingZeroBits,
  assertHeaderShape,
  hashBlock,
  meetsDifficulty,
  leadingZeroBits,
  mineBlock,
};
