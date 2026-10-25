"use strict";
/** Evening audit (independent pass) — regression tests, see QA.md "Evening audit" */
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const FEE = ethers.parseEther("0.01");

async function clubs() {
  const [owner, alice, bob] = await ethers.getSigners();
  const naive = await (await ethers.getContractFactory("ClubNaive")).deploy(FEE);
  const opt = await (await ethers.getContractFactory("ClubOptimized")).deploy(FEE);
  for (const c of [naive, opt]) {
    await c.connect(alice).join(ethers.ZeroAddress, { value: FEE });
    await c.connect(bob).join(alice.address, { value: FEE });
  }
  return { naive, opt, owner, alice, bob };
}

describe("Evening audit — Day 11", function () {
  it("E1: a huge reward on a member who already has points gives the typed PointsOverflow error, not a raw Panic", async function () {
    const { opt, alice } = await clubs(); // alice has 10 points from bob's referral
    await expect(opt.addPointsBatch([alice.address], ethers.MaxUint256))
      .to.be.revertedWithCustomError(opt, "PointsOverflow")
      .withArgs(alice.address);
  });

  it("E2: the same address twice in one batch is rewarded twice and totals stay consistent (both clubs)", async function () {
    const { naive, opt, alice } = await clubs();
    for (const c of [naive, opt]) {
      await c.addPointsBatch([alice.address, alice.address], 5n);
      expect(await c.pointsOf(alice.address)).to.equal(20n);
      expect(await c.totalPoints()).to.equal(20n);
    }
  });

  it("E3: the points cap is exact at the boundary (uint32 max is allowed, +1 is not) even through join()", async function () {
    const { opt, alice, bob } = await clubs();
    const max = 2n ** 32n - 1n;
    await opt.addPointsBatch([alice.address], max - 10n);
    expect(await opt.pointsOf(alice.address)).to.equal(max);
    const [, , , carol] = await ethers.getSigners();
    await expect(opt.connect(carol).join(alice.address, { value: FEE })).to.be.revertedWithCustomError(opt, "PointsOverflow");
    expect(await opt.memberCount()).to.equal(2n); // failed join changed nothing
    expect(bob.address).to.be.a("string");
  });

  it("E4: a non-member in the middle of a batch reverts the whole batch (no partial rewards)", async function () {
    const { opt, alice, bob } = await clubs();
    const stranger = ethers.Wallet.createRandom().address;
    await expect(opt.addPointsBatch([bob.address, stranger, alice.address], 7n)).to.be.revertedWithCustomError(opt, "NotMember");
    expect(await opt.pointsOf(bob.address)).to.equal(0n);
    expect(await opt.pointsOf(alice.address)).to.equal(10n);
  });

  it("E5: a deposit of 0 while capped is rejected cleanly and the box stays consistent", async function () {
    const [owner, alice] = await ethers.getSigners();
    const v1 = await upgrades.deployProxy(await ethers.getContractFactory("PiggyBankV1"), [owner.address], { kind: "uups" });
    await v1.connect(alice).deposit({ value: ethers.parseEther("2") });
    const v2 = await upgrades.upgradeProxy(v1, await ethers.getContractFactory("PiggyBankV2"), {
      call: { fn: "initializeV2", args: [ethers.parseEther("1")] },
    });
    // alice (2 ETH) is now above the 1 ETH cap: a 0-value deposit must still say "ZeroAmount"
    await expect(v2.connect(alice).deposit({ value: 0 })).to.be.revertedWithCustomError(v2, "ZeroAmount");
    expect(await v2.totalDeposits()).to.equal(ethers.parseEther("2"));
  });
});
