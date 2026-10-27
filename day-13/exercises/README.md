# Day 13 — Evening exercises

Do them in order. Solutions are in [`solutions/`](solutions) and checked by `test/06-exercises.test.js` (`npm run ex`).

## 1. Easy — characters vs bytes
**Goal:** write `fits(message)` that says whether a message is allowed by `TipJar` (1–140 **bytes**), and `truncateToFit(message)` that cuts a too-long message without breaking a character in half. Check it against the real contract with random Unicode strings.
**Hint:** `message.length` counts UTF-16 units, not bytes. Use `new TextEncoder().encode(s).length`, and loop with `for (const ch of s)` so an emoji stays whole.
Solution: [`solutions/ex1-bytes.js`](solutions/ex1-bytes.js) · run `npm run ex1`

## 2. Medium — read every tip with paging
**Goal:** the contract returns at most 50 tips per `getTips(offset, limit)` call. Write `fetchAllTips(jar)` that returns all of them, newest first, with no duplicates and no gaps, for 0, 1, 50, 51 and 120 tips.
**Hint:** `offset` counts from the newest tip. Step `offset` by the page size until you have `tipCount()` tips, and stop if a page comes back empty.
Solution: [`solutions/ex2-fetch-all.js`](solutions/ex2-fetch-all.js) · run `npm run ex2`

## 3. Challenge — a leaderboard from events
**Goal:** without calling `getTips`, build "top tippers" from the `TipSent` **events** (`queryFilter`). Prove it correct: the sum of the leaderboard must equal `totalTipped()`, and the order must be stable when two people tipped the same total.
**Hint:** keep a `Map` from address to a `BigInt` total (never a JS `number` for wei). Sort by total, then by address for ties.
Solution: [`solutions/ex3-leaderboard.js`](solutions/ex3-leaderboard.js) · run `npm run ex3`
