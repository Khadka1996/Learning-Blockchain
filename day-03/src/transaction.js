// Day 03 — a signed transfer: "the owner of this key sends <amount> coins to <address>".
"use strict";

const { sha256, isAddress, addressFromPublicKey, verifySignature } = require("./keys");

const TX_VERSION = 1;
const DOMAIN = "learning-blockchain/transfer"; // a signature for a transfer can never be reused as anything else
const TX_KEYS = ["version", "chainId", "from", "to", "amount", "nonce", "signature"];
const isWhole = (n) => Number.isSafeInteger(n) && n >= 0;
const isChainId = (c) => typeof c === "string" && /^[a-z0-9-]{1,32}$/.test(c);

/**
 * Check the unsigned fields have the right shape. Amounts are whole coins (like satoshis / wei):
 * v1 allowed 0.1 + 0.2 and lost money to floating-point rounding (audit B5), and 2^60 + 1 silently
 * became 2^60 (audit B10). Now only safe integers are allowed.
 */
function assertBody(tx) {
  if (tx === null || typeof tx !== "object" || Array.isArray(tx)) throw new TypeError("transaction must be an object");
  for (const k of Object.keys(tx)) if (!TX_KEYS.includes(k)) throw new TypeError(`unexpected field "${k}" (not covered by the signature)`);
  if (tx.version !== TX_VERSION) throw new TypeError(`version must be ${TX_VERSION}`);
  if (!isChainId(tx.chainId)) throw new TypeError("chainId must be 1–32 characters a–z, 0–9 or -");
  addressFromPublicKey(tx.from); // throws on a bad key
  if (!isAddress(tx.to)) throw new TypeError("to must be a 40-hex-character address"); // audit B7
  if (!isWhole(tx.amount) || tx.amount === 0) throw new RangeError("amount must be a whole number of coins ≥ 1 (safe integer)");
  if (!isWhole(tx.nonce)) throw new RangeError("nonce must be a whole number ≥ 0");
}

/**
 * The exact bytes that get signed: fixed-order, fixed-type fields in a JSON array (Day 02, F3).
 * chainId stops a testnet payment being replayed on mainnet (audit B8, like Ethereum's EIP-155);
 * nonce stops the same payment being replayed twice (audit B3).
 */
function signingBytes(tx) {
  assertBody(tx);
  return Buffer.from(JSON.stringify([DOMAIN, tx.version, tx.chainId, tx.from, tx.to, tx.amount, tx.nonce]), "utf8");
}

/** Transaction id = SHA-256 of the signed bytes. The signature is NOT part of the id. */
function txId(tx) {
  return sha256(signingBytes(tx)).toString("hex");
}

/** Build and sign a transfer with a wallet from keys.js. Returns a frozen object. */
function createTransfer(wallet, { to, amount, nonce, chainId }) {
  const body = { version: TX_VERSION, chainId, from: wallet.publicKey, to, amount, nonce };
  const signature = wallet.sign(signingBytes(body));
  return Object.freeze({ ...body, signature });
}

/**
 * Read every field of an untrusted transaction exactly ONCE into a frozen plain copy.
 * Without this, a getter could answer "1 coin" while the signature is checked and "100 coins"
 * when the ledger moves the money (audit M1, a time-of-check / time-of-use bug).
 */
function snapshot(tx) {
  if (tx === null || typeof tx !== "object" || Array.isArray(tx)) throw new TypeError("transaction must be an object");
  const copy = {};
  for (const k of Object.keys(tx)) copy[k] = tx[k];
  return Object.freeze(copy);
}

/**
 * Returns { ok: true, id, sender, tx } or { ok: false, reason }. Never throws.
 * `tx` is the frozen snapshot that was verified: callers must use it, not the original object.
 */
function verifyTransfer(input) {
  let tx, bytes;
  try {
    tx = snapshot(input);
    bytes = signingBytes(tx);
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  if (!verifySignature(tx.from, bytes, tx.signature)) return { ok: false, reason: "signature is not valid for this sender and these exact contents" };
  return { ok: true, id: sha256(bytes).toString("hex"), sender: addressFromPublicKey(tx.from), tx };
}

module.exports = { TX_VERSION, DOMAIN, TX_KEYS, snapshot, assertBody, signingBytes, txId, createTransfer, verifyTransfer };
