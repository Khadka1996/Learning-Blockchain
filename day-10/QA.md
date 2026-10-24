# Day 10 — QA & security review

**Scope:** `contracts/SimplePair.sol` (the production code of the day), `src/amm.js`, `src/sandwich.js`, `src/demo.js`, `test/helpers.js`. The contracts in `contracts/test-helpers/` are mock or **hostile on purpose** and were only checked to behave as intended. OpenZeppelin 5.0.2 is a dependency and was not audited.
**Method:** reference model first (the JS copy of the maths must match the contract to the wei), attack tests (sandwich, donation, weird tokens, re-entrancy), fuzz invariants with fast-check, then the tools (ESLint, Solhint, `npm audit`, Slither 102 detectors) and a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md).
**Rounds:** 3 (round 1: tests + tools · round 2: manual attacker review, 1 fix · round 3: everything re-run on the final code, clean).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| L1 | Low | Manual review (input validation) | **`addLiquidity` accepted the pool itself or a token contract as `to`.** `swap` and `removeLiquidity` already refused those recipients, but LP shares minted to the pool (or to `token0`/`token1`) can never be redeemed: those contracts will never call `removeLiquidity`. One wrong address in a frontend and a deposit is lost, no attacker needed. | `addLiquidity` now uses the same `_checkRecipient` as the other functions (zero address, pool, token0, token1 → `InvalidRecipient`). | `L1: LP shares cannot be minted to the pool itself or to a token contract` |
| T1 | Low | fast-check (my own test) | **The fuzzer could not tell an expected revert from a real bug.** Hardhat reported `InsufficientOutput(0,0)` (a 1-wei swap that buys nothing) as "unrecognized custom error", so the property failed on the first random program. Matching on the message text would also have hidden real failures. | Reverts are decoded with the pool's ABI (`parseError`) and only an explicit allow-list (`ZeroAmount`, `InsufficientOutput`, `InsufficientAmounts`, `InsufficientLiquidityMinted`, `ERC20InsufficientBalance`) counts as expected. Anything else fails the test. | `Invariants (fast-check)` |
| P1 | Info | Manual pentest (front-running) | **Add-liquidity sandwich.** A bot moves the price just before Bob's deposit so he joins at a bad ratio. Uniswap's router has `amountAMin/amountBMin`; does `minShares` alone protect him? | No change needed: any price move away from the quote lowers the shares minted (the binding reserve grows), so a `minShares` set from the quote catches it. Documented that frontends must set `minShares`. | `P1: an attacker who moves the price before Bob's deposit is caught by minShares` |
| I1 | Info | Slither `reentrancy-eth` / `reentrancy-balance` / `reentrancy-benign` | In `swap` and `addLiquidity` the reserves are written **after** the token pull (`transferFrom`). | Intended: the pool must measure what really arrived (fee-on-transfer tokens), which is only known after the pull. Every state-changing function is `nonReentrant` (hostile-token test reverts with `ReentrancyGuardReentrantCall`). A contract that only **reads** the pool mid-swap sees the old reserves and supply together: a complete, consistent state (read-only re-entrancy probe). | `hostile token that re-enters swap() is stopped by the lock` · `I1: a contract reading the pool in the middle of a swap sees the old, consistent state` |
| I2 | Info | Manual review (accounting) | Donation / first-depositor inflation attack: create the pool with 1,001 wei each (1 share), donate 1,000 tokens, hope the next depositor's shares round to 0. | No change needed: prices and shares use `reserve0/1`, not `balanceOf`; 1,000 shares are locked on the first deposit. The victim got her 10 mETH back. | `tokens sent straight to the pool do not change price or share value` |

### Known issues (accepted, with reasoning)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K1 | **Tokens sent directly to the pool are stuck.** There is no `skim()`/`sync()` like Uniswap V2. | Adding `skim` gives the excess to whoever calls first (a free-for-all), and `sync` lets anyone change the books. Neither is needed for the lesson; the stuck amount only ever belongs to the person who sent it by mistake. |
| K2 | **Fee-on-transfer tokens on a deposit into an existing pool**: the two amounts that arrive are no longer in the exact ratio; the smaller side decides the shares and the extra stays in the pool (a ~1% gift to other LPs). | The pool stays correct (books = balances, fuzzed); the depositor is protected by `minShares`. This is how Uniswap V2 behaves too. |
| K3 | **Astronomically large balances overflow** (`amountIn · 9,970 · reserveOut` > 2²⁵⁶, i.e. above ~10⁷³ wei on both sides). | The overflow **reverts** (Solidity 0.8 checked maths); it can never pay out a wrong amount. No real token has that supply. |
| K4 | **The spot price is easy to move within one transaction.** | Never use `reserve1 / reserve0` as a price oracle for lending or liquidations: a flash loan can push it anywhere for one block. That is Day 12 (oracles, TWAP, staleness checks). |
| K5 | **A sandwich within the slippage limit still profits** (0.0245 mETH in the demo). | `minAmountOut` caps the loss; it cannot remove it. Private mempools / MEV protection are the real fix and are out of scope for one contract. |

