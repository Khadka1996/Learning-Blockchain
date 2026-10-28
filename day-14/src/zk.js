"use strict";
// Small helpers around snarkjs + circomlibjs for the two circuits in circuits/.
const path = require("node:path");
const crypto = require("node:crypto");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const ZK = path.join(__dirname, "..", "zk");
const files = (name) => ({
  wasm: path.join(ZK, name + ".wasm"),
  zkey: path.join(ZK, name + ".zkey"),
  vkey: require(path.join(ZK, name + ".vkey.json")),
});

// BN254 scalar field: every circuit number lives modulo this prime.
const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let poseidon;
/** Poseidon hash of one field element, as a BigInt (the same hash the circuit computes). */
async function poseidonHash(x) {
  poseidon ??= await buildPoseidon();
  return poseidon.F.toObject(poseidon([BigInt(x)]));
}

/** A secret that can't be guessed: 31 random bytes (248 bits, always below the field prime). */
function randomSecret() {
  return BigInt("0x" + crypto.randomBytes(31).toString("hex"));
}

/** Prove "I know `secret` with Poseidon(secret) = hash, pay `recipient`" (circuit secret.circom). */
async function proveSecret(secret, recipient) {
  const { wasm, zkey } = files("secret");
  const hash = await poseidonHash(secret);
  const input = { secret: BigInt(secret).toString(), hash: hash.toString(), recipient: BigInt(recipient).toString() };
  return snarkjs.groth16.fullProve(input, wasm, zkey);
}

/** Same, with the naive circuit that does not name a recipient. */
async function proveSecretNaive(secret) {
  const { wasm, zkey } = files("secret_naive");
  const hash = await poseidonHash(secret);
  return snarkjs.groth16.fullProve({ secret: BigInt(secret).toString(), hash: hash.toString() }, wasm, zkey);
}

/** Verify off-chain with the verification key (what the Solidity verifier does on-chain). */
function verifyOffChain(name, proof, publicSignals) {
  return snarkjs.groth16.verify(files(name).vkey, publicSignals, proof);
}

/**
 * snarkjs proof → the (a, b, c) arguments of the Solidity verifier.
 * Note: b's inner pairs are swapped — Solidity's pairing precompile wants (imaginary, real).
 */
function toSolidity(proof) {
  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];
  return { a, b, c };
}

module.exports = { SNARK_FIELD, poseidonHash, randomSecret, proveSecret, proveSecretNaive, verifyOffChain, toSolidity };
