"use strict";
const { getAmountOut, priceImpactPct } = require("../../src/amm");

const E18 = 10n ** 18n;

/** Rows of {sell, out, avgPrice, impactPct} for a pool (reserves in wei). */
function impactTable(reserveIn, reserveOut, sells) {
  return sells.map((eth) => {
    const amountIn = BigInt(eth) * E18;
    const out = getAmountOut(amountIn, reserveIn, reserveOut);
    return {
      sell: eth,
      out: Number((out + 5n * 10n ** 15n) / 10n ** 16n) / 100,
      avgPrice: Number((out * 100n + amountIn / 2n) / amountIn) / 100,
      impactPct: priceImpactPct(amountIn, reserveIn, reserveOut),
    };
  });
}

if (require.main === module) {
  console.table(impactTable(100n * E18, 200_000n * E18, [1, 5, 10, 25, 50]));
}

module.exports = { impactTable };
