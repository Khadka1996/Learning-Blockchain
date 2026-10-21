const { expect } = require("chai");
const { ethers } = require("hardhat");

// Proves the worked solutions in contracts/exercises/TokenPlus.sol.
describe("Exercises: solutions (TokenPlus)", function () {
  let token, owner, alice;
  const CAP = 10_000n;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("TokenPlus")).deploy("Plus", "PLUS", 5_000n, CAP);
    await token.waitForDeployment();
  });

  describe("Easy 1: increaseAllowance / decreaseAllowance", function () {
    it("adds to and subtracts from the current allowance (approve overwrites; these adjust)", async function () {
      await token.approve(alice.address, 100n);
      await token.increaseAllowance(alice.address, 50n);
      expect(await token.allowance(owner.address, alice.address)).to.equal(150n);
      await token.decreaseAllowance(alice.address, 30n);
      expect(await token.allowance(owner.address, alice.address)).to.equal(120n);
    });

    it("emits Approval with the NEW total", async function () {
      await token.approve(alice.address, 100n);
      await expect(token.increaseAllowance(alice.address, 5n)).to.emit(token, "Approval").withArgs(owner.address, alice.address, 105n);
    });

    it("decreasing below zero reverts instead of silently clamping", async function () {
      await token.approve(alice.address, 10n);
      await expect(token.decreaseAllowance(alice.address, 11n))
        .to.be.revertedWithCustomError(token, "AllowanceBelowZero")
        .withArgs(alice.address, 10n, 11n);
    });

    it("they do not suffer the race: after the spender used 100, decrease-by-50 fails instead of re-granting", async function () {
      await token.approve(alice.address, 100n);
      await token.connect(alice).transferFrom(owner.address, alice.address, 100n);
      await expect(token.decreaseAllowance(alice.address, 50n)).to.be.revertedWithCustomError(token, "AllowanceBelowZero");
    });
  });

  describe("Easy 2: burnFrom", function () {
    it("burns using an allowance and reduces totalSupply", async function () {
      await token.approve(alice.address, 300n);
      await token.connect(alice).burnFrom(owner.address, 200n);
      expect(await token.totalSupply()).to.equal(4_800n);
      expect(await token.allowance(owner.address, alice.address)).to.equal(100n);
    });

    it("needs an allowance", async function () {
      await expect(token.connect(alice).burnFrom(owner.address, 1n)).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Medium 4: owner-only capped mint", function () {
    it("the owner can mint up to the cap, not past it", async function () {
      await token.mint(alice.address, 5_000n);
      expect(await token.totalSupply()).to.equal(CAP);
      await expect(token.mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "ExceededCap")
        .withArgs(CAP + 1n, CAP);
    });

    it("a stranger cannot mint", async function () {
      await expect(token.connect(alice).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "NotOwner")
        .withArgs(alice.address);
    });

    it("cannot be deployed over its own cap", async function () {
      const Factory = await ethers.getContractFactory("TokenPlus");
      await expect(Factory.deploy("X", "X", CAP + 1n, CAP)).to.be.revertedWithCustomError(token, "ExceededCap");
    });
  });

  describe("Medium 5: approveIfCurrent closes the approve race", function () {
    it("works when the allowance is what you expected", async function () {
      await token.approve(alice.address, 100n);
      await token.approveIfCurrent(alice.address, 100n, 50n);
      expect(await token.allowance(owner.address, alice.address)).to.equal(50n);
    });

    it("REVERTS when the spender already used part of it: no second allowance is created", async function () {
      await token.approve(alice.address, 100n);
      await token.connect(alice).transferFrom(owner.address, alice.address, 100n); // the front-run
      await expect(token.approveIfCurrent(alice.address, 100n, 50n))
        .to.be.revertedWithCustomError(token, "AllowanceChanged")
        .withArgs(0n, 100n);
      await expect(token.connect(alice).transferFrom(owner.address, alice.address, 50n)).to.be.reverted; // nothing more to take
      expect(await token.balanceOf(alice.address)).to.equal(100n);
    });
  });
});
