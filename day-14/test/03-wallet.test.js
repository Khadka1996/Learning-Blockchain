"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { buildUserOp, signUserOp, bundle } = require("../src/userop");

const E = ethers.parseEther;

async function deploy() {
  const [bundler, owner, guardian, bob, mallory, newOwner] = await ethers.getSigners();
  const entryPoint = await ethers.deployContract("EntryPoint");
  const wallet = await ethers.deployContract("SmartWallet", [entryPoint, owner, guardian, E("1")]);
  await bundler.sendTransaction({ to: wallet, value: E("5") });
  const send = async (signer, args) => signUserOp(entryPoint, await buildUserOp({ entryPoint, wallet, ...args }), signer);
  return { bundler, owner, guardian, bob, mallory, newOwner, entryPoint, wallet, send };
}

describe("SmartWallet — ERC-4337 user operations", function () {
  it("owner-signed UserOperation sends ETH; the wallet pays the gas and the bundler is refunded", async function () {
    const { bundler, owner, bob, entryPoint, wallet, send } = await loadFixture(deploy);
    const op = await send(owner, { dest: bob.address, value: E("0.1") });
    const bobBefore = await ethers.provider.getBalance(bob);
    const walletBefore = await ethers.provider.getBalance(wallet);
    const bundlerBefore = await ethers.provider.getBalance(bundler);

    const { receipt, events } = await bundle(entryPoint, bundler, [op]);
    expect(events).to.have.length(1);
    expect(events[0].success).to.equal(true);
    expect(await ethers.provider.getBalance(bob)).to.equal(bobBefore + E("0.1"));

    // The wallet paid 0.1 ETH + gas (part may sit as a deposit in the EntryPoint for next time).
    const deposit = await entryPoint.balanceOf(wallet);
    const walletAfter = await ethers.provider.getBalance(wallet);
    expect(walletBefore - walletAfter - deposit).to.equal(E("0.1") + events[0].actualGasCost);
    // The bundler paid the transaction gas but got actualGasCost back (it should not lose money).
    const bundlerSpent = receipt.gasUsed * receipt.gasPrice;
    expect(await ethers.provider.getBalance(bundler)).to.equal(bundlerBefore - bundlerSpent + events[0].actualGasCost);
    expect(await wallet.getNonce()).to.equal(1);
  });

  it("a UserOperation signed by someone else is rejected with AA24 (nothing happens)", async function () {
    const { bundler, mallory, entryPoint, wallet, send } = await loadFixture(deploy);
    const op = await send(mallory, { dest: mallory.address, value: E("1") });
    await expect(entryPoint.handleOps([op], bundler.address))
      .to.be.revertedWithCustomError(entryPoint, "FailedOp").withArgs(0, "AA24 signature error");
    expect(await wallet.getNonce()).to.equal(0);
  });

  it("garbage / short / wrong-length signatures return 'failed', never crash validation", async function () {
    const { bundler, owner, entryPoint, wallet } = await loadFixture(deploy);
    for (const sig of ["0x", "0x1234", "0x" + "00".repeat(65), "0x" + "ff".repeat(65), "0x" + "11".repeat(64)]) {
      const op = { ...(await buildUserOp({ entryPoint, wallet, dest: owner.address })), signature: sig };
      await expect(entryPoint.handleOps([op], bundler.address))
        .to.be.revertedWithCustomError(entryPoint, "FailedOp").withArgs(0, "AA24 signature error");
    }
  });

  it("replaying a used UserOperation fails (nonce) with AA25", async function () {
    const { bundler, owner, bob, entryPoint, send } = await loadFixture(deploy);
    const op = await send(owner, { dest: bob.address, value: E("0.1") });
    await bundle(entryPoint, bundler, [op]);
    await expect(entryPoint.handleOps([op], bundler.address))
      .to.be.revertedWithCustomError(entryPoint, "FailedOp").withArgs(0, "AA25 invalid account nonce");
  });

  it("a signature is bound to the chain + EntryPoint: changing any field invalidates it", async function () {
    const { bundler, owner, mallory, entryPoint, send } = await loadFixture(deploy);
    const op = await send(owner, { dest: owner.address, value: E("0.1") });
    const tampered = { ...op, callData: op.callData.replace(owner.address.slice(2).toLowerCase(), mallory.address.slice(2).toLowerCase()) };
    expect(tampered.callData).to.not.equal(op.callData);
    await expect(entryPoint.handleOps([tampered], bundler.address))
      .to.be.revertedWithCustomError(entryPoint, "FailedOp").withArgs(0, "AA24 signature error");
  });

  it("only the EntryPoint or the owner can call execute / validateUserOp", async function () {
    const { owner, mallory, bob, wallet, entryPoint } = await loadFixture(deploy);
    await expect(wallet.connect(mallory).execute(mallory.address, E("1"), "0x"))
      .to.be.revertedWithCustomError(wallet, "NotAuthorized").withArgs(mallory.address);
    const op = await buildUserOp({ entryPoint, wallet, dest: bob.address });
    await expect(wallet.connect(mallory).validateUserOp(op, ethers.ZeroHash, 0)).to.be.revertedWith("account: not from EntryPoint");
    await expect(wallet.connect(owner).execute(bob.address, E("0.2"), "0x")).to.changeEtherBalance(bob, E("0.2"));
  });

  it("several users' operations go into ONE bundle transaction", async function () {
    const { bundler, owner, guardian, bob, entryPoint, send } = await loadFixture(deploy);
    const wallet2 = await ethers.deployContract("SmartWallet", [entryPoint, bob, guardian, E("1")]);
    await bundler.sendTransaction({ to: wallet2, value: E("1") });
    const op1 = await send(owner, { dest: guardian.address, value: E("0.01") });
    const op2 = await signUserOp(entryPoint, await buildUserOp({ entryPoint, wallet: wallet2, dest: guardian.address, value: E("0.02") }), bob);
    const { events } = await bundle(entryPoint, bundler, [op1, op2]);
    expect(events.map((e) => e.success)).to.deep.equal([true, true]);
  });
});

