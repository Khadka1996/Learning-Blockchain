"use strict";
// A sandwich bot, run against a REAL pending transaction on the local Hardhat chain.
// 1. Victim's swap waits in the mempool (automine off).
// 2. Bot reads it, buys first with a higher tip (front-run), and sells right after it with a lower tip (back-run).
// 3. One block is mined: front-run → victim → back-run.
const { ethers } = require("hardhat");
const { getAmountOut } = require("./amm");
const { DEADLINE, pauseMining, resumeMining, mineBlock, pendingTransactions, tip, reservesEthUsd } = require("../test/helpers");

/**
 * Largest front-run (in mETH) that still lets the victim's swap pass its own minAmountOut.
 * A rational bot never makes the victim revert — then it would only pay fees for nothing.
 */
function bestFrontRun(victimIn, victimMinOut, rEth, rUsd, cap) {
  const victimOutAfter = (f) => {
    const o = getAmountOut(f, rEth, rUsd);
    return getAmountOut(victimIn, rEth + f, rUsd - o);
  };
  if (victimOutAfter(1n) < victimMinOut) return 0n;
  let lo = 1n;
  let hi = cap;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (victimOutAfter(mid) >= victimMinOut) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/** Run one sandwich. Returns what the victim got and what the bot earned (in mETH). */
async function runSandwich(ctx, { victim, bot, victimIn, victimMinOut, botBudget }) {
  const { pair, mETH, mUSD } = ctx;
  const { eth: rEth, usd: rUsd } = await reservesEthUsd(ctx);
  const fairOut = getAmountOut(victimIn, rEth, rUsd);
  const botEthBefore = await mETH.balanceOf(bot.address);
  const victimUsdBefore = await mUSD.balanceOf(victim.address);

  await pauseMining();
  try {
    // The victim signs and broadcasts: 2 gwei tip.
    await pair.connect(victim).swap(mETH, victimIn, victimMinOut, victim.address, DEADLINE, tip(2));

    // The bot watches the public waiting room.
    const pairAddr = (await pair.getAddress()).toLowerCase();
    const seen = (await pendingTransactions()).find((t) => t.to && t.to.toLowerCase() === pairAddr);
    const decoded = pair.interface.parseTransaction({ data: seen.input });
    const [, seenIn, seenMin] = decoded.args;

    const front = bestFrontRun(seenIn, seenMin, rEth, rUsd, botBudget);
    let frontOut = 0n;
    if (front > 0n) {
      frontOut = getAmountOut(front, rEth, rUsd);
      await pair.connect(bot).swap(mETH, front, 0n, bot.address, DEADLINE, tip(50)); // before the victim
      await pair.connect(bot).swap(mUSD, frontOut, 0n, bot.address, DEADLINE, tip(1)); // after the victim
    }
    await mineBlock();
  } finally {
    await resumeMining();
  }

  const victimGot = (await mUSD.balanceOf(victim.address)) - victimUsdBefore;
  const botProfitEth = (await mETH.balanceOf(bot.address)) - botEthBefore;
  return { fairOut, victimGot, victimLoss: fairOut - victimGot, botProfitEth };
}

module.exports = { bestFrontRun, runSandwich, ethers };
