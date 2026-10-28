"use strict";
// QA round 1 — manual attacker review of SmartWallet. Scenario: a THIEF has stolen the owner key.
// The daily limit promises "at most 1 ETH per day can leave". These tests try to break that promise.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { buildUserOp, signUserOp, bundle } = require("../src/userop");

const E = ethers.parseEther;
const gwei = (x) => ethers.parseUnits(String(x), "gwei");

async function deploy() {
  const [bundler, owner, guardian, thief] = await ethers.getSigners();
  const entryPoint = await ethers.deployContract("EntryPoint");
  const wallet = await ethers.deployContract("SmartWallet", [entryPoint, owner, guardian, E("1")]);
  await bundler.sendTransaction({ to: wallet, value: E("5") });
  return { bundler, owner, guardian, thief, entryPoint, wallet };
}

describe("QA — attacks on the daily limit (thief holds the owner key)", function () {
  it("M1: gas-prefund + withdrawTo cannot move more than the limit out of the wallet", async function () {
    const { owner, thief, entryPoint, wallet } = await loadFixture(deploy);
    // Step 1: an op with an absurd maxFeePerGas makes validateUserOp send a huge "prefund" to the
    // EntryPoint — validation runs BEFORE execute, so the daily limit never sees it.
    // The thief is also the bundler and keeps the priority fee low so most of it stays as a deposit.
    // Size the fee so the prefund is ~4.5 ETH (asking for more than the wallet holds would just fail).
    const totalGas = 150_000n + 100_000n + 50_000n;
    const maxFeePerGas = E("4.5") / totalGas;
    const greedy = await signUserOp(entryPoint, await buildUserOp({
      entryPoint, wallet, dest: thief.address, value: 0n,
      gas: { maxFeePerGas, maxPriorityFeePerGas: 0n, callGasLimit: 100_000n, verificationGasLimit: 150_000n, preVerificationGas: 50_000n },
    }), owner);
    try { await bundle(entryPoint, thief, [greedy]); } catch { /* fixed version refuses it */ }
    // Step 2: move the deposit out through execute (value 0, so the limit is not charged).
    const deposit = await entryPoint.balanceOf(wallet);
    const pull = entryPoint.interface.encodeFunctionData("withdrawTo", [thief.address, deposit]);
    try { await wallet.connect(owner).execute(entryPoint, 0, pull); } catch { /* fixed version refuses it */ }

    const left = await ethers.provider.getBalance(wallet) + (await entryPoint.balanceOf(wallet));
    expect(E("5") - left).to.be.lessThanOrEqual(E("1") + E("0.01")); // ≤ limit (+ fees for one capped op)
  });

  it("M1b: a high priority fee paid to the thief-bundler is capped per operation", async function () {
    const { owner, thief, entryPoint, wallet } = await loadFixture(deploy);
    const thiefBefore = await ethers.provider.getBalance(thief);
    const op = await signUserOp(entryPoint, await buildUserOp({
      entryPoint, wallet, dest: thief.address, value: 0n,
      gas: { maxFeePerGas: E("4") / 1_300_000n, maxPriorityFeePerGas: E("4") / 1_300_000n, preVerificationGas: 1_050_000n },
    }), owner);
    try { await bundle(entryPoint, thief, [op]); } catch { /* fixed version refuses it */ }
    const gained = (await ethers.provider.getBalance(thief)) - thiefBefore;
    expect(gained).to.be.lessThanOrEqual(await wallet.MAX_GAS_COST_PER_OP());
  });

  it("M1c: execute() may not call the EntryPoint (its deposit functions bypass the limit)", async function () {
    const { owner, thief, entryPoint, wallet } = await loadFixture(deploy);
    await entryPoint.depositTo(wallet, { value: E("2") }); // even a deposit someone else made
    const pull = entryPoint.interface.encodeFunctionData("withdrawTo", [thief.address, E("2")]);
    await expect(wallet.connect(owner).execute(entryPoint, 0, pull))
      .to.be.revertedWithCustomError(wallet, "ForbiddenTarget").withArgs(await entryPoint.getAddress());
  });

  it("normal gas settings are still accepted after the fix", async function () {
    const { bundler, owner, entryPoint, wallet } = await loadFixture(deploy);
    const op = await signUserOp(entryPoint, await buildUserOp({ entryPoint, wallet, dest: owner.address, value: E("0.1") }), owner);
    const { events } = await bundle(entryPoint, bundler, [op]);
    expect(events[0].success).to.equal(true);
  });

  it("an op whose gas budget exceeds the cap is refused with AA23 + GasCostTooHigh", async function () {
    const { bundler, owner, entryPoint, wallet } = await loadFixture(deploy);
    const op = await signUserOp(entryPoint, await buildUserOp({ entryPoint, wallet, dest: owner.address, gas: { maxFeePerGas: gwei(1_000_000) } }), owner);
    const err = wallet.interface.encodeErrorResult("GasCostTooHigh", [
      (150_000n + 100_000n + 50_000n) * gwei(1_000_000), await wallet.MAX_GAS_COST_PER_OP()]);
    await expect(entryPoint.handleOps([op], bundler.address))
      .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert").withArgs(0, "AA23 reverted", err);
  });
});

