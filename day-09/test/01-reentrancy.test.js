"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ONE = ethers.parseEther("1");
const TEN = ethers.parseEther("10");

describe("1. Re-entrancy", function () {
  async function deploy() {
    const [, alice, bob, thief] = await ethers.getSigners();
    const vulnerable = await ethers.deployContract("VulnerableBank");
    const safe = await ethers.deployContract("SafeBank");
    for (const bank of [vulnerable, safe]) {
      await bank.connect(alice).deposit({ value: ethers.parseEther("6") });
      await bank.connect(bob).deposit({ value: ethers.parseEther("4") });
    }
    return { vulnerable, safe, alice, bob, thief };
  }

  async function runAttack(bank, thief) {
    const attacker = await ethers.deployContract("ReentrancyAttacker", [await bank.getAddress()], thief);
    const before = await ethers.provider.getBalance(thief.address);
    const tx = await attacker.connect(thief).attack({ value: ONE });
    const receipt = await tx.wait();
    const fee = receipt.gasUsed * receipt.gasPrice;
    const profit = (await ethers.provider.getBalance(thief.address)) + fee - before;
    return { attacker, profit };
  }

  it("EXPLOIT: a 1 ETH deposit drains all 11 ETH from VulnerableBank", async function () {
    const { vulnerable, thief } = await loadFixture(deploy);
    const { attacker, profit } = await runAttack(vulnerable, thief);
    expect(await ethers.provider.getBalance(await vulnerable.getAddress())).to.equal(0n);
    expect(profit).to.equal(TEN); // stole other people's 10 ETH (and got its own 1 ETH back)
    expect(await attacker.reentries()).to.equal(10n);
  });

  it("FIX: SafeBank refuses the re-entry; the thief only gets its own 1 ETH back", async function () {
    const { safe, alice, bob, thief } = await loadFixture(deploy);
    const { attacker, profit } = await runAttack(safe, thief);
    expect(profit).to.equal(0n);
    expect(await attacker.reentries()).to.equal(1n);
    expect(await attacker.refused()).to.equal(1n);
    expect(await ethers.provider.getBalance(await safe.getAddress())).to.equal(TEN);
    expect(await safe.balanceOf(alice.address)).to.equal(ethers.parseEther("6"));
    expect(await safe.balanceOf(bob.address)).to.equal(ethers.parseEther("4"));
  });

  it("FIX: the lock also blocks CROSS-function re-entry (withdraw → transfer)", async function () {
    const { safe, thief } = await loadFixture(deploy);
    const cross = await ethers.deployContract("CrossFunctionAttacker", [await safe.getAddress()], thief);
    await expect(cross.connect(thief).attack({ value: ONE })).to.not.be.reverted;
    expect(await cross.transferBlocked()).to.equal(true);
    // It was the LOCK that answered (not just the zeroed balance):
    const lockError = safe.interface.getError("ReentrancyGuardReentrantCall").selector;
    expect(await cross.blockedBy()).to.equal(lockError);
    expect(await safe.balanceOf(await cross.accomplice())).to.equal(0n);
  });

  it("normal use still works: deposit, withdraw, transfer, events and errors", async function () {
    const { safe, alice, bob } = await loadFixture(deploy);
    await expect(safe.connect(alice).transferBalance(bob.address, ONE))
      .to.emit(safe, "Transferred")
      .withArgs(alice.address, bob.address, ONE);
    await expect(safe.connect(alice).transferBalance(bob.address, TEN))
      .to.be.revertedWithCustomError(safe, "InsufficientBalance")
      .withArgs(ethers.parseEther("5"), TEN);
    await expect(safe.connect(alice).transferBalance(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(safe, "ZeroAddress");
    await expect(safe.connect(bob).withdraw()).to.changeEtherBalances([bob, safe], [ethers.parseEther("5"), -ethers.parseEther("5")]);
    await expect(safe.connect(bob).withdraw()).to.be.revertedWithCustomError(safe, "NothingToWithdraw");
  });

  it("a receiver that refuses ETH cannot lose its balance (withdraw reverts, balance kept)", async function () {
    const { safe } = await loadFixture(deploy);
    const refuser = await ethers.deployContract("RefusingDepositor", [await safe.getAddress()]);
    await refuser.depositToBank({ value: ONE });
    await expect(refuser.withdrawFromBank()).to.be.revertedWithCustomError(safe, "TransferFailed");
    expect(await safe.balanceOf(await refuser.getAddress())).to.equal(ONE);
  });
});
