# Day 11 — Evening exercises

Do them in order. Solutions are in [`solutions/`](solutions) and checked by `test/05-exercises.test.js` (`npm run ex`).

## 1. Easy — how many storage boxes?
**Goal:** write `slotsUsed(fields)` for a list of struct fields like `["address","uint64","uint32"]`. Solidity packs fields left to right into 32-byte slots and starts a new slot when the next field doesn't fit. Show that `ClubNaive.Member` needs 4 slots and `ClubOptimized.Member` needs 1.
**Hint:** sizes are `bool` 1, `uint8` 1, `uint32` 4, `uint64` 8, `address` 20, `uint256` 32 bytes. Keep a running total; when `total + size > 32`, start a new slot. (Note: `ClubNaive.Member` is a struct whose members are *not* adjacent-small, so the order matters.)
Solution: [`solutions/ex1-slots.js`](solutions/ex1-slots.js) · run `npm run ex1`

## 2. Medium — predict the storage cost
**Goal:** using the real prices (new box 20,000 gas, changing a used box 2,900, first touch of a box +2,100), predict the storage cost of rewarding N brand-new members for the naive and the packed club. Compare the *ratio* with the measured 69.7% saving for N = 50.
**Hint:** in the naive club each member's `points` box starts empty (20,000) and is also touched cold (+2,100). In the packed club the box was filled when the member joined, so it is a 2,900 + 2,100 update. Ignore everything that isn't a storage write; your answer will be close, not exact.
Solution: [`solutions/ex2-gas-model.js`](solutions/ex2-gas-model.js) · run `npm run ex2`

## 3. Challenge — an upgrade-safety checker
**Goal:** write `checkUpgrade(oldLayout, newLayout)` that returns `{ safe, problems }`. A new layout is safe only if every old variable keeps its **slot, name and type**, and new variables are only **appended**. Run it on PiggyBank V1 → V2 (safe) and V1 → the reordered V2 (unsafe), then confirm on a real proxy that `totalDeposits` really lives in slot 1.
**Hint:** compare the arrays by index for the length of the old one; anything after that is an append. Reading a slot from a deployed proxy: `ethers.provider.getStorage(proxyAddress, 1)`.
Solution: [`solutions/ex3-upgrade-check.js`](solutions/ex3-upgrade-check.js) · run `npm run ex3`
