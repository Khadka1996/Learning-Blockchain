# Day 06 — Exercises

Try each exercise before reading the solution. Solutions are runnable and tested
(`test/exercises.test.js`); the worked contract is
[`contracts/exercises/VaultPlus.sol`](../contracts/exercises/VaultPlus.sol).

```bash
npm run ex:easy
npm run ex:medium
npm run ex:challenge
```

## Easy

1. Add a `depositCount` state variable and increment it on every successful deposit.
2. Add a `getBalance(address)` view function that returns the mapping value.
3. Explain why `owner` is `immutable` while `paused` is not.

**Solution:** [`solutions/easy.js`](solutions/easy.js). *(3)* `owner` never changes after deployment, so the
compiler copies it into the bytecode (cheap, no storage slot). `paused` changes at run time, so it must live in storage.

## Medium

4. Add a minimum deposit and a custom error for deposits below it, e.g. `BelowMinimum(sent, minimum)`.
5. Write a test proving the account in `Deposited` is `indexed`.
6. Write a test proving a reverted withdrawal changes neither the user balance nor `totalDeposits`.

**Solution:** [`solutions/medium.js`](solutions/medium.js). Tests: `Medium 5-6` and `VaultPlus` in `test/exercises.test.js`.
*(5)* An indexed argument becomes a log *topic*; the log then has 2 topics: signature + account.

## Challenge

7. Write an attacker contract that re-enters `withdraw` from `receive()`. Prove the second call reverts and accounting stays correct. *First prove the attack works on a broken vault.*
8. Explain the trade-off in pausing withdrawals.
9. Design a two-step ownership transfer (`pendingOwner` + `acceptOwnership`) and test that only the pending owner can accept.

**Solution:** [`solutions/challenge.js`](solutions/challenge.js); contracts `ReentrantAttacker`, `VulnerableVault`, `VaultPlus`.
*(8)* Pausing withdrawals can stop a live drain, but it freezes every honest user and, if the owner key is lost while
paused, forever. Pausing only deposits is safer for users but cannot stop an exploit that goes through `withdraw`.
Real systems add a timelock, a multisig owner or an auto-expiring pause.
*(9)* Step 1 only nominates; step 2 must come from the nominee, which proves the address is controlled by a real key (a typo address can never take over). That needs a **mutable** owner, which is why `VaultPlus.owner` is not `immutable`.

## Review prompts

- Why is a custom error usually cheaper than `require(cond, "long text")`?
- Why does the reentrancy guard switch between 1 and 2 instead of 0 and 1?
- Why can a loop over a list that anyone can grow be dangerous in a state-changing function?
- A test says "the attack fails". What must you check before believing it?
