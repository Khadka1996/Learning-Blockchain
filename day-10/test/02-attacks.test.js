"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const amm = require("../src/amm");
const { runSandwich, bestFrontRun } = require("../src/sandwich");
const { E, DEADLINE, deployPool, addLiquidityEthUsd, reservesEthUsd } = require("./helpers");

async function seededPool() {
  const ctx = await deployPool();
  await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000));
  return ctx;
}

describe("Attacks on the pool", function () {
  describe("sandwich (front-run + back-run) — why minAmountOut exists", function () {
    it("no slippage limit: the bot takes a big bite of the victim's trade", async function () {
      const ctx = await loadFixture(seededPool);
      const r = await runSandwich(ctx, { victim: ctx.carol, bot: ctx.bot, victimIn: E(5), victimMinOut: 0n, botBudget: E(20) });
      expect(r.botProfitEth).to.be.gt(0n);
      expect(r.victimLoss * 100n).to.be.gt(r.fairOut * 25n); // victim lost more than 25%
    });

    it("0.5% slippage limit: the most the bot can take is 0.5%", async function () {
      const ctx = await loadFixture(seededPool);
      const fair = amm.getAmountOut(E(5), E(100), E(200_000));
      const min = (fair * 9_950n) / 10_000n;
      const r = await runSandwich(ctx, { victim: ctx.carol, bot: ctx.bot, victimIn: E(5), victimMinOut: min, botBudget: E(20) });
      expect(r.victimGot).to.be.gte(min);
      expect(r.victimLoss * 10_000n).to.be.lte(r.fairOut * 50n);
    });

    it("a greedy front-run bigger than the limit allows makes the victim's swap revert (no trade, no loss)", async function () {
      const ctx = await loadFixture(seededPool);
      const fair = amm.getAmountOut(E(5), E(100), E(200_000));
      const min = (fair * 9_950n) / 10_000n;
      // Greedy: front-run with 20 mETH anyway.
      await ctx.pair.connect(ctx.bot).swap(ctx.mETH, E(20), 0n, ctx.bot.address, DEADLINE);
      await expect(ctx.pair.connect(ctx.carol).swap(ctx.mETH, E(5), min, ctx.carol.address, DEADLINE))
        .to.be.revertedWithCustomError(ctx.pair, "InsufficientOutput");
    });

    it("bestFrontRun returns 0 when even 1 wei would break the victim's limit", function () {
      const fair = amm.getAmountOut(E(5), E(100), E(200_000));
      expect(bestFrontRun(E(5), fair, E(100), E(200_000), E(20))).to.equal(0n);
    });
  });

  describe("donation / first-depositor inflation attack", function () {
    it("tokens sent straight to the pool do not change price or share value", async function () {
      const ctx = await loadFixture(deployPool);
      const { pair, mETH, mUSD, bot, carol } = ctx;
      // Attacker creates the pool with the smallest possible deposit…
      await addLiquidityEthUsd(ctx, bot, 1001n, 1001n);
      expect(await pair.balanceOf(bot.address)).to.equal(1n);
      // …then "donates" 1,000 of each token, hoping the next depositor's shares round to 0.
      await mETH.connect(bot).transfer(pair, E(1_000));
      await mUSD.connect(bot).transfer(pair, E(1_000));
      const before = await reservesEthUsd(ctx);
      expect(before.eth).to.equal(1001n); // the pool ignored the donation

      await addLiquidityEthUsd(ctx, carol, E(10), E(10));
      const shares = await pair.balanceOf(carol.address);
      expect(shares).to.be.gt(E(1)); // not 0
      const ethBefore = await mETH.balanceOf(carol.address);
      await pair.connect(carol).removeLiquidity(shares, 0n, 0n, carol.address, DEADLINE);
      // Carol gets back her 10 mETH (minus at most 1 wei of rounding).
      expect((await mETH.balanceOf(carol.address)) - ethBefore).to.be.gte(E(10) - 1n);
    });
  });

  describe("weird tokens", function () {
    it("fee-on-transfer token: the pool counts what arrived, not what was asked", async function () {
      const [, alice, bob] = await ethers.getSigners();
      const fee = await (await ethers.getContractFactory("FeeOnTransferToken")).deploy();
      const usd = await (await ethers.getContractFactory("MockToken")).deploy("Mock Dollar", "mUSD");
      const pair = await (await ethers.getContractFactory("SimplePair")).deploy(fee, usd);
      for (const u of [alice, bob]) {
        await fee.mint(u.address, E(1_000)); await usd.mint(u.address, E(1_000_000));
        await fee.connect(u).approve(pair, ethers.MaxUint256); await usd.connect(u).approve(pair, ethers.MaxUint256);
      }
      const feeIs0 = (await pair.token0()) === (await fee.getAddress());
      const [a0, a1] = feeIs0 ? [E(100), E(100_000)] : [E(100_000), E(100)];
      await pair.connect(alice).addLiquidity(a0, a1, 0n, alice.address, DEADLINE);
      const feeReserve = async () => (feeIs0 ? pair.reserve0() : pair.reserve1());
      expect(await feeReserve()).to.equal(E(99)); // 1% burned on the way in

      // Swap 10 FEE in: only 9.9 arrive, and the price is computed on 9.9.
      const usdReserve = feeIs0 ? await pair.reserve1() : await pair.reserve0();
      const expected = amm.getAmountOut(E(9.9), E(99), usdReserve);
      await expect(pair.connect(bob).swap(fee, E(10), 0n, bob.address, DEADLINE)).to.changeTokenBalance(usd, bob, expected);
      expect(await fee.balanceOf(pair)).to.equal(await feeReserve()); // books still match reality
    });

    it("hostile token that re-enters swap() is stopped by the lock", async function () {
      const [, alice, bob] = await ethers.getSigners();
      const hook = await (await ethers.getContractFactory("ReentrantToken")).deploy();
      const usd = await (await ethers.getContractFactory("MockToken")).deploy("Mock Dollar", "mUSD");
      const pair = await (await ethers.getContractFactory("SimplePair")).deploy(hook, usd);
      for (const u of [alice, bob]) {
        await hook.mint(u.address, E(1_000)); await usd.mint(u.address, E(1_000));
        await hook.connect(u).approve(pair, ethers.MaxUint256); await usd.connect(u).approve(pair, ethers.MaxUint256);
      }
      await pair.connect(alice).addLiquidity(E(100), E(100), 0n, alice.address, DEADLINE);
      await hook.arm(pair);
      await expect(pair.connect(bob).swap(hook, E(1), 0n, bob.address, DEADLINE))
        .to.be.revertedWithCustomError(pair, "ReentrancyGuardReentrantCall");
    });
  });
});
