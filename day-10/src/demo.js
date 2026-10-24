"use strict";
// Guided tour of Day 10: `npm start` (in-process chain) or `npm run demo:localhost`.
const { ethers } = require("hardhat");
const amm = require("./amm");
const { runSandwich } = require("./sandwich");
const { E, DEADLINE, deployPool, addLiquidityEthUsd, reservesEthUsd } = require("../test/helpers");

const fmt = (wei, dp = 2) => Number(ethers.formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

async function freshPool() {
  const ctx = await deployPool();
  await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000));
  return ctx;
}

async function main() {
  console.log("1. A pool: Alice deposits 100 mETH + 200,000 mUSD  (price: 1 mETH = 2,000 mUSD)");
  let ctx = await freshPool();
  const { pair, mETH, mUSD, alice, bob } = ctx;
  const k0 = (await reservesEthUsd(ctx)).eth * (await reservesEthUsd(ctx)).usd;
  console.log(`   Alice receives ${fmt(await pair.balanceOf(alice.address))} LP shares (sqrt(100 x 200,000) minus 1,000 wei locked forever)`);

  console.log("\n2. Price impact: the bigger the trade, the worse the price");
  console.log("   sell mETH   get mUSD      avg price    impact");
  for (const n of [1, 5, 10, 25, 50]) {
    const out = amm.getAmountOut(E(n), E(100), E(200_000));
    const impact = amm.priceImpactPct(E(n), E(100), E(200_000));
    console.log(`   ${String(n).padStart(6)}   ${fmt(out).padStart(10)}   ${fmt(out / BigInt(n)).padStart(9)}   ${impact.toFixed(2).padStart(6)}%`);
  }

  console.log("\n3. Fees stay in the pool: Bob trades 5 mETH back and forth 10 times");
  for (let i = 0; i < 10; i++) {
    const got = await pair.quote(mETH, E(5));
    await pair.connect(bob).swap(mETH, E(5), 0n, bob.address, DEADLINE);
    await pair.connect(bob).swap(mUSD, got, 0n, bob.address, DEADLINE);
  }
  const r = await reservesEthUsd(ctx);
  const growth = Number(((r.eth * r.usd - k0) * 1_000_000n) / k0) / 10_000;
  console.log(`   reserves now ${fmt(r.eth, 4)} mETH + ${fmt(r.usd)} mUSD; k grew by ${growth.toFixed(2)}%`);
  const shares = await pair.balanceOf(alice.address);
  const before = [await mETH.balanceOf(alice.address), await mUSD.balanceOf(alice.address)];
  await pair.connect(alice).removeLiquidity(shares, 0n, 0n, alice.address, DEADLINE);
  const gotEth = (await mETH.balanceOf(alice.address)) - before[0];
  const gotUsd = (await mUSD.balanceOf(alice.address)) - before[1];
  console.log(`   Alice withdraws: ${fmt(gotEth, 4)} mETH + ${fmt(gotUsd)} mUSD (she put in 100 + 200,000)`);

  console.log("\n4. Sandwich attack on Carol's swap of 5 mETH (bot budget 20 mETH)");
  ctx = await freshPool();
  const fair = amm.getAmountOut(E(5), E(100), E(200_000));
  console.log(`   Fair output with nobody in the way: ${fmt(fair)} mUSD`);
  const a = await runSandwich(ctx, { victim: ctx.carol, bot: ctx.bot, victimIn: E(5), victimMinOut: 0n, botBudget: E(20) });
  console.log(`   No slippage limit : Carol gets ${fmt(a.victimGot)} mUSD (loses ${fmt(a.victimLoss)}, ${pct(a.victimLoss, a.fairOut)}); bot profit ${fmt(a.botProfitEth, 4)} mETH`);
  ctx = await freshPool();
  const min = (fair * 9_950n) / 10_000n;
  const b = await runSandwich(ctx, { victim: ctx.carol, bot: ctx.bot, victimIn: E(5), victimMinOut: min, botBudget: E(20) });
  console.log(`   0.5% slippage limit: Carol gets ${fmt(b.victimGot)} mUSD (loses ${fmt(b.victimLoss)}, ${pct(b.victimLoss, b.fairOut)}); bot profit ${fmt(b.botProfitEth, 4)} mETH`);

  console.log("\n5. Donation attack: tokens sent straight to the pool are ignored");
  ctx = await deployPool();
  await addLiquidityEthUsd(ctx, ctx.bot, 1001n, 1001n);
  await ctx.mETH.connect(ctx.bot).transfer(ctx.pair, E(1_000));
  await ctx.mUSD.connect(ctx.bot).transfer(ctx.pair, E(1_000));
  await addLiquidityEthUsd(ctx, ctx.carol, E(10), E(10));
  const cs = await ctx.pair.balanceOf(ctx.carol.address);
  const cb = await ctx.mETH.balanceOf(ctx.carol.address);
  await ctx.pair.connect(ctx.carol).removeLiquidity(cs, 0n, 0n, ctx.carol.address, DEADLINE);
  console.log(`   Attacker donated 1,000 + 1,000. Carol deposits 10 + 10 and withdraws ${fmt((await ctx.mETH.balanceOf(ctx.carol.address)) - cb, 6)} mETH back. Attack failed.`);

  const gas = await (await ctx.pair.connect(bob).swap(ctx.mETH, E(1), 0n, bob.address, DEADLINE).catch(() => null))?.wait?.();
  if (gas) console.log(`\n   (gas for one swap: ${gas.gasUsed.toLocaleString("en-US")})`);
}

function pct(part, whole) {
  return `${(Number((part * 1_000_000n) / whole) / 10_000).toFixed(2)}%`;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
