"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { SNARK_FIELD, poseidonHash, randomSecret, proveSecret, verifyOffChain, toSolidity } = require("../src/zk");

const SECRET = 123456789012345678901234567890n; // fixed so the fixture is fast; demo uses randomSecret()

async function deploy() {
  const [deployer, alice, relayer, mallory] = await ethers.getSigners();
  const verifier = await ethers.deployContract("SecretVerifier");
  const hash = await poseidonHash(SECRET);
  const prize = await ethers.deployContract("ZkPrize", [verifier, hash], { value: ethers.parseEther("1") });
  const { proof, publicSignals } = await proveSecret(SECRET, alice.address);
  return { deployer, alice, relayer, mallory, verifier, prize, hash, proof, publicSignals, sol: toSolidity(proof) };
}

describe("Zero-knowledge proof (circom + snarkjs Groth16) — off-chain", function () {
  it("a valid proof verifies, and the public signals are [hash, recipient] — never the secret", async function () {
    const { alice, hash, proof, publicSignals } = await loadFixture(deploy);
    expect(await verifyOffChain("secret", proof, publicSignals)).to.equal(true);
    expect(publicSignals).to.deep.equal([hash.toString(), BigInt(alice.address).toString()]);
    expect(JSON.stringify({ proof, publicSignals })).to.not.include(SECRET.toString());
  });

  it("changing any public signal breaks the proof", async function () {
    const { proof, publicSignals } = await loadFixture(deploy);
    const badHash = [(BigInt(publicSignals[0]) + 1n).toString(), publicSignals[1]];
    const badRecipient = [publicSignals[0], (BigInt(publicSignals[1]) + 1n).toString()];
    expect(await verifyOffChain("secret", proof, badHash)).to.equal(false);
    expect(await verifyOffChain("secret", proof, badRecipient)).to.equal(false);
  });

  it("you cannot even BUILD a proof with the wrong secret (the circuit's constraint fails)", async function () {
    const { alice, hash } = await loadFixture(deploy);
    const snarkjs = require("snarkjs");
    const input = { secret: (SECRET + 1n).toString(), hash: hash.toString(), recipient: BigInt(alice.address).toString() };
    let err;
    const { log, error } = console;
    console.log = console.error = () => {}; // the witness generator prints its own error line; keep test output clean
    try { await snarkjs.groth16.fullProve(input, "zk/secret.wasm", "zk/secret.zkey"); } catch (e) { err = e; } finally { console.log = log; console.error = error; }
    expect(String(err)).to.match(/Assert Failed/);
  });

  it("two proofs of the same statement look different (randomised), both valid", async function () {
    const { alice, proof } = await loadFixture(deploy);
    const again = await proveSecret(SECRET, alice.address);
    expect(again.proof.pi_a[0]).to.not.equal(proof.pi_a[0]);
    expect(await verifyOffChain("secret", again.proof, again.publicSignals)).to.equal(true);
  });

  it("randomSecret() is always inside the field and different every time", async function () {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const s = randomSecret();
      expect(s < SNARK_FIELD).to.equal(true);
      seen.add(s);
    }
    expect(seen.size).to.equal(50);
  });
});

describe("ZkPrize — on-chain verification", function () {
  it("pays the recipient named in the proof; anyone (a relayer) may submit it", async function () {
    const { prize, alice, relayer, sol } = await loadFixture(deploy);
    const tx = prize.connect(relayer).claim(sol.a, sol.b, sol.c, alice.address);
    await expect(tx).to.changeEtherBalances([prize, alice], [ethers.parseEther("-1"), ethers.parseEther("1")]);
    await expect(tx).to.emit(prize, "Claimed").withArgs(alice.address, relayer.address, ethers.parseEther("1"));
    expect(await prize.claimed()).to.equal(true);
  });

  it("the same proof with a different recipient is rejected (no front-running)", async function () {
    const { prize, mallory, sol } = await loadFixture(deploy);
    await expect(prize.connect(mallory).claim(sol.a, sol.b, sol.c, mallory.address))
      .to.be.revertedWithCustomError(prize, "InvalidProof");
  });

  it("a tampered proof is rejected", async function () {
    const { prize, alice, sol } = await loadFixture(deploy);
    const a = [(BigInt(sol.a[0]) + 1n).toString(), sol.a[1]];
    await expect(prize.claim(a, sol.b, sol.c, alice.address)).to.be.revertedWithCustomError(prize, "InvalidProof");
  });

  it("cannot be claimed twice", async function () {
    const { prize, alice, sol } = await loadFixture(deploy);
    await prize.claim(sol.a, sol.b, sol.c, alice.address);
    await expect(prize.claim(sol.a, sol.b, sol.c, alice.address)).to.be.revertedWithCustomError(prize, "AlreadyClaimed");
  });

  it("refuses a zero recipient, an empty prize and a hash outside the field", async function () {
    const { prize, verifier, sol } = await loadFixture(deploy);
    await expect(prize.claim(sol.a, sol.b, sol.c, ethers.ZeroAddress)).to.be.revertedWithCustomError(prize, "ZeroRecipient");
    const F = await ethers.getContractFactory("ZkPrize");
    await expect(F.deploy(verifier, 1n)).to.be.revertedWithCustomError(F, "EmptyPrize");
    await expect(F.deploy(verifier, SNARK_FIELD, { value: 1n })).to.be.revertedWithCustomError(F, "HashNotInField");
  });

  it("the verifier refuses a public signal ≥ the field prime (alias of a valid one)", async function () {
    const { verifier, publicSignals, sol } = await loadFixture(deploy);
    const pub = publicSignals.map(BigInt);
    expect(await verifier.verifyProof(sol.a, sol.b, sol.c, pub)).to.equal(true);
    expect(await verifier.verifyProof(sol.a, sol.b, sol.c, [pub[0] + SNARK_FIELD, pub[1]])).to.equal(false);
  });

  it("a weak secret is NOT protected by ZK: the public hash can be brute-forced", async function () {
    const pin = 4821n; // a 4-digit PIN as the "secret"
    const target = await poseidonHash(pin);
    let found = -1n;
    for (let guess = 0n; guess < 10000n; guess++) {
      if ((await poseidonHash(guess)) === target) { found = guess; break; }
    }
    expect(found).to.equal(pin);
  });
});
