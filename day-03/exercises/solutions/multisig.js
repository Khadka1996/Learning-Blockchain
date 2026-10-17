// Exercise 3 (challenge) — a 2-of-3 shared vault: coins move only when 2 different owners sign.
"use strict";

const { demoWallet, sha256, publicKeyObject, isAddress, verifySignature } = require("../../src/keys");

const ADDRESS_DOMAIN = "learning-blockchain/multisig-address";
const SPEND_DOMAIN = "learning-blockchain/multisig-spend";
const MAX_KEYS = 15; // Bitcoin's classic P2SH multisig limit is also 15 keys

/** Validate an m-of-n policy and return it in canonical form (keys sorted, so order never matters). */
function makePolicy(threshold, publicKeys) {
  if (!Array.isArray(publicKeys) || publicKeys.length < 1 || publicKeys.length > MAX_KEYS) throw new RangeError(`need 1–${MAX_KEYS} public keys`);
  const keys = [...publicKeys];
  for (const k of keys) publicKeyObject(k); // throws on anything that is not a valid compressed point
  if (new Set(keys).size !== keys.length) throw new RangeError("public keys must be different (one person, one vote)");
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > keys.length) throw new RangeError(`threshold must be 1–${keys.length}`);
  return Object.freeze({ threshold, keys: Object.freeze(keys.sort()) });
}

/** The vault's address commits to the threshold AND every key: change either and it is a different vault. */
const vaultAddress = (policy) => sha256(JSON.stringify([ADDRESS_DOMAIN, policy.threshold, policy.keys])).subarray(0, 20).toString("hex");

class Vault {
  #balance;
  #nonce = 0;

  constructor(chainId, policy, balance) {
    if (typeof chainId !== "string" || !/^[a-z0-9-]{1,32}$/.test(chainId)) throw new TypeError("bad chainId");
    if (!Number.isSafeInteger(balance) || balance < 0) throw new RangeError("balance must be a whole number ≥ 0");
    this.chainId = chainId;
    this.policy = makePolicy(policy.threshold, policy.keys);
    this.address = vaultAddress(this.policy);
    this.#balance = balance;
    Object.freeze(this);
  }

  get balance() {
    return this.#balance;
  }

  get nonce() {
    return this.#nonce;
  }

  /** What every owner signs: domain, chain, vault address, recipient, amount, nonce. */
  spendBytes({ to, amount, nonce }) {
    if (!isAddress(to)) throw new TypeError("to must be a 40-hex address");
    if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("amount must be a whole number ≥ 1");
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw new RangeError("nonce must be a whole number ≥ 0");
    return Buffer.from(JSON.stringify([SPEND_DOMAIN, this.chainId, this.address, to, amount, nonce]), "utf8");
  }

  /** One owner approves one exact payment. */
  approve(wallet, payment) {
    return { signer: wallet.publicKey, signature: wallet.sign(this.spendBytes(payment)) };
  }

  /** Move coins if at least `threshold` DIFFERENT owners signed exactly this payment. Throws otherwise. */
  spend(payment, approvals) {
    if (payment === null || typeof payment !== "object") throw new TypeError("payment must be an object");
    const p = { to: payment.to, amount: payment.amount, nonce: payment.nonce }; // read once (Day 03 M1)
    const bytes = this.spendBytes(p);
    if (!Array.isArray(approvals)) throw new TypeError("approvals must be an array");
    if (approvals.length > this.policy.keys.length) throw new RangeError("more approvals than owners"); // bounds the work
    const signers = new Set();
    for (const a of Array.from(approvals)) {
      const { signer, signature } = a ?? {};
      if (!this.policy.keys.includes(signer)) throw new Error("approval from someone who is not an owner");
      if (signers.has(signer)) throw new Error("the same owner approved twice (counts once)");
      if (!verifySignature(signer, bytes, signature)) throw new Error("an approval signature does not match this exact payment");
      signers.add(signer);
    }
    if (signers.size < this.policy.threshold) throw new Error(`need ${this.policy.threshold} owner approvals, got ${signers.size}`);
    if (p.nonce !== this.#nonce) throw new Error(p.nonce < this.#nonce ? `nonce ${p.nonce} already used (replay)` : `nonce ${p.nonce} is ahead of expected ${this.#nonce}`);
    if (p.amount > this.#balance) throw new Error(`insufficient balance: has ${this.#balance}, sends ${p.amount}`);
    this.#balance -= p.amount;
    this.#nonce += 1;
    return { to: p.to, amount: p.amount, approvedBy: signers.size };
  }
}

function run() {
  const [sita, ram, hari, mallory] = ["sita", "ram", "hari", "mallory"].map(demoWallet);
  const vault = new Vault("lb-devnet", makePolicy(2, [sita.publicKey, ram.publicKey, hari.publicKey]), 100);
  const pay = { to: mallory.address, amount: 40, nonce: 0 };
  const attempt = (label, fn) => {
    try {
      const r = fn();
      console.log(`  ACCEPTED  ${label}  → ${r.amount} coins, ${r.approvedBy} approvals`);
      return true;
    } catch (e) {
      console.log(`  REFUSED   ${label}  → ${e.message}`);
      return false;
    }
  };
  console.log(`2-of-3 vault ${vault.address} (Sita, Ram, Hari) holds ${vault.balance} coins`);
  const results = [
    attempt("Sita alone", () => vault.spend(pay, [vault.approve(sita, pay)])),
    attempt("Sita twice", () => vault.spend(pay, [vault.approve(sita, pay), vault.approve(sita, pay)])),
    attempt("Sita + Mallory", () => vault.spend(pay, [vault.approve(sita, pay), vault.approve(mallory, pay)])),
    attempt("Sita signs 40, Ram signs 4", () => vault.spend(pay, [vault.approve(sita, pay), vault.approve(ram, { ...pay, amount: 4 })])),
    attempt("Sita + Ram", () => vault.spend(pay, [vault.approve(sita, pay), vault.approve(ram, pay)])),
  ];
  const approvals = [vault.approve(sita, pay), vault.approve(hari, pay)];
  results.push(attempt("the same 2 approvals replayed", () => vault.spend(pay, approvals)));
  console.log(`Vault balance now ${vault.balance}, next nonce ${vault.nonce}`);
  return { vault, results };
}

module.exports = { makePolicy, vaultAddress, Vault, run };

if (require.main === module) run();
