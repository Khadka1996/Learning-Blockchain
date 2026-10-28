"use strict";
// Front-running a zero-knowledge proof: a proof is just data that sits in the public mempool.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { poseidonHash, proveSecret, proveSecretNaive, toSolidity } = require("../src/zk");

const SECRET = 987654321987654321n;
const E = ethers.parseEther;

/** Alice broadcasts her claim; Mallory copies it from the mempool with a higher tip; one block is mined. */
async function race(prize, aliceArgs, malloryArgsFromAlice) {
  const [, alice, mallory] = await ethers.getSigners();
  await network.provider.send("evm_setAutomine", [false]);
  try {
    const fees = { maxFeePerGas: ethers.parseUnits("10", "gwei"), maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"), gasLimit: 500_000 };
    const aliceTx = await prize.connect(alice).claim(...aliceArgs, fees);
    // Mallory watches the mempool, decodes Alice's pending transaction and re-sends it as her own.
    const pending = await ethers.provider.getTransaction(aliceTx.hash);
    const decoded = prize.interface.parseTransaction({ data: pending.data });
    const copied = JSON.parse(JSON.stringify(decoded.args.toArray(true), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    const malloryTx = await prize.connect(mallory).claim(...malloryArgsFromAlice(copied, mallory.address),
      { maxFeePerGas: ethers.parseUnits("50", "gwei"), maxPriorityFeePerGas: ethers.parseUnits("40", "gwei"), gasLimit: 500_000 });
    await network.provider.send("evm_mine");
    const [ra, rm] = [await ethers.provider.getTransactionReceipt(aliceTx.hash), await ethers.provider.getTransactionReceipt(malloryTx.hash)];
    return { alice, mallory, aliceOk: ra.status === 1, malloryOk: rm.status === 1, malloryFirst: rm.index < ra.index };
  } finally {
    await network.provider.send("evm_setAutomine", [true]);
  }
}

describe("Front-running a ZK proof", function () {
  it("NAIVE prize (proof does not name a recipient): Mallory copies Alice's proof and takes the prize", async function () {
    const verifier = await ethers.deployContract("NaiveSecretVerifier");
    const prize = await ethers.deployContract("NaiveZkPrize", [verifier, await poseidonHash(SECRET)], { value: E("1") });
    const { a, b, c } = toSolidity((await proveSecretNaive(SECRET)).proof);
    const before = await ethers.provider.getBalance((await ethers.getSigners())[2]);

    const r = await race(prize, [a, b, c], (args) => [args[0], args[1], args[2]]);
    expect(r.malloryFirst).to.equal(true);
    expect(r.malloryOk).to.equal(true); // Mallory never knew the secret
    expect(r.aliceOk).to.equal(false); // AlreadyClaimed
    expect(await ethers.provider.getBalance(r.mallory)).to.be.greaterThan(before + E("0.98"));
  });

  it("SAFE prize (recipient is a public input): the copied proof is useless to Mallory", async function () {
    const [, alice] = await ethers.getSigners();
    const verifier = await ethers.deployContract("SecretVerifier");
    const prize = await ethers.deployContract("ZkPrize", [verifier, await poseidonHash(SECRET)], { value: E("1") });
    const { a, b, c } = toSolidity((await proveSecret(SECRET, alice.address)).proof);
    const before = await ethers.provider.getBalance(alice);

    // Mallory swaps in her own address → the proof no longer matches the public signals.
    const r = await race(prize, [a, b, c, alice.address], (args, me) => [args[0], args[1], args[2], me]);
    expect(r.malloryFirst).to.equal(true);
    expect(r.malloryOk).to.equal(false); // InvalidProof
    expect(r.aliceOk).to.equal(true);
    expect(await ethers.provider.getBalance(alice)).to.be.greaterThan(before + E("0.98"));
  });

  it("SAFE prize: if Mallory re-sends the proof unchanged, she only pays Alice's gas — Alice still gets the prize", async function () {
    const [, alice] = await ethers.getSigners();
    const verifier = await ethers.deployContract("SecretVerifier");
    const prize = await ethers.deployContract("ZkPrize", [verifier, await poseidonHash(SECRET)], { value: E("1") });
    const { a, b, c } = toSolidity((await proveSecret(SECRET, alice.address)).proof);
    const before = await ethers.provider.getBalance(alice);

    const r = await race(prize, [a, b, c, alice.address], (args) => [args[0], args[1], args[2], args[3]]);
    expect(r.malloryOk).to.equal(true); // her copy went first …
    expect(r.aliceOk).to.equal(false); // … so Alice's own tx hit AlreadyClaimed
    expect(await ethers.provider.getBalance(alice)).to.be.greaterThan(before + E("0.98")); // … but the money is Alice's
  });
});
