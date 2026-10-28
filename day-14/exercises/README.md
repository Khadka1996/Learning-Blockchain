# Day 14 — Evening exercises

Do them in order. Solutions are in [`solutions/`](solutions) and checked by `test/07-exercises.test.js` (`npm run ex`).

## 1. Easy — how long until a weak secret is cracked?
**Goal:** write `crackPin(digits)` that brute-forces a lock `Poseidon(pin)` for an n-digit PIN and returns `{ guesses, ms }`. Run it for 3, 4 and 5 digits and write one sentence about why ZK does not help a weak secret. Then compute (not run!) how long 248 random bits would take at your measured speed.
**Hint:** the lock is public, so just hash `0, 1, 2, …` until one matches. Use `poseidonHash` from `src/zk.js`. For 248 bits the answer is `2**248 / guessesPerSecond` seconds, which is far longer than the age of the universe.
Solution: [`solutions/ex1-crack-pin.js`](solutions/ex1-crack-pin.js) · run `npm run ex1`

## 2. Medium — measure the "per day" limit
**Goal:** the wallet resets its limit at UTC midnight (QA known issue K7). Write `maxInWindow(sends, windowSeconds)` that takes a list of `{ t, amount }` sends and returns the biggest total that left inside **any** window of that length. Show that two 1 ETH sends 35 seconds apart around midnight give `2` in a 60 s window although the limit is 1 per day.
**Hint:** sort by time, then use two pointers (a sliding window). Use `BigInt` for money.
Solution: [`solutions/ex2-window.js`](solutions/ex2-window.js) · run `npm run ex2`

## 3. Challenge — a limit with no midnight loophole
**Goal:** write a `RollingLimit` class (the model of a better contract) that allows at most `limit` in **any** 24 hours. Prove it with a property test: for random sends, `maxInWindow(accepted, 24h)` never exceeds the limit, while the calendar-day rule from the contract does exceed it.
**Hint:** keep every accepted send `{ t, amount }`; before accepting a new one, sum only the sends from the last 24 h. (A contract would use 24 hourly buckets to keep the gas bounded: the next step.)
Solution: [`solutions/ex3-rolling-limit.js`](solutions/ex3-rolling-limit.js) · run `npm run ex3`
