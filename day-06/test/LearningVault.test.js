const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LearningVault: deposits, withdrawals, pause, access", function () {
  let vault, owner, alice, bob;
  const eth = (value) => ethers.parseEther(value);
  const vaultBalance = async () => ethers.provider.getBalance(await vault.getAddress());

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    vault = await (await ethers.getContractFactory("LearningVault")).deploy();
    await vault.waitForDeployment();
  });

  describe("constructor and state", function () {
    it("sets the deployer as owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("announces the first owner with OwnershipTransferred(0x0, deployer)", async function () {
      await expect(vault.deploymentTransaction())
        .to.emit(vault, "OwnershipTransferred")
        .withArgs(ethers.ZeroAddress, owner.address);
    });

    it("starts unpaused with nothing tracked", async function () {
      expect(await vault.paused()).to.equal(false);
      expect(await vault.totalDeposits()).to.equal(0n);
      expect(await vault.balances(alice.address)).to.equal(0n);
      expect(await vault.solvencyCheck()).to.equal(true);
    });
  });

  describe("deposit", function () {
    it("records the deposit and emits Deposited(account, amount, newBalance)", async function () {
      await expect(vault.connect(alice).deposit({ value: eth("1") }))
        .to.emit(vault, "Deposited")
        .withArgs(alice.address, eth("1"), eth("1"));
      expect(await vault.balances(alice.address)).to.equal(eth("1"));
      expect(await vault.totalDeposits()).to.equal(eth("1"));
      expect(await vaultBalance()).to.equal(eth("1"));
    });

    it("adds to an existing balance and reports the running total", async function () {
      await vault.connect(alice).deposit({ value: eth("1") });
      await expect(vault.connect(alice).deposit({ value: eth("2") }))
        .to.emit(vault, "Deposited")
        .withArgs(alice.address, eth("2"), eth("3"));
    });

    it("indexes the account in the Deposited event (topic 1 is the address)", async function () {
      const receipt = await (await vault.connect(alice).deposit({ value: 1n })).wait();
      const log = receipt.logs[0];
      expect(log.topics).to.have.length(2); // signature + 1 indexed argument
      expect(log.topics[0]).to.equal(vault.interface.getEvent("Deposited").topicHash);
      expect(ethers.getAddress("0x" + log.topics[1].slice(26))).to.equal(alice.address);
    });

    it("keeps user balances separate", async function () {
      await vault.connect(alice).deposit({ value: eth("1") });
      await vault.connect(bob).deposit({ value: eth("2") });
      expect(await vault.balances(alice.address)).to.equal(eth("1"));
      expect(await vault.balances(bob.address)).to.equal(eth("2"));
      expect(await vault.totalDeposits()).to.equal(eth("3"));
    });

    it("rejects a zero-value deposit", async function () {
      await expect(vault.connect(alice).deposit()).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("accepts the smallest possible deposit, 1 wei", async function () {
      await vault.connect(alice).deposit({ value: 1n });
      expect(await vault.balances(alice.address)).to.equal(1n);
    });

    it("blocks deposits while paused and allows them again after unpausing", async function () {
      await vault.setPaused(true);
      await expect(vault.connect(alice).deposit({ value: 1n })).to.be.revertedWithCustomError(vault, "ContractPaused");
      await vault.setPaused(false);
      await expect(vault.connect(alice).deposit({ value: 1n })).not.to.be.reverted;
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit({ value: eth("3") });
    });

    it("pays out part of the balance and emits Withdrawn(account, amount, remaining)", async function () {
      await expect(vault.connect(alice).withdraw(eth("1")))
        .to.emit(vault, "Withdrawn")
        .withArgs(alice.address, eth("1"), eth("2"));
      expect(await vault.balances(alice.address)).to.equal(eth("2"));
      expect(await vault.totalDeposits()).to.equal(eth("2"));
    });

    it("moves the ETH to the caller", async function () {
      await expect(vault.connect(alice).withdraw(eth("1"))).to.changeEtherBalances(
        [alice, vault],
        [eth("1"), -eth("1")],
      );
    });

    it("allows withdrawing the entire balance (boundary: amount == balance)", async function () {
      await vault.connect(alice).withdraw(eth("3"));
      expect(await vault.balances(alice.address)).to.equal(0n);
      expect(await vault.totalDeposits()).to.equal(0n);
      expect(await vaultBalance()).to.equal(0n);
    });

    it("rejects a zero withdrawal", async function () {
      await expect(vault.connect(alice).withdraw(0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("rejects 1 wei more than the balance, with useful error data", async function () {
      await expect(vault.connect(alice).withdraw(eth("3") + 1n))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(eth("3"), eth("3") + 1n);
    });

    it("does not let one user touch another user's funds", async function () {
      await expect(vault.connect(bob).withdraw(1n))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(0n, 1n);
    });

    it("a failed withdrawal changes nothing", async function () {
      await expect(vault.connect(alice).withdraw(eth("4"))).to.be.reverted;
      expect(await vault.balances(alice.address)).to.equal(eth("3"));
      expect(await vault.totalDeposits()).to.equal(eth("3"));
      expect(await vaultBalance()).to.equal(eth("3"));
    });

    it("can be called again straight after (the guard resets)", async function () {
      await vault.connect(alice).withdraw(eth("1"));
      await vault.connect(alice).withdraw(eth("1"));
      expect(await vault.balances(alice.address)).to.equal(eth("1"));
    });

    it("stays solvent after a withdrawal", async function () {
      await vault.connect(alice).withdraw(eth("1"));
      expect(await vault.solvencyCheck()).to.equal(true);
      expect(await vaultBalance()).to.equal(await vault.totalDeposits());
    });
  });

  describe("access control and pause", function () {
    it("only the owner can pause", async function () {
      await expect(vault.connect(alice).setPaused(true))
        .to.be.revertedWithCustomError(vault, "NotOwner")
        .withArgs(alice.address);
    });

    it("only the owner can unpause", async function () {
      await vault.setPaused(true);
      await expect(vault.connect(alice).setPaused(false))
        .to.be.revertedWithCustomError(vault, "NotOwner")
        .withArgs(alice.address);
      expect(await vault.paused()).to.equal(true);
    });

    it("emits PauseChanged(isPaused, changedBy) and the owner can unpause", async function () {
      await expect(vault.setPaused(true)).to.emit(vault, "PauseChanged").withArgs(true, owner.address);
      expect(await vault.paused()).to.equal(true);
      await expect(vault.setPaused(false)).to.emit(vault, "PauseChanged").withArgs(false, owner.address);
      expect(await vault.paused()).to.equal(false);
    });

    it("does not emit a redundant event when the pause state is unchanged", async function () {
      const receipt = await (await vault.setPaused(false)).wait();
      expect(receipt.logs).to.have.length(0);
    });
  });

  describe("accounting invariants", function () {
    it("totalDeposits equals the sum of the users' balances", async function () {
      await vault.connect(alice).deposit({ value: eth("2") });
      await vault.connect(bob).deposit({ value: eth("5") });
      await vault.connect(alice).withdraw(eth("1"));
      expect(await vault.totalDeposits()).to.equal(
        (await vault.balances(alice.address)) + (await vault.balances(bob.address)),
      );
    });

    it("many small deposits and withdrawals lose nothing", async function () {
      for (let i = 1; i <= 5; i += 1) await vault.connect(alice).deposit({ value: BigInt(i) });
      await vault.connect(alice).withdraw(5n);
      await vault.connect(alice).withdraw(4n);
      expect(await vault.balances(alice.address)).to.equal(6n);
      expect(await vault.totalDeposits()).to.equal(6n);
      expect(await vaultBalance()).to.equal(6n);
    });
  });

  describe("no accidental ETH", function () {
    it("a plain ETH transfer (no function call) is refused", async function () {
      await expect(alice.sendTransaction({ to: await vault.getAddress(), value: 1n })).to.be.reverted;
      expect(await vaultBalance()).to.equal(0n);
    });

    it("an unknown function selector is refused", async function () {
      await expect(alice.sendTransaction({ to: await vault.getAddress(), data: "0xdeadbeef" })).to.be.reverted;
    });
  });
});
