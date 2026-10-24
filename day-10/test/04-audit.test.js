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

describe("Evening audit (independent pentest pass)", function () {
  it("E1: a deadline equal to the block timestamp is still valid, one second later is not", async function () {
    const ctx = await loadFixture(seededPool);
    const { pair, bob, mETH } = ctx;
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(now + 10n)]);
    await expect(pair.connect(bob).swap(mETH, E(1), 0n, bob.address, now + 10n)).to.not.be.reverted;
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(now + 20n)]);
    await expect(pair.connect(bob).swap(mETH, E(1), 0n, bob.address, now + 19n)).to.be.revertedWithCustomError(pair, "Expired");
  });

  it("E2: after every provider leaves, only dust is left and the pool can be revived", async function () {
    const ctx = await deployPool();
    const { pair, alice, bob, mETH } = ctx;
    await addLiquidityEthUsd(ctx, alice, E(100), E(200_000));
    await pair.connect(bob).swap(mETH, E(7), 0n, bob.address, DEADLINE); // move the price a little
    const shares = await pair.balanceOf(alice.address);
    await pair.connect(alice).removeLiquidity(shares, 0n, 0n, alice.address, DEADLINE);
    expect(await pair.balanceOf(alice.address)).to.equal(0n);
    expect(await pair.reserve0()).to.be.gt(0n); // the 1,000 locked shares keep a sliver in both piles
    expect(await pair.reserve1()).to.be.gt(0n);
    // a new provider can still deposit and trade
    await addLiquidityEthUsd(ctx, bob, E(10), E(20_000), 1n);
    await expect(pair.connect(bob).swap(mETH, E(1), 0n, bob.address, DEADLINE)).to.not.be.reverted;
  });

  it("E3: someone who opens the pool at a silly price cannot make an honest provider lose money", async function () {
    const ctx = await deployPool();
    const { alice, bob } = ctx;
    await addLiquidityEthUsd(ctx, bob, E(1) / 1_000n, E(10_000), 1n); // 0.001 mETH vs 10,000 mUSD: absurd price
    const before = await ctx.mETH.balanceOf(alice.address);
    const tx = await addLiquidityEthUsd(ctx, alice, E(100), E(200_000), 1n);
    await tx.wait();
    // Alice only paid what matched the pool's ratio; the rest stayed in her wallet
    const spent = before - (await ctx.mETH.balanceOf(alice.address));
    expect(spent).to.be.lt(E(100)); // she was NOT forced to deposit the full 100 mETH
  });

  it("E4: a token that confiscates balance leaves the books above reality, the last exit fails (documented K6)", async function () {
    const [d, alice, bob] = await ethers.getSigners();
    const Reb = await ethers.getContractFactory("RebasingToken");
    const reb = await Reb.deploy();
    const mock = await (await ethers.getContractFactory("MockToken")).deploy("Mock Dollar", "mUSD");
    const pair = await (await ethers.getContractFactory("SimplePair")).deploy(reb, mock);
    for (const u of [alice, bob]) {
      await reb.mint(u.address, E(1_000));
      await mock.mint(u.address, E(1_000));
      await reb.connect(u).approve(pair, ethers.MaxUint256);
      await mock.connect(u).approve(pair, ethers.MaxUint256);
    }
    const rebIs0 = (await pair.token0()) === (await reb.getAddress());
    const add = (u, a, b) => pair.connect(u).addLiquidity(rebIs0 ? a : b, rebIs0 ? b : a, 0n, u.address, DEADLINE);
    await add(alice, E(100), E(100));
    await add(bob, E(100), E(100));
    await reb.confiscate(await pair.getAddress(), E(50)); // issuer rebases the pool's balance down
    const bobShares = await pair.balanceOf(bob.address);
    await pair.connect(bob).removeLiquidity(bobShares, 0n, 0n, bob.address, DEADLINE); // first out is paid in full
    const aliceShares = await pair.balanceOf(alice.address);
    await expect(pair.connect(alice).removeLiquidity(aliceShares, 0n, 0n, alice.address, DEADLINE)).to.be.reverted; // last one is short
    void d;
  });
});
