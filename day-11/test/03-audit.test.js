"use strict";
/** Regression tests for the QA / pentest findings in QA.md */
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ONE = ethers.parseEther("1");

async function deploy() {
  const [owner, alice, eve] = await ethers.getSigners();
  const bank = await upgrades.deployProxy(await ethers.getContractFactory("PiggyBankV1"), [owner.address], { kind: "uups" });
  return { bank, owner, alice, eve };
}

describe("QA findings — Day 11", function () {
  it("L1: a mistyped new owner cannot take (or lose) upgrade control — ownership is two-step", async function () {
    const { bank, owner, eve } = await deploy();
    const typo = ethers.Wallet.createRandom().address;
    await bank.connect(owner).transferOwnership(typo);
    expect(await bank.owner()).to.equal(owner.address); // still the owner until accepted
    expect(await bank.pendingOwner()).to.equal(typo);
    await bank.connect(owner).transferOwnership(eve.address); // fix the typo
    await bank.connect(eve).acceptOwnership();
    expect(await bank.owner()).to.equal(eve.address);
  });

  it("P1: after an upgrade WITHOUT the init call, nobody but the owner can run initializeV2 (no init front-running)", async function () {
    const { bank, owner, eve } = await deploy();
    const v2impl = await (await ethers.getContractFactory("PiggyBankV2")).deploy();
    await bank.connect(owner).upgradeToAndCall(await v2impl.getAddress(), "0x");
    const v2 = await ethers.getContractAt("PiggyBankV2", await bank.getAddress());
    await expect(v2.connect(eve).initializeV2(1)).to.be.revertedWithCustomError(v2, "OwnableUnauthorizedAccount");
    expect(await v2.maxPerUser()).to.equal(0n); // safe default: no cap, nothing locked
    await v2.connect(owner).initializeV2(ONE);
    expect(await v2.maxPerUser()).to.equal(ONE);
  });

  it("P2: the V2 implementation is locked too", async function () {
    const [, , eve] = await ethers.getSigners();
    const v2impl = await (await ethers.getContractFactory("PiggyBankV2")).deploy();
    await expect(v2impl.connect(eve).initialize(eve.address)).to.be.revertedWithCustomError(v2impl, "InvalidInitialization");
    await expect(v2impl.connect(eve).initializeV2(1)).to.be.revertedWithCustomError(v2impl, "InvalidInitialization");
  });

  it("P3: lowering the cap below existing balances never traps money", async function () {
    const { bank, owner, alice } = await deploy();
    await bank.connect(alice).deposit({ value: 4n * ONE });
    const v2 = await upgrades.upgradeProxy(await bank.getAddress(), await ethers.getContractFactory("PiggyBankV2"), {
      call: { fn: "initializeV2", args: [ONE] },
    });
    await v2.connect(owner).setPaused(true);
    await expect(v2.connect(alice).withdraw(4n * ONE)).to.changeEtherBalance(alice, 4n * ONE);
  });

  it("P4: ETH forced into the box (no deposit) does not change anyone's books", async function () {
    const { bank, alice } = await deploy();
    await bank.connect(alice).deposit({ value: ONE });
    await ethers.provider.send("hardhat_setBalance", [await bank.getAddress(), ethers.toQuantity(5n * ONE)]);
    expect(await bank.totalDeposits()).to.equal(ONE);
    expect(await bank.balanceOf(alice.address)).to.equal(ONE);
  });

  it("P5: plain ETH transfers without deposit() are refused (no silent loss)", async function () {
    const { bank, alice } = await deploy();
    await expect(alice.sendTransaction({ to: await bank.getAddress(), value: ONE })).to.be.reverted;
  });
});
