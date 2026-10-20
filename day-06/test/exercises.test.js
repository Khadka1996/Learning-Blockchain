const { expect } = require("chai");
const { ethers } = require("hardhat");

// Proves the worked solutions in exercises/ (contracts/exercises/VaultPlus.sol and the
// tests for exercises 5 and 6 on the real LearningVault).
describe("Exercises: solutions", function () {
  let alice, bob, carol;
  beforeEach(async function () {
    [, alice, bob, carol] = await ethers.getSigners();
  });

  describe("Easy 1-2 and Medium 4: VaultPlus", function () {
    let plus;
    beforeEach(async function () {
      plus = await (await ethers.getContractFactory("VaultPlus")).deploy(1_000n);
      await plus.waitForDeployment();
    });

    it("1: depositCount goes up by one on every successful deposit and only then", async function () {
      expect(await plus.depositCount()).to.equal(0n);
      await plus.connect(alice).deposit({ value: 1_000n });
      await plus.connect(bob).deposit({ value: 2_000n });
      await expect(plus.connect(bob).deposit({ value: 1n })).to.be.reverted; // failed: not counted
      expect(await plus.depositCount()).to.equal(2n);
    });

    it("2: getBalance returns the mapping value", async function () {
      await plus.connect(alice).deposit({ value: 5_000n });
      expect(await plus.getBalance(alice.address)).to.equal(5_000n);
      expect(await plus.getBalance(bob.address)).to.equal(0n);
    });

    it("4: a deposit below the minimum fails with BelowMinimum(sent, minimum); the minimum itself is accepted", async function () {
      await expect(plus.connect(alice).deposit({ value: 999n }))
        .to.be.revertedWithCustomError(plus, "BelowMinimum")
        .withArgs(999n, 1_000n);
      await expect(plus.connect(alice).deposit({ value: 1_000n })).not.to.be.reverted;
    });

    it("refuses re-entry: the same attacker that drains VulnerableVault gets only its own stake", async function () {
      await plus.connect(bob).deposit({ value: 5_000n });
      const attacker = await (await ethers.getContractFactory("ReentrantAttacker")).deploy(await plus.getAddress());
      await attacker.waitForDeployment();
      await attacker.attack({ value: 1_000n });
      expect(await attacker.lastRevertSelector()).to.equal(plus.interface.getError("ReentrantCall").selector);
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(1_000n);
      expect(await plus.getBalance(bob.address)).to.equal(5_000n);
    });

    it("keeps withdrawing safely (same checks-effects-interactions as LearningVault)", async function () {
      await plus.connect(alice).deposit({ value: 5_000n });
      await expect(plus.connect(alice).withdraw(2_000n)).to.changeEtherBalance(alice, 2_000n);
      expect(await plus.getBalance(alice.address)).to.equal(3_000n);
      await expect(plus.connect(alice).withdraw(3_001n)).to.be.revertedWithCustomError(plus, "InsufficientBalance");
    });
  });

  describe("Challenge 9: two-step ownership", function () {
    let plus, deployer;
    beforeEach(async function () {
      [deployer] = await ethers.getSigners();
      plus = await (await ethers.getContractFactory("VaultPlus")).deploy(1n);
      await plus.waitForDeployment();
    });

    it("transferOwnership only nominates: the owner does not change yet", async function () {
      await expect(plus.transferOwnership(alice.address))
        .to.emit(plus, "OwnershipTransferStarted")
        .withArgs(deployer.address, alice.address);
      expect(await plus.owner()).to.equal(deployer.address);
      expect(await plus.pendingOwner()).to.equal(alice.address);
    });

    it("only the pending owner can accept; then ownership moves and pendingOwner clears", async function () {
      await plus.transferOwnership(alice.address);
      await expect(plus.connect(bob).acceptOwnership())
        .to.be.revertedWithCustomError(plus, "NotPendingOwner")
        .withArgs(bob.address);
      await expect(plus.connect(alice).acceptOwnership())
        .to.emit(plus, "OwnershipTransferred")
        .withArgs(deployer.address, alice.address);
      expect(await plus.owner()).to.equal(alice.address);
      expect(await plus.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("a typo address can never take over: nobody holds its key, so nobody can accept", async function () {
      const typo = ethers.Wallet.createRandom().address;
      await plus.transferOwnership(typo);
      await expect(plus.connect(carol).acceptOwnership()).to.be.revertedWithCustomError(plus, "NotPendingOwner");
      expect(await plus.owner()).to.equal(deployer.address); // the real owner is still in charge
    });

    it("only the owner can nominate, and not the zero address", async function () {
      await expect(plus.connect(alice).transferOwnership(bob.address)).to.be.revertedWithCustomError(plus, "NotOwner");
      await expect(plus.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(plus, "ZeroAddress");
    });

    it("the old owner loses power after the handover", async function () {
      await plus.transferOwnership(alice.address);
      await plus.connect(alice).acceptOwnership();
      await expect(plus.transferOwnership(bob.address)).to.be.revertedWithCustomError(plus, "NotOwner");
    });
  });

  describe("Medium 5-6 on the real LearningVault", function () {
    let vault;
    beforeEach(async function () {
      vault = await (await ethers.getContractFactory("LearningVault")).deploy();
      await vault.waitForDeployment();
    });

    it("5: Deposited has exactly one indexed argument, and it is the account", async function () {
      const event = vault.interface.getEvent("Deposited");
      expect(event.inputs.map((i) => [i.name, i.indexed])).to.deep.equal([
        ["account", true],
        ["amount", false],
        ["newBalance", false],
      ]);
    });

    it("6: a reverted withdrawal changes neither the user balance nor totalDeposits", async function () {
      await vault.connect(alice).deposit({ value: 100n });
      await vault.connect(bob).deposit({ value: 50n });
      await expect(vault.connect(alice).withdraw(101n)).to.be.reverted;
      expect(await vault.balances(alice.address)).to.equal(100n);
      expect(await vault.totalDeposits()).to.equal(150n);
    });
  });
});
