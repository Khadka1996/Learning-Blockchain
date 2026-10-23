# Day 09 — Exercises

Try each exercise before reading the solution. Solutions are runnable and tested (`test/exercises.test.js`).

```bash
npm run ex:easy
npm run ex:medium
npm run ex:challenge
```

## Easy

1. **Build a commitment by hand.** `CommitRevealPuzzle.makeCommitment(player, answer, salt)` is a helper. Compute the same 32 bytes in JavaScript *without* calling it, then check they match.
   *Goal:* see that a commitment is just `keccak256(abi.encode(address, string, bytes32))`.
   *Hint:* `ethers.AbiCoder.defaultAbiCoder().encode([...], [...])` then `ethers.keccak256`. Use `encode`, not `encodePacked`: ask yourself what could go wrong if two fields were glued together.
2. **Catch the ERC-20 look-alike.** Which of the fixed contracts expose a function with the ERC-20 `transfer(address,uint256)` selector?
   *Hint:* a selector is the first 4 bytes of `keccak256("transfer(address,uint256)")` = `0xa9059cbb`.

## Medium

3. **Write a pull-payment auction.** A 1-day auction where an outbid bidder gets their money back *without* the auction ever sending ETH to them during `bid()`. Prove that a bidder who cannot receive ETH does not stop the auction.
   *Goal:* the DoS lesson (bug 5), applied to a new contract.
   *Hint:* `pendingReturns[previousBidder] += previousBid`; they call `withdraw()` themselves. Zero the record **before** sending.

## Challenge

4. **Let a fuzzer find the bug.** `LeakyBank` is a bank with one deleted line. Without reading the code, write a property test: *"ETH held by the bank = sum of all balances"* after random deposits, transfers and withdrawals. Run it on `LeakyBank` and on `SafeBank`.
   *Goal:* learn why an invariant beats a hand-written example: you did not need to know where the bug was.
   *Hint:* fast-check can generate a list of actions; replay them on a fresh contract, check the invariant after every step. A good fuzzer also *shrinks* the failure to the shortest program.

---

## Solutions

*(1)* [`solutions/easy.js`](solutions/easy.js) — the JavaScript hash matches the contract's helper. `abi.encode` pads every field to a clear boundary; with packed encoding, `("ab","c")` and `("a","bc")` would hash the same.
*(2)* The same script lists every fixed contract's selectors; none has `0xa9059cbb` (this is QA finding S1).
*(3)* [`solutions/medium.js`](solutions/medium.js), contract [`PullAuction.sol`](../contracts/exercises/PullAuction.sol). A bidder that cannot receive ETH bids, gets outbid, and the next bid still succeeds; the old bidder's money waits in `pendingReturns`.
*(4)* [`solutions/challenge.js`](solutions/challenge.js), contract [`LeakyBank.sol`](../contracts/exercises/LeakyBank.sol). The fuzzer breaks `LeakyBank` and shrinks the failure to a tiny program (printed by the script); `SafeBank` survives the same test.
