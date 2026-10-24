"use strict";
const { getAmountOut, BPS, FEE_BPS } = require("../../src/amm");

/**
 * Amount of the input token to sell so that, afterwards, the pool's marginal price
 * (fee included) equals `targetPrice` = outside price of 1 input token in output tokens,
 * given as a fraction targetNum / targetDen. Returns 0n if no profitable trade exists.
 * Bisection on integers: the marginal price only ever falls as you sell more.
 */
function arbitrageSize(reserveIn, reserveOut, targetNum, targetDen) {
  const marginalOk = (dx) => {
    const out = getAmountOut(dx, reserveIn, reserveOut);
    const rIn = reserveIn + dx;
    const rOut = reserveOut - out;
    // (BPS-FEE)/BPS * rOut/rIn >= num/den   (cross-multiplied, no division)
    return (BPS - FEE_BPS) * rOut * targetDen >= BPS * rIn * targetNum;
  };
  if (!marginalOk(1n)) return 0n; // already inside the fee band (or the pool pays less than outside)
  let lo = 1n;
  let hi = reserveIn * 1_000n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (marginalOk(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

if (require.main === module) {
  const E18 = 10n ** 18n;
  const dx = arbitrageSize(100n * E18, 200_000n * E18, 1_500n, 1n); // outside price: 1,500 mUSD per mETH
  console.log("sell", Number(dx) / 1e18, "mETH to push the pool to 1,500 mUSD (pool started at 2,000)");
}

module.exports = { arbitrageSize };