describe("SmartWallet — daily spending limit", function () {
  it("allows up to the limit, then the inner call fails (the op is still paid for)", async function () {
    const { bundler, owner, bob, entryPoint, wallet, send } = await loadFixture(deploy);
    await bundle(entryPoint, bundler, [await send(owner, { dest: bob.address, value: E("0.6") })]);
    expect(await wallet.remainingToday()).to.equal(E("0.4"));
    const bobBefore = await ethers.provider.getBalance(bob);
    const { events } = await bundle(entryPoint, bundler, [await send(owner, { dest: bob.address, value: E("0.5") })]);
    expect(events[0].success).to.equal(false); // DailyLimitExceeded inside execute
    expect(events[0].actualGasCost).to.be.greaterThan(0n);
    expect(await ethers.provider.getBalance(bob)).to.equal(bobBefore);
    await expect(wallet.connect(owner).execute(bob.address, E("0.5"), "0x"))
      .to.be.revertedWithCustomError(wallet, "DailyLimitExceeded").withArgs(E("0.5"), E("0.4"));
  });

  it("resets the next day", async function () {
    const { owner, bob, wallet } = await loadFixture(deploy);
    await wallet.connect(owner).execute(bob.address, E("1"), "0x");
    expect(await wallet.remainingToday()).to.equal(0);
    await time.increase(24 * 3600);
    expect(await wallet.remainingToday()).to.equal(E("1"));
    await expect(wallet.connect(owner).execute(bob.address, E("1"), "0x")).to.changeEtherBalance(bob, E("1"));
  });

  it("the owner can only LOWER the limit (via the wallet itself); the guardian can set any", async function () {
    const { owner, guardian, mallory, wallet } = await loadFixture(deploy);
    const lower = wallet.interface.encodeFunctionData("setDailyLimit", [E("0.5")]);
    const raise = wallet.interface.encodeFunctionData("setDailyLimit", [E("100")]);
    await wallet.connect(owner).execute(wallet, 0, lower);
    expect(await wallet.dailyLimit()).to.equal(E("0.5"));
    await expect(wallet.connect(owner).execute(wallet, 0, raise)).to.be.revertedWithCustomError(wallet, "CallFailed");
    await expect(wallet.connect(owner).setDailyLimit(E("100"))).to.be.revertedWithCustomError(wallet, "NotAuthorized");
    await expect(wallet.connect(mallory).setDailyLimit(E("100"))).to.be.revertedWithCustomError(wallet, "NotAuthorized");
    await wallet.connect(guardian).setDailyLimit(E("2"));
    expect(await wallet.dailyLimit()).to.equal(E("2"));
  });
});

describe("SmartWallet — guardian recovery", function () {
  it("guardian starts, waits 2 days, new owner takes over; the old key is useless", async function () {
    const { bundler, owner, guardian, newOwner, bob, entryPoint, wallet, send } = await loadFixture(deploy);
    await expect(wallet.connect(guardian).startRecovery(newOwner)).to.emit(wallet, "RecoveryStarted");
    await expect(wallet.finishRecovery()).to.be.revertedWithCustomError(wallet, "RecoveryNotReady");
    await time.increase(2 * 24 * 3600);
    await expect(wallet.finishRecovery()).to.emit(wallet, "OwnerChanged").withArgs(owner.address, newOwner.address);
    expect(await wallet.owner()).to.equal(newOwner.address);

    await expect(entryPoint.handleOps([await send(owner, { dest: bob.address, value: E("0.1") })], bundler.address))
      .to.be.revertedWithCustomError(entryPoint, "FailedOp").withArgs(0, "AA24 signature error");
    const { events } = await bundle(entryPoint, bundler, [await send(newOwner, { dest: bob.address, value: E("0.1") })]);
    expect(events[0].success).to.equal(true);
  });

  it("the real owner can cancel a recovery they did not ask for", async function () {
    const { owner, guardian, mallory, wallet } = await loadFixture(deploy);
    await wallet.connect(guardian).startRecovery(mallory);
    await expect(wallet.connect(mallory).cancelRecovery()).to.be.revertedWithCustomError(wallet, "NotAuthorized");
    await expect(wallet.connect(owner).cancelRecovery()).to.emit(wallet, "RecoveryCancelled").withArgs(mallory.address);
    await time.increase(3 * 24 * 3600);
    await expect(wallet.finishRecovery()).to.be.revertedWithCustomError(wallet, "NoRecoveryPending");
    expect(await wallet.owner()).to.equal(owner.address);
  });

  it("only the guardian can start a recovery, and not to address(0)", async function () {
    const { guardian, mallory, wallet } = await loadFixture(deploy);
    await expect(wallet.connect(mallory).startRecovery(mallory)).to.be.revertedWithCustomError(wallet, "NotAuthorized");
    await expect(wallet.connect(guardian).startRecovery(ethers.ZeroAddress)).to.be.revertedWithCustomError(wallet, "ZeroAddress");
  });
});