## Tool results (final round)

| Tool | Result |
|---|---|
| `npm test` | **25 / 25 pass** (~10 s) |
| Fuzz (default `FUZZ_RUNS=150`) | 150 random programs of add/swap/remove by 3 users, all four invariants held after every step (books = balances, no side empty, value per share never down, `k` never down on a swap + output = model); 2,000 random round trips never profitable |
| ESLint + Solhint | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither (102 detectors, 17 contracts) | 31 results, all explained below; **none open in `SimplePair.sol`** |
| `npm start` and `npm run demo:localhost` | same output on the in-process chain and on a separate `hardhat node` |

Slither on `SimplePair.sol`:
- `reentrancy-eth`, `reentrancy-balance`, `reentrancy-benign` (addLiquidity, swap): see I1. Protected by `nonReentrant`, proven by tests. **Accepted.**
- `incorrect-equality` (`supply == 0`, `amountIn == 0`, `shares == 0`, …): these are input and first-deposit checks, not equality on balances an attacker can nudge. **False positive.**

Slither on test helpers / OpenZeppelin:
- `unused-return` (`ReentrantToken` ignores the result of its re-entry attempt — the attempt is the point), `missing-inheritance`: test-only. **Accepted.**
- `incorrect-exp`, `divide-before-multiply`, `assembly` (OpenZeppelin `Math.mulDiv`), `low-level-calls` (OpenZeppelin `Address`/`SafeERC20`), `pragma` / `solc-version` (`^0.8.20` vs pinned `0.8.24`), `naming-convention`: inside the audited dependency or style. **Accepted.**

## Final green output

```
  SimplePair — x · y = k
    deployment
      ✔ sorts the tokens and rejects bad pairs
    liquidity
      ✔ first deposit mints sqrt(x·y) shares and locks 1,000 forever
      ✔ rejects a first deposit too small to cover the locked shares
      ✔ later deposits take only the matching ratio and mint proportional shares
      ✔ minShares protects the depositor
      ✔ remove returns your share of both reserves, fees included
      ✔ remove enforces minimums, zero shares and recipient checks
    swap
      ✔ pays exactly what the formula says (matches the JS model to the wei)
      ✔ the 0.30% fee makes k grow after every swap
      ✔ bigger trades get worse prices (price impact)
      ✔ can never empty a side of the pool
      ✔ rejects zero amounts, unknown tokens, bad recipients and expired deadlines
      ✔ refuses to swap in an empty pool
  Attacks on the pool
    sandwich (front-run + back-run) — why minAmountOut exists
      ✔ no slippage limit: the bot takes a big bite of the victim's trade
      ✔ 0.5% slippage limit: the most the bot can take is 0.5%
      ✔ a greedy front-run bigger than the limit allows makes the victim's swap revert (no trade, no loss)
      ✔ bestFrontRun returns 0 when even 1 wei would break the victim's limit
    donation / first-depositor inflation attack
      ✔ tokens sent straight to the pool do not change price or share value
    weird tokens
      ✔ fee-on-transfer token: the pool counts what arrived, not what was asked
      ✔ hostile token that re-enters swap() is stopped by the lock
  Invariants (fast-check)
    ✔ books match reality, k never shrinks on a swap and a share never loses value
    ✔ buying and immediately selling back always loses (no free money from rounding)
      fuzz: 150 programs, 946 steps, 203 reverted as expected
  QA findings (regression)
    ✔ L1: LP shares cannot be minted to the pool itself or to a token contract (they would be lost)
    ✔ P1: an attacker who moves the price before Bob's deposit is caught by minShares
    ✔ I1: a contract reading the pool in the middle of a swap sees the old, consistent state (no read-only re-entrancy window)
  25 passing
```
