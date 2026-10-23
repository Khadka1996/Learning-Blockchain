"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const eth = (n) => ethers.parseEther(String(n));

describe("5. Denial of service (push payments)", function () {
  async function deploy() {
    const [, alice, bob, carol, attacker] = await ethers.getSigners();
    const vulnerable = await ethers.deployContract("KingOfTheHill");
    const safe = await ethers.deployContract("SafeKingOfTheHill");
    const stubborn = await ethers.deployContract("StubbornKing", [], attacker);
    return { alice, bob, carol, attacker, vulnerable, safe, stubborn };
  }

  it("works while everyone can receive ETH: the old king is refunded", async function () {
    const { alice, bob, vulnerable } = await loadFixture(deploy);
    await vulnerable.connect(alice).claimThrone({ value: eth(1) });
    await expect(vulnerable.connect(bob).claimThrone({ value: eth(2) })).to.changeEtherBalance(alice, eth(1));
    await expect(vulnerable.connect(alice).claimThrone({ value: eth(2) }))
      .to.be.revertedWithCustomError(vulnerable, "BidTooLow")
      .withArgs(eth(2), eth(2));
  });

  it("EXPLOIT: a king that refuses refunds freezes the game forever", async function () {
    const { alice, bob, carol, vulnerable, stubborn, attacker } = await loadFixture(deploy);
    await vulnerable.connect(alice).claimThrone({ value: eth(1) });
    await stubborn.connect(attacker).seize(await vulnerable.getAddress(), { value: eth(1.5) });
    for (const [who, bid] of [[bob, 3], [carol, 10], [alice, 100]]) {
      await expect(vulnerable.connect(who).claimThrone({ value: eth(bid) })).to.be.revertedWithCustomError(vulnerable, "RefundFailed");
    }
    expect(await vulnerable.king()).to.equal(await stubborn.getAddress());
  });

  it("FIX: with pull payments the game goes on; the stubborn king only hurts itself", async function () {
    const { alice, bob, carol, safe, stubborn, attacker } = await loadFixture(deploy);
    await safe.connect(alice).claimThrone({ value: eth(1) });
    await stubborn.connect(attacker).seize(await safe.getAddress(), { value: eth(1.5) });
    await safe.connect(bob).claimThrone({ value: eth(3) });
    await safe.connect(carol).claimThrone({ value: eth(10) });
    expect(await safe.king()).to.equal(carol.address);
    expect(await safe.pendingReturns(await stubborn.getAddress())).to.equal(eth(1.5));
    await expect(safe.connect(alice).withdraw()).to.changeEtherBalance(alice, eth(1));
    await expect(safe.connect(bob).withdraw()).to.changeEtherBalance(bob, eth(3));
    await expect(safe.connect(bob).withdraw()).to.be.revertedWithCustomError(safe, "NothingToWithdraw");
    // Contract always holds exactly: current prize + everything still owed.
    const owed = (await safe.pendingReturns(await stubborn.getAddress())) + (await safe.prize());
    expect(await ethers.provider.getBalance(await safe.getAddress())).to.equal(owed);
  });

  it("FIX: an equal bid is still too low, and the same person can raise their own bid", async function () {
    const { alice, safe } = await loadFixture(deploy);
    await expect(safe.connect(alice).claimThrone({ value: 0n })).to.be.revertedWithCustomError(safe, "BidTooLow");
    await safe.connect(alice).claimThrone({ value: eth(1) });
    await expect(safe.connect(alice).claimThrone({ value: eth(1) })).to.be.revertedWithCustomError(safe, "BidTooLow");
    await safe.connect(alice).claimThrone({ value: eth(2) });
    expect(await safe.pendingReturns(alice.address)).to.equal(eth(1));
  });
});