describe("QA — attacks on ZkPrize", function () {
  const { poseidonHash, proveSecret, toSolidity } = require("../src/zk");
  // Base field of BN254 (coordinates of curve points). Negating a point = (x, p - y).
  const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
  const SECRET = 55555555555555555555n;

  async function prizeFixture() {
    const [, alice] = await ethers.getSigners();
    const verifier = await ethers.deployContract("SecretVerifier");
    const prize = await ethers.deployContract("ZkPrize", [verifier, await poseidonHash(SECRET)], { value: E("1") });
    const { proof, publicSignals } = await proveSecret(SECRET, alice.address);
    return { alice, verifier, prize, sol: toSolidity(proof), pub: publicSignals.map(BigInt) };
  }

  it("proof malleability: (-A, -B, C) is ALSO valid, so the prize must not use the proof as its replay key", async function () {
    const { alice, verifier, prize, sol, pub } = await loadFixture(prizeFixture);
    const a2 = [sol.a[0], (P - BigInt(sol.a[1])).toString()];
    const b2 = [sol.b[0], [(P - BigInt(sol.b[1][0])).toString(), (P - BigInt(sol.b[1][1])).toString()]];
    expect(await verifier.verifyProof(a2, b2, sol.c, pub)).to.equal(true); // a second, different-looking valid proof
    await prize.claim(sol.a, sol.b, sol.c, alice.address);
    await expect(prize.claim(a2, b2, sol.c, alice.address)).to.be.revertedWithCustomError(prize, "AlreadyClaimed");
  });

  it("a recipient that refuses ETH: claim reverts as a whole and the prize stays claimable", async function () {
    const { alice, prize } = await loadFixture(prizeFixture);
    const sink = await ethers.deployContract("RefusesEth");
    const bad = toSolidity((await proveSecret(SECRET, await sink.getAddress())).proof);
    await expect(prize.claim(bad.a, bad.b, bad.c, sink)).to.be.revertedWithCustomError(prize, "TransferFailed");
    expect(await prize.claimed()).to.equal(false);
    const good = toSolidity((await proveSecret(SECRET, alice.address)).proof);
    await expect(prize.claim(good.a, good.b, good.c, alice.address)).to.changeEtherBalance(alice, E("1"));
  });
});

describe("QA — known issues (documented behaviour, see QA.md)", function () {
  it("K3: a thief holding the owner key can cancel the guardian's recovery (the daily limit still caps the loss)", async function () {
    const [, owner, guardian] = await ethers.getSigners();
    const entryPoint = await ethers.deployContract("EntryPoint");
    const wallet = await ethers.deployContract("SmartWallet", [entryPoint, owner, guardian, E("1")]);
    await wallet.connect(guardian).startRecovery(guardian);
    await expect(wallet.connect(owner).cancelRecovery()).to.emit(wallet, "RecoveryCancelled"); // "owner" = whoever has the key
  });
});
