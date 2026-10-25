"use strict";
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ONE = ethers.parseEther("1");
// ERC-1967: the implementation address lives at keccak256("eip1967.proxy.implementation") - 1
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implOf(proxy) {
  const raw = await ethers.provider.getStorage(await proxy.getAddress(), IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

describe("PiggyBank — UUPS upgradeable proxy", function () {
  async function deployV1() {
    const [owner, alice, bob, eve] = await ethers.getSigners();
    const V1 = await ethers.getContractFactory("PiggyBankV1");
    const bank = await upgrades.deployProxy(V1, [owner.address], { kind: "uups", initializer: "initialize" });
    await bank.connect(alice).deposit({ value: 3n * ONE });
    await bank.connect(bob).deposit({ value: 2n * ONE });
    return { bank, owner, alice, bob, eve };
  }

  async function upgradedToV2() {
    const f = await deployV1();
    const proxyAddress = await f.bank.getAddress();
    const implBefore = await implOf(f.bank);
    const V2 = await ethers.getContractFactory("PiggyBankV2");
    const bank = await upgrades.upgradeProxy(await f.bank.getAddress(), V2, {
      call: { fn: "initializeV2", args: [5n * ONE] },
    });
    return { ...f, bank, proxyAddress, implBefore };
  }

  describe("V1", function () {
    it("deposits and withdraws through the proxy; money sits in the proxy", async function () {
      const { bank, alice } = await loadFixture(deployV1);
      expect(await bank.version()).to.equal("1.0.0");
      expect(await bank.balanceOf(alice.address)).to.equal(3n * ONE);
      expect(await bank.totalDeposits()).to.equal(5n * ONE);
      expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(5n * ONE);
      await expect(bank.connect(alice).withdraw(ONE)).to.changeEtherBalance(alice, ONE);
      expect(await bank.totalDeposits()).to.equal(4n * ONE);
    });

    it("rejects zero amounts and over-withdrawals", async function () {
      const { bank, alice } = await loadFixture(deployV1);
      await expect(bank.connect(alice).deposit({ value: 0 })).to.be.revertedWithCustomError(bank, "ZeroAmount");
      await expect(bank.connect(alice).withdraw(0)).to.be.revertedWithCustomError(bank, "ZeroAmount");
      await expect(bank.connect(alice).withdraw(4n * ONE))
        .to.be.revertedWithCustomError(bank, "InsufficientBalance")
        .withArgs(4n * ONE, 3n * ONE);
    });

    it("initialize can run only once (no takeover by re-initializing)", async function () {
      const { bank, eve } = await loadFixture(deployV1);
      await expect(bank.connect(eve).initialize(eve.address)).to.be.revertedWithCustomError(bank, "InvalidInitialization");
    });

    it("the bare implementation is locked: nobody can initialize it", async function () {
      const { bank, eve } = await loadFixture(deployV1);
      const impl = await ethers.getContractAt("PiggyBankV1", await implOf(bank));
      await expect(impl.connect(eve).initialize(eve.address)).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });

    it("blocks re-entrancy on withdraw", async function () {
      const { bank } = await loadFixture(deployV1);
      const attacker = await (await ethers.getContractFactory("Reenterer")).deploy(await bank.getAddress());
      await expect(attacker.attack({ value: ONE })).to.be.revertedWithCustomError(bank, "TransferFailed");
      expect(await bank.totalDeposits()).to.equal(5n * ONE);
    });
  });

  describe("upgrade V1 -> V2", function () {
    it("keeps the same address, balances and ETH; only the logic changes", async function () {
      const { bank, alice, bob, proxyAddress, implBefore } = await loadFixture(upgradedToV2);
      expect(await bank.getAddress()).to.equal(proxyAddress);
      expect(await implOf(bank)).to.not.equal(implBefore);
      expect(await bank.version()).to.equal("2.0.0");
      expect(await bank.balanceOf(alice.address)).to.equal(3n * ONE);
      expect(await bank.balanceOf(bob.address)).to.equal(2n * ONE);
      expect(await bank.totalDeposits()).to.equal(5n * ONE);
      expect(await bank.maxPerUser()).to.equal(5n * ONE);
    });

    it("new features: per-user cap and pause (withdrawals still allowed while paused)", async function () {
      const { bank, owner, alice } = await loadFixture(upgradedToV2);
      await expect(bank.connect(alice).deposit({ value: 3n * ONE }))
        .to.be.revertedWithCustomError(bank, "CapExceeded")
        .withArgs(6n * ONE, 5n * ONE);
      await bank.connect(alice).deposit({ value: 2n * ONE });
      await bank.connect(owner).setPaused(true);
      await expect(bank.connect(alice).deposit({ value: 1n })).to.be.revertedWithCustomError(bank, "DepositsPaused");
      await expect(bank.connect(alice).withdraw(5n * ONE)).to.changeEtherBalance(alice, 5n * ONE);
    });

    it("initializeV2 runs once and only for the owner", async function () {
      const { bank, owner, eve } = await loadFixture(upgradedToV2);
      await expect(bank.connect(owner).initializeV2(1)).to.be.revertedWithCustomError(bank, "InvalidInitialization");
      await expect(bank.connect(eve).setCap(0)).to.be.revertedWithCustomError(bank, "OwnableUnauthorizedAccount");
      await expect(bank.connect(eve).setPaused(true)).to.be.revertedWithCustomError(bank, "OwnableUnauthorizedAccount");
    });

    it("a stranger cannot upgrade", async function () {
      const { bank, eve } = await loadFixture(deployV1);
      const v2 = await (await ethers.getContractFactory("PiggyBankV2")).deploy();
      await expect(bank.connect(eve).upgradeToAndCall(await v2.getAddress(), "0x"))
        .to.be.revertedWithCustomError(bank, "OwnableUnauthorizedAccount")
        .withArgs(eve.address);
    });

    it("refuses to upgrade to a contract without UUPS (would brick the proxy)", async function () {
      const { bank, owner } = await loadFixture(deployV1);
      const brick = await (await ethers.getContractFactory("NotUpgradeable")).deploy();
      await expect(bank.connect(owner).upgradeToAndCall(await brick.getAddress(), "0x"))
        .to.be.revertedWithCustomError(bank, "ERC1967InvalidImplementation");
      expect(await bank.version()).to.equal("1.0.0");
    });

    it("upgradeToAndCall must go through the proxy, not the implementation", async function () {
      const { bank, owner } = await loadFixture(deployV1);
      const impl = await ethers.getContractAt("PiggyBankV1", await implOf(bank));
      const v2 = await (await ethers.getContractFactory("PiggyBankV2")).deploy();
      await expect(impl.connect(owner).upgradeToAndCall(await v2.getAddress(), "0x"))
        .to.be.revertedWithCustomError(impl, "UUPSUnauthorizedCallContext");
    });
  });

  describe("the classic mistake: reordered storage", function () {
    it("hardhat-upgrades refuses the broken V2 before it is deployed", async function () {
      const { bank } = await loadFixture(deployV1);
      const Broken = await ethers.getContractFactory("PiggyBankV2Broken");
      await expect(upgrades.validateUpgrade(await bank.getAddress(), Broken, { kind: "uups" })).to.be.rejectedWith(
        /New storage layout is incompatible[\s\S]*balanceOf/
      );
    });

    it("forced anyway, every balance reads from the wrong slot", async function () {
      const { bank, owner, alice } = await loadFixture(deployV1);
      const broken = await (await ethers.getContractFactory("PiggyBankV2Broken")).deploy();
      await bank.connect(owner).upgradeToAndCall(await broken.getAddress(), "0x");
      const b = await ethers.getContractAt("PiggyBankV2Broken", await bank.getAddress());
      // ETH is still there, but the books are garbage:
      expect(await ethers.provider.getBalance(await b.getAddress())).to.equal(5n * ONE);
      expect(await b.totalDeposits()).to.equal(0n); // reads slot 0 (old mapping root, always 0)
      expect(await b.balanceOf(alice.address)).to.equal(0n); // looks up keccak(alice, 1) — empty
    });
  });
});
