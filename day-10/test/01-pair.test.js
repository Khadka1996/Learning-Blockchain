"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const amm = require("../src/amm");
const { E, DEADLINE, deployPool, addLiquidityEthUsd, reservesEthUsd } = require("./helpers");

async function seededPool() {
  const ctx = await deployPool();
  await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000)); // 1 mETH = 2,000 mUSD
  return ctx;
}

describe("SimplePair — x · y = k", function () {
  describe("deployment", function () {
    it("sorts the tokens and rejects bad pairs", async function () {
      const { pair, mETH, mUSD } = await loadFixture(deployPool);
      const [lo, hi] = [await mETH.getAddress(), await mUSD.getAddress()].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      expect(await pair.token0()).to.equal(lo);
      expect(await pair.token1()).to.equal(hi);
      const F = await ethers.getContractFactory("SimplePair");
      await expect(F.deploy(mETH, mETH)).to.be.revertedWithCustomError(F, "IdenticalTokens");
      await expect(F.deploy(mETH, ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
    });
  });

  describe("liquidity", function () {
    it("first deposit mints sqrt(x·y) shares and locks 1,000 forever", async function () {
      const ctx = await loadFixture(deployPool);
      await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000));
      const root = amm.sqrt(E(100) * E(200_000));
      expect(await ctx.pair.balanceOf(ctx.alice.address)).to.equal(root - 1000n);
      expect(await ctx.pair.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(1000n);
      expect(await ctx.pair.totalSupply()).to.equal(root);
    });

    it("rejects a first deposit too small to cover the locked shares", async function () {
      const ctx = await loadFixture(deployPool);
      await expect(addLiquidityEthUsd(ctx, ctx.alice, 1000n, 1000n)).to.be.revertedWithCustomError(ctx.pair, "InsufficientLiquidityMinted");
    });

    it("later deposits take only the matching ratio and mint proportional shares", async function () {
      const ctx = await loadFixture(seededPool);
      const supply = await ctx.pair.totalSupply();
      const usdBefore = await ctx.mUSD.balanceOf(ctx.bob.address);
      await addLiquidityEthUsd(ctx, ctx.bob, E(10), E(50_000)); // offers too much mUSD
      expect(usdBefore - (await ctx.mUSD.balanceOf(ctx.bob.address))).to.equal(E(20_000)); // only 20,000 taken
      expect(await ctx.pair.balanceOf(ctx.bob.address)).to.equal((E(10) * supply) / E(100));
    });

    it("minShares protects the depositor", async function () {
      const ctx = await loadFixture(seededPool);
      await expect(addLiquidityEthUsd(ctx, ctx.bob, E(1), E(2_000), E(1_000_000))).to.be.revertedWithCustomError(ctx.pair, "InsufficientLiquidityMinted");
    });

    it("remove returns your share of both reserves, fees included", async function () {
      const ctx = await loadFixture(seededPool);
      for (let i = 0; i < 5; i++) {
        // Bob trades back and forth; each trip leaves 0.30% fees in the pool.
        const got = await ctx.pair.quote(ctx.mETH, E(5));
        await ctx.pair.connect(ctx.bob).swap(ctx.mETH, E(5), 0n, ctx.bob.address, DEADLINE);
        await ctx.pair.connect(ctx.bob).swap(ctx.mUSD, got, 0n, ctx.bob.address, DEADLINE);
      }
      const shares = await ctx.pair.balanceOf(ctx.alice.address);
      const { eth, usd } = await reservesEthUsd(ctx);
      const supply = await ctx.pair.totalSupply();
      const before = await ctx.mETH.balanceOf(ctx.alice.address);
      const ethIs0 = ctx.t0 === ctx.mETH;
      await ctx.pair.connect(ctx.alice).removeLiquidity(shares, 0n, 0n, ctx.alice.address, DEADLINE);
      expect((await ctx.mETH.balanceOf(ctx.alice.address)) - before).to.equal((shares * eth) / supply);
      expect(await ctx.pair.balanceOf(ctx.alice.address)).to.equal(0n);
      const r = await reservesEthUsd(ctx);
      expect(r.eth).to.equal(eth - (shares * eth) / supply);
      expect(r.usd).to.equal(usd - (shares * usd) / supply);
      expect(ethIs0 ? await ctx.pair.reserve0() : await ctx.pair.reserve1()).to.equal(r.eth);
    });

    it("remove enforces minimums, zero shares and recipient checks", async function () {
      const ctx = await loadFixture(seededPool);
      const shares = await ctx.pair.balanceOf(ctx.alice.address);
      await expect(ctx.pair.connect(ctx.alice).removeLiquidity(shares, E(101), 0n, ctx.alice.address, DEADLINE)).to.be.revertedWithCustomError(ctx.pair, "InsufficientAmounts");
      await expect(ctx.pair.connect(ctx.alice).removeLiquidity(0n, 0n, 0n, ctx.alice.address, DEADLINE)).to.be.revertedWithCustomError(ctx.pair, "ZeroAmount");
      await expect(ctx.pair.connect(ctx.alice).removeLiquidity(shares, 0n, 0n, await ctx.pair.getAddress(), DEADLINE)).to.be.revertedWithCustomError(ctx.pair, "InvalidRecipient");
      await expect(ctx.pair.connect(ctx.bob).removeLiquidity(1n, 0n, 0n, ctx.bob.address, DEADLINE)).to.be.revertedWithCustomError(ctx.pair, "InsufficientAmounts");
    });
  });

  describe("swap", function () {
    it("pays exactly what the formula says (matches the JS model to the wei)", async function () {
      const ctx = await loadFixture(seededPool);
      const expected = amm.getAmountOut(E(1), E(100), E(200_000));
      expect(await ctx.pair.quote(ctx.mETH, E(1))).to.equal(expected);
      await expect(ctx.pair.connect(ctx.bob).swap(ctx.mETH, E(1), expected, ctx.bob.address, DEADLINE))
        .to.changeTokenBalances(ctx.mUSD, [ctx.bob, ctx.pair], [expected, -expected]);
    });

    it("the 0.30% fee makes k grow after every swap", async function () {
      const ctx = await loadFixture(seededPool);
      let { eth, usd } = await reservesEthUsd(ctx);
      for (const [tok, amt] of [[ctx.mETH, E(3)], [ctx.mUSD, E(9_000)], [ctx.mETH, 1n], [ctx.mUSD, E(1)], [ctx.mETH, E(40)]]) {
        await ctx.pair.connect(ctx.bob).swap(tok, amt, 0n, ctx.bob.address, DEADLINE);
        const r = await reservesEthUsd(ctx);
        expect(r.eth * r.usd).to.be.gte(eth * usd);
        ({ eth, usd } = r);
      }
    });

    it("bigger trades get worse prices (price impact)", async function () {
      const ctx = await loadFixture(seededPool);
      const perEth = [];
      for (const n of [1, 10, 50]) perEth.push((await ctx.pair.quote(ctx.mETH, E(n))) / BigInt(n));
      expect(perEth[0]).to.be.gt(perEth[1]);
      expect(perEth[1]).to.be.gt(perEth[2]);
    });

    it("can never empty a side of the pool", async function () {
      const ctx = await loadFixture(seededPool);
      await ctx.pair.connect(ctx.bob).swap(ctx.mETH, E(900_000_000), 0n, ctx.bob.address, DEADLINE);
      const { usd } = await reservesEthUsd(ctx);
      expect(usd).to.be.gt(0n);
    });

    it("rejects zero amounts, unknown tokens, bad recipients and expired deadlines", async function () {
      const ctx = await loadFixture(seededPool);
      const { pair, bob, mETH } = ctx;
      await expect(pair.connect(bob).swap(mETH, 0n, 0n, bob.address, DEADLINE)).to.be.revertedWithCustomError(pair, "ZeroAmount");
      await expect(pair.connect(bob).swap(bob.address, 1n, 0n, bob.address, DEADLINE)).to.be.revertedWithCustomError(pair, "InvalidToken");
      for (const to of [ethers.ZeroAddress, await pair.getAddress(), await mETH.getAddress()]) {
        await expect(pair.connect(bob).swap(mETH, E(1), 0n, to, DEADLINE)).to.be.revertedWithCustomError(pair, "InvalidRecipient");
      }
      const past = (await time.latest()) - 1;
      await expect(pair.connect(bob).swap(mETH, E(1), 0n, bob.address, past)).to.be.revertedWithCustomError(pair, "Expired");
      await expect(pair.connect(bob).swap(ctx.mUSD, 1n, 0n, bob.address, DEADLINE)).to.be.revertedWithCustomError(pair, "InsufficientOutput"); // 1 wei of mUSD buys 0 mETH
      await expect(pair.quote(bob.address, 1n)).to.be.revertedWithCustomError(pair, "InvalidToken");
    });

    it("refuses to swap in an empty pool", async function () {
      const ctx = await loadFixture(deployPool);
      await expect(ctx.pair.connect(ctx.bob).swap(ctx.mETH, E(1), 0n, ctx.bob.address, DEADLINE)).to.be.revertedWithCustomError(ctx.pair, "InsufficientLiquidity");
    });
  });
});
