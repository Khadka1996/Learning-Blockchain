// Exercise 1 (easy) — sign a short note, and prove a note signature can never move coins.
"use strict";

const { demoWallet, verifySignature } = require("../../src/keys");
const { createTransfer, verifyTransfer } = require("../../src/transaction");

const NOTE_DOMAIN = "learning-blockchain/note";
const MAX_NOTE = 280;

/** The exact bytes signed for a note: a different domain string than transfers use. */
function noteBytes(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_NOTE) throw new TypeError(`note must be 1–${MAX_NOTE} characters`);
  if (!text.isWellFormed()) throw new TypeError("note must be well-formed Unicode");
  return Buffer.from(JSON.stringify([NOTE_DOMAIN, text]), "utf8");
}

const signNote = (wallet, text) => wallet.sign(noteBytes(text));

/** true only if this public key signed exactly this text as a NOTE. Never throws. */
function verifyNote(publicKey, text, signature) {
  try {
    return verifySignature(publicKey, noteBytes(text), signature);
  } catch {
    return false;
  }
}

function run() {
  const [sita, ram] = ["sita", "ram"].map(demoWallet);
  const text = "I, Sita, agree to meet Ram at 5 pm.";
  const sig = signNote(sita, text);
  const results = {
    original: verifyNote(sita.publicKey, text, sig),
    edited: verifyNote(sita.publicKey, text.replace("5 pm", "9 pm"), sig),
    wrongKey: verifyNote(ram.publicKey, text, sig),
  };
  // Mallory copies the note signature onto a payment from Sita. The domain differs, so it fails.
  const tx = createTransfer(sita, { to: ram.address, amount: 1, nonce: 0, chainId: "lb-devnet" });
  results.noteSigAsPayment = verifyTransfer({ ...tx, signature: sig }).ok;
  console.log(`Note: "${text}"`);
  console.log(`  verifies with Sita's key:            ${results.original}`);
  console.log(`  verifies after "5 pm" → "9 pm":      ${results.edited}`);
  console.log(`  verifies with Ram's key:             ${results.wrongKey}`);
  console.log(`  note signature accepted as payment:  ${results.noteSigAsPayment}`);
  return results;
}

module.exports = { NOTE_DOMAIN, noteBytes, signNote, verifyNote, run };

if (require.main === module) run();
