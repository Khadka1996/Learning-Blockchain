# Day 07 — Exercises

Try each exercise before reading the solution. Solutions are runnable and tested
(`test/exercises.test.js`); the worked contract is
[`contracts/exercises/TokenPlus.sol`](../contracts/exercises/TokenPlus.sol).

```bash
npm run ex:easy
npm run ex:medium
npm run ex:challenge
```

## Easy

1. Add `increaseAllowance` and `decreaseAllowance` to `MiniToken`. Decreasing below zero must revert, not clamp.
2. Add `burnFrom(address from, uint256 value)`: burn someone's tokens using the caller's allowance.
3. Explain what "18 decimals" means. How many base units is 2.5 tokens with 18 decimals? With 6 (USDC)?

**Solution:** [`solutions/easy.js`](solutions/easy.js). *(3)* The contract stores only whole numbers.
`decimals` is a hint for wallets: show `balance / 10^decimals`. 2.5 tokens = 2,500,000,000,000,000,000
units at 18 decimals and 2,500,000 at 6. 18 matches Ether's own 18 decimals.

## Medium

4. Add an owner-only `mint` that can never push `totalSupply` past a `cap`.
5. Reproduce the **approve race** in a test (the spender front-runs a lowered allowance and takes the old *and* the new amount). Then close it with a compare-and-set `approveIfCurrent(spender, expectedCurrent, newValue)`.
6. Write a property test: after any random sequence of transfers, approvals, burns and mints, the sum of all balances equals `totalSupply`.

**Solution:** [`solutions/medium.js`](solutions/medium.js); the race test is `test/allowance.test.js`, the invariant is checked after every step in `test/fuzz.test.js`.
*(5)* `approve` overwrites. If the spender already used the old allowance, `approve(50)` hands out a *fresh* 50 on top. `approveIfCurrent` reverts with `AllowanceChanged` when the current value is not what you expected, so no second allowance appears.

## Challenge

7. Show that a vault which credits the `amount` a user *asked* to deposit becomes insolvent with a fee-on-transfer token, and fix it.
8. `permit` lets anyone submit a user's signature. How can that block `depositWithPermit`, and how does `TokenVault` avoid it?
9. Write a **differential test**: run your token and OpenZeppelin's `ERC20` on the same random operations and require identical results.

**Solution:** [`solutions/challenge.js`](solutions/challenge.js); contracts `NaiveTokenVault` (broken control) and `TokenVault`; tests in `test/TokenVault.test.js` and `test/differential.test.js`.
*(7)* Measure `balanceOf(vault)` before and after `transferFrom` and credit the difference.
*(8)* An observer copies the signature from the mempool and calls `permit` first. The nonce is then used, so Alice's own `permit` call reverts and her whole deposit fails (a cheap denial of service). `TokenVault` wraps `permit` in `try/catch`: if it fails, it just checks the allowance by trying the `transferFrom`.

## Review prompts

- Why does `approve` overwrite instead of add, and what does that cost you in a hurry?
- Why is `type(uint256).max` treated as "never decrease" by most tokens?
- What goes wrong if you call `token.transfer(...)` on USDT through a plain `IERC20` interface?
- Why must a vault measure what arrived, not what was requested?
- If `permit` "succeeds" on a token that has no `permit` function, what stops the vault from trusting a phantom allowance?
