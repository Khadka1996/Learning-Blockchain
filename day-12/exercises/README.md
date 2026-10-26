# Day 12 — Evening exercises

Do them in order. Solutions are in [`solutions/`](solutions) and checked by `test/06-exercises.test.js` (`npm run ex`).

## 1. Easy — how many rounds does a fraud proof need?
**Goal:** write `roundsFor(n)` = the most bisection rounds needed to find one bad transaction in a batch of `n`. Then run a real challenge (a sequencer that lies after tx #k) and check the measured rounds never exceed your number.
**Hint:** each round halves the range, so you need ⌈log₂ n⌉ rounds. Avoid `Math.log2` (floating point): double a counter from 1 until it reaches `n`.
Solution: [`solutions/ex1-bisection.js`](solutions/ex1-bisection.js) · run `npm run ex1`

## 2. Medium — when does a rollup beat a plain transfer?
**Goal:** a plain L1 transfer costs 21,000 gas. Find the smallest batch size where the **per-transaction** L1 cost drops below that, first with a formula, then by measurement, and compare.
**Hint:** per-tx cost = `overhead / n + calldataPerTx`. Solve `overhead / n + calldataPerTx < 21,000` for `n`. Measure `calldataPerTx` on a big batch (2,000 txs) where the overhead barely matters.
Solution: [`solutions/ex2-breakeven.js`](solutions/ex2-breakeven.js) · run `npm run ex2`

## 3. Challenge — a JavaScript twin of `SafePriceReader`
**Goal:** write `modelPrice(input)` that returns either `{ ok: true, price }` or `{ ok: false, error }` with the **same checks in the same order** as the Solidity contract (L1 mode: price > 0, timestamp sane, age ≤ heartbeat, inside the band), scaling 8 decimals to 18. Prove it with a **differential fuzz**: random answers and ages must give the same result from your model and from the deployed contract.
**Hint:** order matters when two things are wrong at once (a negative price that is also stale must report `InvalidPrice`). Hardhat runs `eth_call` at the timestamp of the latest block, so use that as `now`.
Solution: [`solutions/ex3-price-model.js`](solutions/ex3-price-model.js) · run `npm run ex3`
