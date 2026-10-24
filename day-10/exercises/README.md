# Day 10 — Evening exercises

Do them in order. Solutions are in [`solutions/`](solutions) and checked by `test/05-exercises.test.js` (`npm run ex`).

## 1. Easy — the price-impact table
**Goal:** for a pool of 100 mETH / 200,000 mUSD, print the output, average price and price impact for sales of 1, 5, 10, 25 and 50 mETH. Write the function so it works for any pool.
**Hint:** `src/amm.js` already has `getAmountOut` and `priceImpactPct`. Start from the jar-and-apples rule: the bigger the trade, the worse each extra orange.
Solution: [`solutions/ex1-impact-table.js`](solutions/ex1-impact-table.js) · run `npm run ex1`

## 2. Medium — measure impermanent loss
**Goal:** an LP deposits 100 mETH + 200,000 mUSD. The outside price of mETH then doubles and arbitrageurs fix the pool. Compare what the LP can withdraw with what they would have if they had simply held the tokens. First predict it with the closed form `IL = 2·√r / (1 + r) − 1`, then prove it on the real contract.
**Hint:** the pool is only correct again when `reserveUSD / reserveETH` equals the new price. You can reach that state with one swap sized by exercise 3 (or by trying sizes by hand). Compare values in mUSD.
Solution: [`solutions/ex2-impermanent-loss.js`](solutions/ex2-impermanent-loss.js) · run `npm run ex2`

## 3. Challenge — the arbitrage bot's trade size
**Goal:** given a pool and an outside price, compute the **exact** amount to sell so that, after the swap (with the 0.30% fee), the pool's marginal price equals the outside price. Return `0` if the pool is already within the fee band. Check it against the contract.
**Hint:** the marginal price of selling a tiny extra amount is `0.997 · reserveOut / reserveIn`. That price falls as you sell, so the right size can be found by bisection on integers (no floating point near money).
Solution: [`solutions/ex3-arbitrage-size.js`](solutions/ex3-arbitrage-size.js) · run `npm run ex3`
