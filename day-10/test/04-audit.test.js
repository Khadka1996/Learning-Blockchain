"use strict";
// Regression tests for the QA / pentest findings in QA.md.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { E, DEADLINE, deployPool, addLiquidityEthUsd } = require("./helpers");

async function seededPool() {
  const ctx = await deployPool();
  await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000));
  return ctx;
}

describe("QA findings (regression)", function () {
  it("L1: LP shares cannot be minted to the pool itself or to a token contract (they would be lost)", async function () {
    const ctx = await loadFixture(seededPool);
    const { pair, bob, mETH, mUSD } = ctx;
    for (const to of [await pair.getAddress(), await mETH.getAddress(), await mUSD.getAddress()]) {
      await expect(pair.connect(bob).addLiquidity(E(1), E(2_000), 0n, to, DEADLINE)).to.be.revertedWithCustomError(pair, "InvalidRecipient");
    }
  });

  it("P1: an attacker who moves the price before Bob's deposit is caught by minShares", async function () {
    const ctx = await loadFixture(seededPool);
    const { pair, bob, bot, mETH } = ctx;
    const supply = await pair.totalSupply();
    const fairShares = (E(10) * supply) / E(100); // what Bob expects at today's price
    const minShares = (fairShares * 9_950n) / 10_000n; // 0.5% tolerance
    await pair.connect(bot).swap(mETH, E(20), 0n, bot.address, DEADLINE); // front-run: push the price
    await expect(addLiquidityEthUsd(ctx, bob, E(10), E(20_000), minShares)).to.be.revertedWithCustomError(pair, "InsufficientLiquidityMinted");
  });

  it("I1: a contract reading the pool in the middle of a swap sees the old, consistent state (no read-only re-entrancy window)", async function () {
    const [, alice, bob] = await ethers.getSigners();
    const hook = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    const usd = await (await ethers.getContractFactory("MockToken")).deploy("Mock Dollar", "mUSD");
    const pair = await (await ethers.getContractFactory("SimplePair")).deploy(hook, usd);
    for (const u of [alice, bob]) {
      await hook.mint(u.address, E(1_000)); await usd.mint(u.address, E(1_000));
      await hook.connect(u).approve(pair, ethers.MaxUint256); await usd.connect(u).approve(pair, ethers.MaxUint256);
    }
    await pair.connect(alice).addLiquidity(E(100), E(100), 0n, alice.address, DEADLINE);
    const before = [await pair.reserve0(), await pair.reserve1(), await pair.totalSupply()];
    await hook.spy(pair);
    await pair.connect(bob).swap(hook, E(10), 0n, bob.address, DEADLINE);
    // Mid-swap the pool's balance of HOOK was already 110, but its books still said 100/100: a complete, consistent state.
    expect([await hook.seenReserve0(), await hook.seenReserve1(), await hook.seenSupply()]).to.deep.equal(before);
  });
});
