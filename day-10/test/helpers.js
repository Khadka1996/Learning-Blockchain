"use strict";
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DEADLINE = 2n ** 255n; // "no deadline" for tests that are not about deadlines
const GWEI = 10n ** 9n;

/** Two mock tokens + a pool. Returns tokens sorted the same way as the pool (t0 = token0). */
async function deployPool() {
  const [deployer, alice, bob, carol, bot] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockToken");
  const a = await Token.deploy("Mock Ether", "mETH");
  const b = await Token.deploy("Mock Dollar", "mUSD");
  const pair = await (await ethers.getContractFactory("SimplePair")).deploy(a, b);
  const t0 = (await pair.token0()) === (await a.getAddress()) ? a : b;
  const t1 = t0 === a ? b : a;
  for (const user of [deployer, alice, bob, carol, bot]) {
    for (const t of [a, b]) {
      await t.mint(user.address, E(1_000_000_000));
      await t.connect(user).approve(pair, ethers.MaxUint256);
    }
  }
  return { pair, mETH: a, mUSD: b, t0, t1, deployer, alice, bob, carol, bot };
}

/** Add liquidity in "mETH / mUSD" order regardless of how the pool sorted them. */
async function addLiquidityEthUsd(ctx, signer, ethAmt, usdAmt, minShares = 0n) {
  const ethIs0 = ctx.t0 === ctx.mETH;
  const [a0, a1] = ethIs0 ? [ethAmt, usdAmt] : [usdAmt, ethAmt];
  return ctx.pair.connect(signer).addLiquidity(a0, a1, minShares, signer.address, DEADLINE);
}

async function reservesEthUsd(ctx) {
  const [r0, r1] = [await ctx.pair.reserve0(), await ctx.pair.reserve1()];
  return ctx.t0 === ctx.mETH ? { eth: r0, usd: r1 } : { eth: r1, usd: r0 };
}

// ── tiny "mempool" toolkit (same idea as Day 09) ──
async function pauseMining() { await network.provider.send("evm_setAutomine", [false]); }
async function resumeMining() { await network.provider.send("evm_setAutomine", [true]); }
async function mineBlock() { await network.provider.send("evm_mine", []); }
async function pendingTransactions() {
  const block = await network.provider.send("eth_getBlockByNumber", ["pending", true]);
  return block ? block.transactions : [];
}
function tip(gwei) {
  return { maxPriorityFeePerGas: BigInt(gwei) * GWEI, maxFeePerGas: (BigInt(gwei) + 100n) * GWEI, gasLimit: 400_000n };
}

module.exports = {
  E, DEADLINE, deployPool, addLiquidityEthUsd, reservesEthUsd,
  pauseMining, resumeMining, mineBlock, pendingTransactions, tip,
};
