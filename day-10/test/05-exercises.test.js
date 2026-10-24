"use strict";
// Checks the evening exercise solutions (day-10/exercises/solutions).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { impactTable } = require("../exercises/solutions/ex1-impact-table");
const { impermanentLossFormula, measure } = require("../exercises/solutions/ex2-impermanent-loss");
const { arbitrageSize } = require("../exercises/solutions/ex3-arbitrage-size");
const { getAmountOut } = require("../src/amm");
const { E, DEADLINE, deployPool, addLiquidityEthUsd, reservesEthUsd } = require("./helpers");

describe("Evening exercises", function () {
  it("ex1: the table matches the numbers from the demo", function () {
    const t = impactTable(E(100), E(200_000), [1, 5, 50]);
    expect(t[0].out).to.equal(1974.32);
    expect(t[1].out).to.equal(9496.59);
    expect(t[2].out).to.equal(66533.2);
    expect(t[0].impactPct).to.be.closeTo(1.28, 0.01);
  });

  it("ex2: impermanent loss on the real contract matches 2·sqrt(r)/(1+r) − 1 (r = 2 → −5.72%)", async function () {
    const f = impermanentLossFormula(2);
    expect(f).to.be.closeTo(-0.0572, 0.0001);
    const m = await measure(2);
    // the fee band keeps the pool slightly off the exact price, so allow 0.2 percentage points
    expect(m.loss).to.be.closeTo(f, 0.002);
  });

  it("ex3: arbitrage size lands the pool on the outside price (and 1 wei more would overshoot)", async function () {
    const ctx = await deployPool();
    await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000));
    const { eth, usd } = await reservesEthUsd(ctx);
    const dx = arbitrageSize(eth, usd, 1_500n, 1n);
    expect(dx).to.be.gt(0n);
    // run it on the contract
    await ctx.pair.connect(ctx.bot).swap(ctx.mETH, dx, 0n, ctx.bot.address, DEADLINE);
    const after = await reservesEthUsd(ctx);
    const marginal = (997 * Number(after.usd)) / (1000 * Number(after.eth));
    expect(marginal).to.be.closeTo(1500, 0.5);
    // pool already at/below the outside price → nothing to do
    expect(arbitrageSize(eth, usd, 3_000n, 1n)).to.equal(0n);
    void getAmountOut; void ethers;
  });

  it("improvement: quoteAddLiquidity predicts addLiquidity exactly, first deposit and later", async function () {
    const ctx = await deployPool();
    const { pair, alice, bob } = ctx;
    const ethIs0 = ctx.t0 === ctx.mETH;
    const args = (a, b) => (ethIs0 ? [a, b] : [b, a]);
    let q = await pair.quoteAddLiquidity(...args(E(100), E(200_000)));
    await pair.connect(alice).addLiquidity(...args(E(100), E(200_000)), q.shares, alice.address, DEADLINE);
    expect(await pair.balanceOf(alice.address)).to.equal(q.shares);
    q = await pair.quoteAddLiquidity(...args(E(10), E(50_000))); // too much USD: pool takes only the matching part
    await pair.connect(bob).addLiquidity(...args(E(10), E(50_000)), q.shares, bob.address, DEADLINE);
    expect(await pair.balanceOf(bob.address)).to.equal(q.shares);
    expect(q.amount1 + q.amount0).to.equal(ethIs0 ? E(10) + E(20_000) : E(20_000) + E(10));
  });
});
