const { expect } = require("chai");
const { ethers } = require("hardhat");
const { signPermit, latestTimestamp } = require("./helpers/permit");

describe("TokenVault: a contract that spends other people's tokens", function () {
  const SUPPLY = ethers.parseEther("1000000");
  let vault, token, owner, alice, bob, mallory;
  const deploy = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const addr = (c) => c.getAddress();

  beforeEach(async function () {
    [owner, alice, bob, mallory] = await ethers.getSigners();
    vault = await deploy("TokenVault");
    token = await deploy("LearningToken", owner.address, SUPPLY, SUPPLY * 2n);
    await token.transfer(alice.address, 10_000n);
    await token.transfer(bob.address, 10_000n);
  });

  describe("the approve -> transferFrom dance with a normal token", function () {
    it("deposit fails without an allowance (the vault cannot just take tokens)", async function () {
      await expect(vault.connect(alice).deposit(await addr(token), 100n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(await addr(vault), 0n, 100n);
    });

    it("approve then deposit: the vault pulls the tokens and credits Alice", async function () {
      await token.connect(alice).approve(await addr(vault), 100n);
      await expect(vault.connect(alice).deposit(await addr(token), 100n))
        .to.emit(vault, "Deposited")
        .withArgs(await addr(token), alice.address, 100n, 100n);
      expect(await vault.balances(await addr(token), alice.address)).to.equal(100n);
      expect(await vault.totalDeposits(await addr(token))).to.equal(100n);
      expect(await token.balanceOf(await addr(vault))).to.equal(100n);
      expect(await token.balanceOf(alice.address)).to.equal(9_900n);
      expect(await token.allowance(alice.address, await addr(vault))).to.equal(0n); // spent
    });

    it("can only take what was approved, not one unit more", async function () {
      await token.connect(alice).approve(await addr(vault), 100n);
      await expect(vault.connect(alice).deposit(await addr(token), 101n)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance",
      );
    });

    it("rejects a zero deposit and a zero withdrawal", async function () {
      await expect(vault.connect(alice).deposit(await addr(token), 0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.connect(alice).withdraw(await addr(token), 0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("withdraw returns the user's own tokens, and nobody else's", async function () {
      await token.connect(alice).approve(await addr(vault), 100n);
      await vault.connect(alice).deposit(await addr(token), 100n);
      await token.connect(bob).approve(await addr(vault), 50n);
      await vault.connect(bob).deposit(await addr(token), 50n);

      await expect(vault.connect(alice).withdraw(await addr(token), 60n)).to.changeTokenBalances(
        token,
        [alice, vault],
        [60n, -60n],
      );
      await expect(vault.connect(bob).withdraw(await addr(token), 51n))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(50n, 51n);
      await expect(vault.connect(mallory).withdraw(await addr(token), 1n))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(0n, 1n);
    });

    it("can withdraw the full balance (boundary) and stays solvent", async function () {
      await token.connect(alice).approve(await addr(vault), 100n);
      await vault.connect(alice).deposit(await addr(token), 100n);
      await vault.connect(alice).withdraw(await addr(token), 100n);
      expect(await vault.balances(await addr(token), alice.address)).to.equal(0n);
      expect(await vault.totalDeposits(await addr(token))).to.equal(0n);
      expect(await vault.solvencyCheck(await addr(token))).to.equal(true);
    });

    it("keeps different tokens in separate books", async function () {
      const other = await deploy("LearningToken", owner.address, SUPPLY, SUPPLY * 2n);
      await other.transfer(alice.address, 500n);
      await token.connect(alice).approve(await addr(vault), 100n);
      await other.connect(alice).approve(await addr(vault), 200n);
      await vault.connect(alice).deposit(await addr(token), 100n);
      await vault.connect(alice).deposit(await addr(other), 200n);
      expect(await vault.balances(await addr(token), alice.address)).to.equal(100n);
      expect(await vault.balances(await addr(other), alice.address)).to.equal(200n);
      await expect(vault.connect(alice).withdraw(await addr(token), 101n)).to.be.revertedWithCustomError(
        vault,
        "InsufficientBalance",
      );
    });
  });

  describe("depositWithPermit: approve + deposit in ONE transaction", function () {
    let deadline;
    beforeEach(async function () {
      deadline = (await latestTimestamp()) + 3600;
    });

    it("works with a signature and no earlier approve transaction", async function () {
      const { v, r, s } = await signPermit(token, alice, await addr(vault), 100n, deadline);
      await vault.connect(alice).depositWithPermit(await addr(token), 100n, deadline, v, r, s);
      expect(await vault.balances(await addr(token), alice.address)).to.equal(100n);
    });

    it("FRONT-RUNNING: if someone submits Alice's permit first, her deposit still goes through", async function () {
      const { v, r, s } = await signPermit(token, alice, await addr(vault), 100n, deadline);

      // Mallory sees the signature in the mempool and submits the permit herself.
      await token.connect(mallory).permit(alice.address, await addr(vault), 100n, deadline, v, r, s);

      // Control: a vault that called token.permit() unguarded would now revert, because the
      // nonce is used up. Doing exactly that shows what Alice would have suffered:
      await expect(token.permit(alice.address, await addr(vault), 100n, deadline, v, r, s)).to.be.reverted;

      // TokenVault ignores the failed permit; the allowance Mallory 'helpfully' created is enough.
      await vault.connect(alice).depositWithPermit(await addr(token), 100n, deadline, v, r, s);
      expect(await vault.balances(await addr(token), alice.address)).to.equal(100n);
    });

    it("a garbage signature gives no allowance: the deposit fails with the normal allowance error", async function () {
      const { v, r, s } = await signPermit(token, mallory, await addr(vault), 100n, deadline); // wrong signer
      await expect(
        vault.connect(alice).depositWithPermit(await addr(token), 100n, deadline, v, r, s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("a garbage signature is harmless when Alice already approved normally", async function () {
      await token.connect(alice).approve(await addr(vault), 100n);
      const { v, r, s } = await signPermit(token, mallory, await addr(vault), 100n, deadline);
      await vault.connect(alice).depositWithPermit(await addr(token), 100n, deadline, v, r, s);
      expect(await vault.balances(await addr(token), alice.address)).to.equal(100n);
    });

    it("an expired signature gives no allowance", async function () {
      const past = (await latestTimestamp()) - 10;
      const { v, r, s } = await signPermit(token, alice, await addr(vault), 100n, past);
      await expect(
        vault.connect(alice).depositWithPermit(await addr(token), 100n, past, v, r, s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("fee-on-transfer tokens: credit what ARRIVED", function () {
    let fee, naive;
    beforeEach(async function () {
      fee = await deploy("FeeToken", SUPPLY);
      naive = await deploy("NaiveTokenVault");
      for (const user of [alice, bob]) await fee.transfer(user.address, 2000n); // they receive 1980 after the 1% fee
    });

    it("sanity: every transfer of the fee token loses 1%", async function () {
      await fee.connect(alice).transfer(mallory.address, 1000n);
      expect(await fee.balanceOf(mallory.address)).to.equal(990n);
    });

    it("control: the NAIVE vault credits 1000, receives 990, and ends up owing more than it holds", async function () {
      for (const user of [alice, bob]) {
        await fee.connect(user).approve(await addr(naive), 1000n);
        await naive.connect(user).deposit(await addr(fee), 1000n);
      }
      expect(await fee.balanceOf(await addr(naive))).to.equal(1980n); // really holds
      expect(
        (await naive.balances(await addr(fee), alice.address)) + (await naive.balances(await addr(fee), bob.address)),
      ).to.equal(2000n); // thinks it owes

      await naive.connect(alice).withdraw(await addr(fee), 1000n); // first one out is fine...
      await expect(naive.connect(bob).withdraw(await addr(fee), 1000n)).to.be.reverted; // ...the last one is robbed
    });

    it("TokenVault credits 990, reports both numbers in the event, and stays solvent", async function () {
      await fee.connect(alice).approve(await addr(vault), 1000n);
      await expect(vault.connect(alice).deposit(await addr(fee), 1000n))
        .to.emit(vault, "Deposited")
        .withArgs(await addr(fee), alice.address, 1000n, 990n);
      expect(await vault.balances(await addr(fee), alice.address)).to.equal(990n);
      expect(await vault.solvencyCheck(await addr(fee))).to.equal(true);
    });

    it("TokenVault: everybody can withdraw what they were credited, including the last user", async function () {
      for (const user of [alice, bob]) {
        await fee.connect(user).approve(await addr(vault), 1000n);
        await vault.connect(user).deposit(await addr(fee), 1000n);
      }
      await vault.connect(alice).withdraw(await addr(fee), 990n);
      await vault.connect(bob).withdraw(await addr(fee), 990n);
      expect(await vault.totalDeposits(await addr(fee))).to.equal(0n);
    });
  });

  describe("tokens that do not follow the standard to the letter", function () {
    it("USDT-style token that returns NOTHING: TokenVault copes (SafeERC20)", async function () {
      const usdt = await deploy("NoReturnToken", 1_000_000n);
      await usdt.transfer(alice.address, 1000n);
      await usdt.connect(alice).approve(await addr(vault), 500n);
      await vault.connect(alice).deposit(await addr(usdt), 500n);
      expect(await vault.balances(await addr(usdt), alice.address)).to.equal(500n);
      await vault.connect(alice).withdraw(await addr(usdt), 500n);
      expect(await usdt.balanceOf(alice.address)).to.equal(1000n);
    });

    it("control: the naive vault (plain IERC20 calls) cannot even deposit it", async function () {
      const usdt = await deploy("NoReturnToken", 1_000_000n);
      const naive = await deploy("NaiveTokenVault");
      await usdt.transfer(alice.address, 1000n);
      await usdt.connect(alice).approve(await addr(naive), 500n);
      await expect(naive.connect(alice).deposit(await addr(usdt), 500n)).to.be.reverted; // empty return data cannot be decoded as bool
    });

    it("token that returns FALSE instead of reverting: TokenVault refuses to credit anything", async function () {
      const liar = await deploy("FalseReturnToken", 1_000_000n);
      await expect(vault.connect(alice).deposit(await addr(liar), 500n))
        .to.be.revertedWithCustomError(vault, "SafeERC20FailedOperation")
        .withArgs(await addr(liar));
      expect(await vault.balances(await addr(liar), alice.address)).to.equal(0n);
    });

    it("control: the naive vault credits Alice 500 for tokens that never moved (free money)", async function () {
      const liar = await deploy("FalseReturnToken", 1_000_000n);
      const naive = await deploy("NaiveTokenVault");
      await naive.connect(alice).deposit(await addr(liar), 500n);
      expect(await naive.balances(await addr(liar), alice.address)).to.equal(500n);
      expect(await liar.balanceOf(await addr(naive))).to.equal(0n);
    });
  });

  describe("tokens that lie about success, and addresses that are not tokens", function () {
    it("a token that returns true but moves NOTHING is refused (NothingReceived), nothing is credited", async function () {
      const ghost = await deploy("GhostToken");
      await expect(vault.connect(alice).deposit(await addr(ghost), 500n)).to.be.revertedWithCustomError(vault, "NothingReceived");
      expect(await vault.balances(await addr(ghost), alice.address)).to.equal(0n);
    });

    it("control: the naive vault credits Alice 500 for a ghost token that moved nothing", async function () {
      const ghost = await deploy("GhostToken");
      const naive = await deploy("NaiveTokenVault");
      await naive.connect(alice).deposit(await addr(ghost), 500n);
      expect(await naive.balances(await addr(ghost), alice.address)).to.equal(500n);
    });

    it("depositing 'a token' that is just a normal account (no code) reverts", async function () {
      await expect(vault.connect(alice).deposit(bob.address, 1n)).to.be.reverted;
      expect(await vault.balances(bob.address, alice.address)).to.equal(0n);
    });
  });

  describe("a token that calls you back (ERC-777 style hook)", function () {
    let hook, attacker;
    beforeEach(async function () {
      hook = await deploy("HookToken", SUPPLY);
      attacker = await deploy("HookAttacker", await addr(vault), await addr(hook));
      await hook.transfer(await addr(attacker), 1000n);
    });

    it("the hook really fires during withdraw, and the re-entry is refused by the guard", async function () {
      await attacker.attack(400n);
      expect(await attacker.reentered()).to.equal(true);
      expect(await attacker.lastReentryFailed()).to.equal(true);
      expect(await attacker.lastRevertSelector()).to.equal(
        vault.interface.getError("ReentrancyGuardReentrantCall")?.selector ??
          ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10),
      );
      expect(await hook.balanceOf(await addr(attacker))).to.equal(1000n); // got exactly its own tokens back
    });

    const guardSelector = () => ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

    it("CROSS-FUNCTION reentrancy: the hook cannot call deposit() while withdraw() is running", async function () {
      await attacker.attackVia(1, 400n);
      expect(await attacker.reentered()).to.equal(true);
      expect(await attacker.lastRevertSelector()).to.equal(guardSelector());
    });

    it("CROSS-FUNCTION reentrancy: nor depositWithPermit()", async function () {
      await attacker.attackVia(2, 400n);
      expect(await attacker.reentered()).to.equal(true);
      expect(await attacker.lastRevertSelector()).to.equal(guardSelector());
    });

    it("READ-ONLY reentrancy: during the callback the vault's numbers are already final (effects came first)", async function () {
      await attacker.attack(400n);
      expect(await attacker.seenBalance()).to.equal(0n); // not the stale 400
      expect(await attacker.seenTotal()).to.equal(0n);
    });
  });
});
