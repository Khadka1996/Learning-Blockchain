const { expect } = require("chai");
const { ethers } = require("hardhat");

// Attack scenarios. The order matters: first we PROVE the attacker contract works against
// a deliberately broken vault, so that "the attack fails" against LearningVault means something.
describe("LearningVault: attacks", function () {
  const eth = (v) => ethers.parseEther(v);
  let owner, victim, bystander;
  const deploy = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const balanceOf = async (c) => ethers.provider.getBalance(await c.getAddress());

  beforeEach(async function () {
    [owner, victim, bystander] = await ethers.getSigners();
  });

  describe("reentrancy", function () {
    it("control: the attacker DRAINS a vault that sends before it updates (VulnerableVault)", async function () {
      const bad = await deploy("VulnerableVault");
      await bad.connect(victim).deposit({ value: eth("5") });
      const attacker = await deploy("ReentrantAttacker", await bad.getAddress());

      await attacker.attack({ value: eth("1") });

      expect(await balanceOf(attacker)).to.equal(eth("6")); // its own 1 ETH + all of the victim's 5
      expect(await balanceOf(bad)).to.equal(0n);
      expect(await attacker.reentries()).to.be.greaterThan(0n);
    });

    it("LearningVault refuses the re-entry with ReentrantCall, and the attacker gets only its own stake", async function () {
      const vault = await deploy("LearningVault");
      await vault.connect(victim).deposit({ value: eth("5") });
      const attacker = await deploy("ReentrantAttacker", await vault.getAddress());

      await attacker.attack({ value: eth("1") });

      expect(await attacker.lastReentryFailed()).to.equal(true);
      expect(await attacker.lastRevertSelector()).to.equal(vault.interface.getError("ReentrantCall").selector);
      expect(await balanceOf(attacker)).to.equal(eth("1")); // exactly its own stake back
      expect(await balanceOf(vault)).to.equal(eth("5")); // the victim's money is untouched
      expect(await vault.balances(victim.address)).to.equal(eth("5"));
      expect(await vault.totalDeposits()).to.equal(eth("5"));
    });

    it("a receiver that re-deposits mid-withdrawal keeps exact accounting", async function () {
      const vault = await deploy("LearningVault");
      const redeposit = await deploy("RedepositingReceiver", await vault.getAddress());

      await redeposit.depositThenWithdraw({ value: 100n });

      expect(await vault.balances(await redeposit.getAddress())).to.equal(50n);
      expect(await vault.totalDeposits()).to.equal(50n);
      expect(await balanceOf(vault)).to.equal(50n);
      expect(await vault.solvencyCheck()).to.equal(true);
    });
  });

  describe("failing payouts", function () {
    it("a recipient that rejects ETH makes the whole withdrawal revert (TransferFailed)", async function () {
      const vault = await deploy("LearningVault");
      const rejecting = await deploy("RejectingReceiver");
      await rejecting.depositInto(await vault.getAddress(), { value: 10n });

      await expect(rejecting.withdrawFrom(await vault.getAddress(), 10n)).to.be.revertedWithCustomError(
        vault,
        "TransferFailed",
      );

      // The state change was rolled back with the failed payout: nothing was lost.
      expect(await vault.balances(await rejecting.getAddress())).to.equal(10n);
      expect(await vault.totalDeposits()).to.equal(10n);
      expect(await balanceOf(vault)).to.equal(10n);
    });
  });

  describe("forced ETH", function () {
    it("ETH pushed in by selfdestruct is accepted but never credited to anyone", async function () {
      const vault = await deploy("LearningVault");
      await vault.connect(victim).deposit({ value: 100n });

      await deploy("ForceSender", await vault.getAddress(), { value: 7n });

      expect(await balanceOf(vault)).to.equal(107n);
      expect(await vault.totalDeposits()).to.equal(100n);
      expect(await vault.solvencyCheck()).to.equal(true); // >=, so extra ETH does not break the check
    });

    it("the owner and users still behave normally after ETH was forced in", async function () {
      const vault = await deploy("LearningVault");
      await vault.connect(victim).deposit({ value: 100n });
      await deploy("ForceSender", await vault.getAddress(), { value: 7n });

      await vault.connect(victim).withdraw(100n);
      expect(await vault.balances(victim.address)).to.equal(0n);
      expect(await balanceOf(vault)).to.equal(7n); // the stray 7 wei stays, owed to nobody
    });
  });

  describe("access control", function () {
    it("a bystander cannot pause, even by front-running a deposit", async function () {
      const vault = await deploy("LearningVault");
      await expect(vault.connect(bystander).setPaused(true)).to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.connect(victim).deposit({ value: 1n })).not.to.be.reverted;
    });

    it("owner is immutable: nobody, not even the owner, can hand over or change it", async function () {
      const vault = await deploy("LearningVault");
      const functions = vault.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      expect(functions).to.not.include.members(["transferOwnership", "setOwner", "renounceOwnership"]);
      expect(await vault.owner()).to.equal(owner.address);
    });
  });
});
