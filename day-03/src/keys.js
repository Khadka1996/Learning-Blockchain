// Day 03 — keys, addresses and digital signatures on secp256k1 (the curve Bitcoin and Ethereum use).
// Node.js `crypto` only, no dependencies. Everything here is a pure function or an immutable wallet.
"use strict";

const crypto = require("crypto");

const CURVE = "secp256k1";
// n = the number of points in the group. Private keys and signature parts r, s must be in [1, n − 1].
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;
const HEX64 = /^[0-9a-f]{64}$/;
const PUBKEY_HEX = /^0[23][0-9a-f]{64}$/; // compressed point: 02/03 prefix (sign of y) + 32-byte x
const ADDRESS_HEX = /^[0-9a-f]{40}$/;

const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const toBig = (buf) => BigInt("0x" + Buffer.from(buf).toString("hex"));
const to32 = (big) => Buffer.from(big.toString(16).padStart(64, "0"), "hex");

/** A private key is just a secret whole number from 1 to n − 1, written as 64 hex characters. */
function assertPrivateKeyHex(hex) {
  if (typeof hex !== "string" || !HEX64.test(hex)) throw new TypeError("private key must be 64 lowercase hex characters");
  const k = BigInt("0x" + hex);
  if (k === 0n || k >= N) throw new RangeError("private key must be between 1 and n − 1 (secp256k1 group order)");
}

/** Uncompressed point (04 ‖ x ‖ y) → JWK, which is how Node's crypto imports raw EC keys. */
function jwkFromPoint(uncompressed, dBuf) {
  const jwk = { kty: "EC", crv: CURVE, x: b64url(uncompressed.subarray(1, 33)), y: b64url(uncompressed.subarray(33, 65)) };
  if (dBuf) jwk.d = b64url(dBuf);
  return jwk;
}

/**
 * Turn a compressed public key (66 hex chars) into a Node KeyObject.
 * Rejects anything that is not exactly one valid point on the curve (audit B9: v1 crashed on garbage).
 */
function publicKeyObject(publicKeyHex) {
  if (typeof publicKeyHex !== "string" || !PUBKEY_HEX.test(publicKeyHex)) {
    throw new TypeError("public key must be 66 lowercase hex characters starting with 02 or 03 (compressed)");
  }
  let point;
  try {
    point = crypto.ECDH.convertKey(publicKeyHex, CURVE, "hex", undefined, "uncompressed");
  } catch {
    throw new TypeError("public key is not a point on secp256k1");
  }
  return crypto.createPublicKey({ key: jwkFromPoint(point), format: "jwk" });
}

/**
 * Address = first 20 bytes of SHA-256(compressed public key), as 40 hex characters.
 * (Bitcoin uses RIPEMD-160(SHA-256(pubkey)) + a checksum; Ethereum uses the last 20 bytes of
 * Keccak-256(pubkey). Same idea: a short, public "account number" derived from the key.)
 */
function addressFromPublicKey(publicKeyHex) {
  publicKeyObject(publicKeyHex); // validates the point
  return sha256(Buffer.from(publicKeyHex, "hex")).subarray(0, 20).toString("hex");
}

const isAddress = (a) => typeof a === "string" && ADDRESS_HEX.test(a);

/**
 * A wallet: private key (secret, never printed) → public key (shareable) → address (account number).
 * The private key lives in a Node KeyObject; JSON.stringify / console.log only ever show the public parts.
 */
function walletFromPrivateKey(privateKeyHex) {
  assertPrivateKeyHex(privateKeyHex);
  const d = Buffer.from(privateKeyHex, "hex");
  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(d);
  const publicKey = ecdh.getPublicKey("hex", "compressed");
  const keyObject = crypto.createPrivateKey({ key: jwkFromPoint(ecdh.getPublicKey(), d), format: "jwk" });
  const address = addressFromPublicKey(publicKey);
  const view = () => ({ address, publicKey });
  return Object.freeze({
    address,
    publicKey,
    /** Sign 32-byte-or-longer message bytes; the signature is (r ‖ s), 64 bytes, low-S. */
    sign: (message) => signMessage(keyObject, message),
    toJSON: view,
    [Symbol.for("nodejs.util.inspect.custom")]: () => `Wallet ${JSON.stringify(view())}`,
  });
}

/** Fresh random wallet (uses the OS's secure random generator). */
function generateWallet() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return walletFromPrivateKey(ecdh.getPrivateKey("hex").padStart(64, "0"));
}

/** Deterministic demo wallet from a name: NEVER do this for real money (anyone can guess "sita"). */
function demoWallet(name) {
  return walletFromPrivateKey(sha256(`learning-blockchain demo key: ${name}`).toString("hex"));
}

/**
 * ECDSA sign over SHA-256(message). Output is always "low-S" (s ≤ n/2).
 * Why: if (r, s) is valid, so is (r, n − s). v1 accepted both, so one payment had two valid
 * signatures (audit B4, the same "malleability" Bitcoin fixed with BIP 62/146 and Ethereum with EIP-2).
 */
function signMessage(privateKeyObject, message) {
  const sig = crypto.sign("sha256", Buffer.from(message), { key: privateKeyObject, dsaEncoding: "ieee-p1363" });
  const r = sig.subarray(0, 32);
  let s = toBig(sig.subarray(32));
  if (s > HALF_N) s = N - s;
  return Buffer.concat([r, to32(s)]).toString("hex");
}

/** Strict verify: 128 hex chars, 1 ≤ r < n, 1 ≤ s ≤ n/2, valid key, correct maths. Never throws. */
function verifySignature(publicKeyHex, message, signatureHex) {
  if (typeof signatureHex !== "string" || !/^[0-9a-f]{128}$/.test(signatureHex)) return false;
  const r = BigInt("0x" + signatureHex.slice(0, 64));
  const s = BigInt("0x" + signatureHex.slice(64));
  if (r === 0n || r >= N || s === 0n || s > HALF_N) return false;
  let key;
  try {
    key = publicKeyObject(publicKeyHex);
  } catch {
    return false;
  }
  return crypto.verify("sha256", Buffer.from(message), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signatureHex, "hex"));
}

module.exports = {
  CURVE,
  N,
  HALF_N,
  sha256,
  assertPrivateKeyHex,
  publicKeyObject,
  addressFromPublicKey,
  isAddress,
  walletFromPrivateKey,
  generateWallet,
  demoWallet,
  signMessage,
  verifySignature,
};
