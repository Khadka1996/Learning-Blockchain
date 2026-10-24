"use strict";
const { ethers } = require("hardhat");
const { arbitrageSize } = require("./ex3-arbitrage-size");
const { E, DEADLINE, deployPool, addLiquidityEthUsd, reservesEthUsd } = require("../../test/helpers");

/** Closed form: loss of an LP vs holding, when the price changes by factor r. Negative number. */
function impermanentLossFormula(r) {
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}

/** Real contract: pool starts at 2,000 mUSD/mETH, outside price becomes 2,000·r (r < 1 means a fall is handled by selling mUSD; here r >= 1). */
async function measure(r) {
  const ctx = await deployPool();
  const { pair, alice, bot, mETH } = ctx;
  await addLiquidityEthUsd(ctx, alice, E(100), E(200_000));
  const heldValue = (price) => 100 * price + 200_000; // 100 mETH + 200,000 mUSD valued at `price`
  const newPrice = 2_000 * r;
  // arbitrageur sells mUSD? No: price of mETH rose, so the arbitrageur BUYS mETH (sells mUSD). Mirror the maths on the mUSD side.
  const { eth, usd } = await reservesEthUsd(ctx);
  // outside price of 1 mUSD in mETH = 1 / newPrice
  const dy = arbitrageSize(usd, eth, 1_000_000n, BigInt(Math.round(newPrice * 1_000_000)));
  const mUSD = ctx.mUSD;
  await pair.connect(bot).swap(mUSD, dy, 0n, bot.address, DEADLINE);
  const shares = await pair.balanceOf(alice.address);
  const before = [await mETH.balanceOf(alice.address), await mUSD.balanceOf(alice.address)];
  await pair.connect(alice).removeLiquidity(shares, 0n, 0n, alice.address, DEADLINE);
  const gotEth = Number(ethers.formatEther((await mETH.balanceOf(alice.address)) - before[0]));
  const gotUsd = Number(ethers.formatEther((await mUSD.balanceOf(alice.address)) - before[1]));
  const lpValue = gotEth * newPrice + gotUsd;
  return { lpValue, heldValue: heldValue(newPrice), loss: lpValue / heldValue(newPrice) - 1 };
}

async function main() {
  const r = 2;
  const m = await measure(r);
  console.log(`price x${r}: formula ${(impermanentLossFormula(r) * 100).toFixed(2)}%  contract ${(m.loss * 100).toFixed(2)}%`);
  console.log(`LP can withdraw $${m.lpValue.toFixed(0)}, holding would be $${m.heldValue.toFixed(0)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { impermanentLossFormula, measure };
