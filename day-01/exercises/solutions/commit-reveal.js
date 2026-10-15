// Exercise 3 (challenge) — commit–reveal with a salt, and why the salt matters.
"use strict";

const { randomBytes, timingSafeEqual } = require("crypto");
const { sha256Bytes, sha256Hex } = require("../../src/lib");

const MOVES = ["rock", "paper", "scissors"];
const SALT_BYTES = 32;

function assertMove(choice) {
  if (!MOVES.includes(choice)) throw new RangeError(`choice must be one of ${MOVES.join(", ")}`);
}

/** Fixed-length salt + separator → the message can only be split one way. */
function message(saltHex, choice) {
  return `${saltHex}:${choice}`;
}

/** Create a commitment. Publish `commitment`; keep `salt` secret until the reveal. */
function commit(choice, salt = randomBytes(SALT_BYTES)) {
  assertMove(choice);
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_BYTES) throw new RangeError("salt must be 32 bytes");
  const saltHex = Buffer.from(salt).toString("hex");
  return { commitment: sha256Hex(message(saltHex, choice)), salt: saltHex };
}

/** Check a reveal against an earlier commitment. Never throws on bad input — just returns false. */
function verify(commitment, choice, saltHex) {
  if (typeof commitment !== "string" || !/^[0-9a-f]{64}$/i.test(commitment)) return false;
  if (typeof saltHex !== "string" || !new RegExp(`^[0-9a-f]{${SALT_BYTES * 2}}$`).test(saltHex)) return false;
  if (!MOVES.includes(choice)) return false;
  const expected = sha256Bytes(message(saltHex.toLowerCase(), choice));
  return timingSafeEqual(expected, Buffer.from(commitment, "hex"));
}

/** The attack on a naive scheme that hashes only the choice: try all 3 moves. */
function crackUnsalted(commitment) {
  for (const move of MOVES) if (sha256Hex(move) === commitment) return move;
  return null;
}

function demo() {
  const naive = sha256Hex("rock");
  console.log("Without salt");
  console.log(`  Alice publishes sha256("rock") = ${naive.slice(0, 16)}…`);
  console.log(`  Bob tries 3 hashes and learns : ${crackUnsalted(naive)}  ← secret leaked\n`);

  const alice = commit("rock");
  console.log("With a 32-byte salt");
  console.log(`  Alice publishes                : ${alice.commitment.slice(0, 16)}…`);
  console.log(`  Bob's 3-guess attack finds     : ${crackUnsalted(alice.commitment)}`);
  console.log(`  Reveal "rock" + salt verifies  : ${verify(alice.commitment, "rock", alice.salt)}`);
  console.log(`  Alice switching to "paper"     : ${verify(alice.commitment, "paper", alice.salt)}`);
}

if (require.main === module) demo();

module.exports = { MOVES, commit, verify, crackUnsalted };
