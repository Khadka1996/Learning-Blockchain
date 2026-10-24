"use strict";
// Pure-JS reference model of SimplePair's maths (BigInt, same rounding as Solidity).
// Tests use it as an "oracle": the contract must agree with it to the last wei.

const FEE_BPS = 30n;
const BPS = 10_000n;

/** Tokens out for `amountIn`, after the 0.30% fee. Rounds down like the contract. */
function getAmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n) throw new Error("ZeroAmount");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("InsufficientLiquidity");
  const inWithFee = amountIn * (BPS - FEE_BPS);
  return (inWithFee * reserveOut) / (reserveIn * BPS + inWithFee);
}

/** Integer square root (floor), same result as OpenZeppelin Math.sqrt. */
function sqrt(n) {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Price impact of a swap in percent: how much worse than the "spot" price you are paid.
 * spot = reserveOut / reserveIn; effective = amountOut / amountIn.
 */
function priceImpactPct(amountIn, reserveIn, reserveOut) {
  const out = getAmountOut(amountIn, reserveIn, reserveOut);
  // 1 - (out/in) / (rOut/rIn) = 1 - out·rIn / (in·rOut), scaled to 0.01% precision
  const scaled = 1_000_000n - (out * reserveIn * 1_000_000n) / (amountIn * reserveOut);
  return Number(scaled) / 10_000;
}

module.exports = { FEE_BPS, BPS, getAmountOut, sqrt, priceImpactPct };
