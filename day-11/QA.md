# Day 11 — QA & security review

**Scope:** `contracts/gas/ClubOptimized.sol`, `contracts/upgrade/PiggyBankV1.sol`, `contracts/upgrade/PiggyBankV2.sol` (the production code of the day), `src/*.js`, `test/helpers.js`. `ClubNaive.sol` is wasteful **on purpose** (it is the "before" picture) and was checked only for correctness, not gas. The contracts in `contracts/upgrade/test-helpers/` are broken or hostile on purpose. OpenZeppelin 5.0.2 (`contracts`, `contracts-upgradeable`) is a dependency and was not audited.
**Method:** differential testing first (naive vs optimized must agree on every result), then upgrade-specific attacks (re-initialisation, unlocked implementation, unauthorised upgrade, bricking, storage collision, init front-running), then the tools (ESLint, Solhint, `npm audit`, Slither 102 detectors, OpenZeppelin storage-layout validation) and a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md).
**Rounds:** 3 (round 1: tests + tools · round 2: manual attacker review, 1 fix + 5 probe tests · round 3: everything re-run on the final code, clean).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| L1 | Low | Manual review (access control) | **One typo could lose upgrade control forever.** `PiggyBankV1` used single-step `Ownable`: `transferOwnership(wrongAddress)` hands the upgrade key, the pause switch and the cap to an address nobody controls, instantly and irreversibly. On an upgradeable contract that freezes all future bug fixes. | Switched to `Ownable2StepUpgradeable`: the new owner must call `acceptOwnership()`; until then the old owner stays in charge and can correct the address. Its storage is ERC-7201-namespaced, so the change does not shift our slots (plugin validation passes). | `L1: a mistyped new owner cannot take (or lose) upgrade control — ownership is two-step` |
| T1 | Low | Test run (my own setup) | **The storage-layout check failed for the wrong reason.** My first broken-V2 test passed, but the plugin was complaining about a *missing initializer*, not the reordered variables. A test that is green for the wrong reason proves nothing. | `PiggyBankV2Broken` now has a proper initializer and the same parents as V1, so the only difference is the variable order; the test asserts the error mentions `New storage layout is incompatible` **and** `balanceOf`. Same root cause in V2: `initialize` was `external`, which the plugin did not see as inherited → made it `public`. | `hardhat-upgrades refuses the broken V2 before it is deployed` |
| P1 | Info | Manual pentest (front-running) | **Initializer front-running after an upgrade.** If the owner upgrades without the init call, can an attacker call `initializeV2` first and set the cap? | No change needed: `initializeV2` is `reinitializer(2)` **and** `onlyOwner`. The default before init is `maxPerUser = 0` (no cap), so nothing gets locked. | `P1: after an upgrade WITHOUT the init call, nobody but the owner can run initializeV2` |
| P2 | Info | Manual pentest (uninitialised implementation) | Can anyone initialize the bare V1/V2 implementation contracts and become their owner? | No: both constructors call `_disableInitializers()`. | `the bare implementation is locked` · `P2: the V2 implementation is locked too` |
| P3 | Info | Manual pentest (DoS / locked funds) | Owner lowers the cap below existing balances and pauses: are users trapped? | No: the cap and the pause only apply to **deposits**; `withdraw` has neither. | `P3: lowering the cap below existing balances never traps money` |
| P4 | Info | Manual pentest (accounting) | ETH forced into the proxy (selfdestruct / coinbase) or sent without `deposit()`. | Books use `balanceOf`/`totalDeposits`, never `address(this).balance`, so forced ETH changes nothing; plain transfers revert (no `receive`). | `P4` · `P5` |
| I1 | Info | Slither `timestamp` | `join` / `addPointsBatch` "use timestamp for comparisons". | False positive: `joinedAt == 0` is a "not a member yet" flag, not a time comparison. Nothing depends on the time value. | — |
| I2 | Info | Slither `low-level-calls` (×3) | `.call{value: …}` in the two `withdraw`s. | Intended: `call` is the recommended way to send ETH (no 2,300-gas stipend issue); return value checked; state updated before the call; `PiggyBank.withdraw` is `nonReentrant`. | `blocks re-entrancy on withdraw` |
| I3 | Info | Slither `immutable-states` (×2), `costly-loop` | `ClubNaive.owner`/`joinFee` should be immutable; storage write inside the batch loop. | **That is the lesson.** `ClubOptimized` fixes exactly these, and the gas report measures it. | `every measured row is strictly lower for ClubOptimized` |
| I4 | Info | Slither `constable-states` | `PiggyBankV2Broken.totalDeposits` should be constant. | Test-only contract that demonstrates the storage collision; never deployed for real. | — |

### Known issues (accepted, with reasoning)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K1 | **The owner can upgrade to any code**, including code that sends all deposits to themselves. | This is the trust assumption of every upgradeable contract, not a bug in this one. In production the owner must be a multisig behind a `TimelockController`, so users see an upgrade days before it happens and can withdraw. Out of scope for a single-contract lesson; stated in the README key takeaways. |
| K2 | **The two clubs differ above 4,294,967,295 points**: the naive club keeps counting (uint256), the optimized one reverts with `PointsOverflow`. | Deliberate: that is the price of packing, made explicit and safe. The differential fuzz stays below the limit; the cap has its own test. |
| K3 | **`joinedAt == 0` means "not a member"**, so it relies on `block.timestamp > 0`. | True on every real chain since the genesis block (and on Hardhat). Saves a whole `bool` field in the packed slot. |
| K4 | **`ClubOptimized.owner` is immutable**: ownership can never be transferred, and the fees can only go where that owner says. | The point of the demo is the 2,100-gas read. A real product would use `Ownable2Step` (one storage slot) and accept the cost. |
| K5 | **`renounceOwnership()` freezes upgrades forever** (and leaves the pause switch where it is). | Inherited from OpenZeppelin; sometimes wanted ("make it immutable"). Withdrawals keep working in every state, so no funds can be trapped by it. |

## Tool results (final round)

| Tool | Result |
|---|---|
| `npm test` | **31 / 31 pass** (~4 s) |
| Differential fuzz (default `FUZZ_RUNS=40`) | 40 random programs of join / batch / withdraw by 6 users + owner, identical success/failure and identical points, totals, member counts and ETH on both clubs |
| OpenZeppelin upgrades validation | V1 deploy and V1 → V2 upgrade pass; broken V2 rejected (`balanceOf` moved) |
| ESLint + Solhint | 0 errors, 0 warnings (`ClubNaive` has the gas rules switched off on purpose) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither (102 detectors, 19 contracts) | 10 results, all explained above (I1–I4); **none open in the production contracts** |

### Final `npm test` output

```
  ClubNaive — behaviour
    ✔ joins with the exact fee; referrer earns 10 points (557ms)
    ✔ rejects wrong fee, double join, self-referral and unknown referrer (64ms)
    ✔ only the owner can add points or withdraw; batch needs members
    ✔ an empty batch changes nothing

  ClubOptimized — behaviour
    ✔ joins with the exact fee; referrer earns 10 points
    ✔ rejects wrong fee, double join, self-referral and unknown referrer
    ✔ only the owner can add points or withdraw; batch needs members
    ✔ an empty batch changes nothing

  ClubOptimized — custom errors and limits
    ✔ reverts with typed custom errors that carry data
    ✔ caps points at uint32 instead of silently wrapping (packing must not lose data)

  Differential fuzz — naive and optimized must behave identically
      (40 programs, 211 steps, identical results)
    ✔ 40 random programs of join / batch / withdraw give the same results (1805ms)

  Gas report — the optimized version is cheaper for every action
    ✔ every measured row is strictly lower for ClubOptimized (388ms)

  PiggyBank — UUPS upgradeable proxy
    V1
      ✔ deposits and withdraws through the proxy; money sits in the proxy (150ms)
      ✔ rejects zero amounts and over-withdrawals
      ✔ initialize can run only once (no takeover by re-initializing)
      ✔ the bare implementation is locked: nobody can initialize it
      ✔ blocks re-entrancy on withdraw
    upgrade V1 -> V2
      ✔ keeps the same address, balances and ETH; only the logic changes (71ms)
      ✔ new features: per-user cap and pause (withdrawals still allowed while paused)
      ✔ initializeV2 runs once and only for the owner
      ✔ a stranger cannot upgrade
      ✔ refuses to upgrade to a contract without UUPS (would brick the proxy)
      ✔ upgradeToAndCall must go through the proxy, not the implementation
    the classic mistake: reordered storage
      ✔ hardhat-upgrades refuses the broken V2 before it is deployed
      ✔ forced anyway, every balance reads from the wrong slot

  QA findings — Day 11
    ✔ L1: a mistyped new owner cannot take (or lose) upgrade control — ownership is two-step
    ✔ P1: after an upgrade WITHOUT the init call, nobody but the owner can run initializeV2 (no init front-running)
    ✔ P2: the V2 implementation is locked too
    ✔ P3: lowering the cap below existing balances never traps money
    ✔ P4: ETH forced into the box (no deposit) does not change anyone's books
    ✔ P5: plain ETH transfers without deposit() are refused (no silent loss)


  31 passing (3s)

```


---

## Evening audit

**Method:** independent second pass, as an outside auditor who did not write the code: re-ran everything from a clean compile, then attacked the two production contracts with boundary values (uint32 max, `type(uint256).max`), duplicates in batches, partial-failure batches, error precedence under a lowered cap, and a 200-program differential fuzz (3 runs, `FUZZ_RUNS=200`, about 1,250 steps each, identical results every time). Tools: ESLint, Solhint, `npm audit --omit=dev`, Slither (no new results in production code; the earlier I1–I4 still apply).
**Rounds:** 2 (round 1: 5 probe tests, 2 failed, both fixed · round 2: everything re-run, green).

| ID | Severity | How found | Description | Fix | Proving test |
|----|----------|-----------|-------------|-----|--------------|
| E1 | Low | Boundary attack (`amount = 2^256-1`) | `ClubOptimized.addPointsBatch` added `points + amount` in checked arithmetic, so a huge reward to a member who already had points failed with a raw `Panic(0x11)` instead of the typed `PointsOverflow(address)` error. Nothing was lost (it reverted), but callers and monitoring could not tell *which* member overflowed, and the error was inconsistent with the zero-points case. | Compare by subtraction: `room = uint32.max - points; if (amount > room) revert PointsOverflow(who)`. Costs about 10 gas per member (batch of 50: 408,594 → 419,580 gas). | `E1: a huge reward on a member who already has points gives the typed PointsOverflow error, not a raw Panic` |
| E5 | Low | Error-precedence probe (cap lowered below a balance) | `PiggyBankV2.deposit()` checked the cap before the zero amount, so after the owner lowered the cap a **0-value** deposit was reported as `CapExceeded` instead of `ZeroAmount`, which blames the wrong thing and confuses wallets that simulate the call. No funds at risk. | Check `msg.value == 0` first in `deposit()`. | `E5: a deposit of 0 while capped is rejected cleanly and the box stays consistent` |
| E2 | Info | Probe: same address twice in a batch | Does the optimized club double-count or drift `totalPoints`? | No: each entry is rewarded once per appearance; `totalPoints = len * amount` stays correct on both clubs. | `E2` |
| E3 | Info | Probe: uint32 boundary through `join()` | Is the cap exact, and does a failed referral leave half-written state? | Exact (max allowed, +1 refused) and a failed `join` changes nothing (`memberCount` unchanged). | `E3` |
| E4 | Info | Probe: bad address in the middle of a batch | Partial rewards? | The whole transaction reverts; nobody keeps points. | `E4` |

### Known issues (new)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K6 | `addPointsBatch` has no size limit, so a huge list could run out of gas. | Owner-only function and the owner chooses the list; a failed call reverts completely and can be retried in smaller batches. No user can trigger it. |

### Final green output (evening)

| Tool | Result |
|---|---|
| `npm test` | **39 / 39 pass** (31 morning + 5 evening-audit + 3 exercises) |
| 200-program differential fuzz ×3 | identical results on both clubs every time |
| ESLint + Solhint | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither | no new results in production code |

```
  ClubNaive — behaviour
    ✔ joins with the exact fee; referrer earns 10 points (472ms)
    ✔ rejects wrong fee, double join, self-referral and unknown referrer (68ms)
    ✔ only the owner can add points or withdraw; batch needs members
    ✔ an empty batch changes nothing

  ClubOptimized — behaviour
    ✔ joins with the exact fee; referrer earns 10 points
    ✔ rejects wrong fee, double join, self-referral and unknown referrer
    ✔ only the owner can add points or withdraw; batch needs members
    ✔ an empty batch changes nothing

  ClubOptimized — custom errors and limits
    ✔ reverts with typed custom errors that carry data
    ✔ caps points at uint32 instead of silently wrapping (packing must not lose data)

  Differential fuzz — naive and optimized must behave identically
      (40 programs, 200 steps, identical results)
    ✔ 40 random programs of join / batch / withdraw give the same results (2133ms)

  Gas report — the optimized version is cheaper for every action
    ✔ every measured row is strictly lower for ClubOptimized (397ms)

  PiggyBank — UUPS upgradeable proxy
    V1
      ✔ deposits and withdraws through the proxy; money sits in the proxy (145ms)
      ✔ rejects zero amounts and over-withdrawals
      ✔ initialize can run only once (no takeover by re-initializing)
      ✔ the bare implementation is locked: nobody can initialize it
      ✔ blocks re-entrancy on withdraw
    upgrade V1 -> V2
      ✔ keeps the same address, balances and ETH; only the logic changes (73ms)
      ✔ new features: per-user cap and pause (withdrawals still allowed while paused)
      ✔ initializeV2 runs once and only for the owner
      ✔ a stranger cannot upgrade
      ✔ refuses to upgrade to a contract without UUPS (would brick the proxy)
      ✔ upgradeToAndCall must go through the proxy, not the implementation
    the classic mistake: reordered storage
      ✔ hardhat-upgrades refuses the broken V2 before it is deployed
      ✔ forced anyway, every balance reads from the wrong slot

  QA findings — Day 11
    ✔ L1: a mistyped new owner cannot take (or lose) upgrade control — ownership is two-step
    ✔ P1: after an upgrade WITHOUT the init call, nobody but the owner can run initializeV2 (no init front-running) (41ms)
    ✔ P2: the V2 implementation is locked too
    ✔ P3: lowering the cap below existing balances never traps money (47ms)
    ✔ P4: ETH forced into the box (no deposit) does not change anyone's books
    ✔ P5: plain ETH transfers without deposit() are refused (no silent loss)

  Evening audit — Day 11
    ✔ E1: a huge reward on a member who already has points gives the typed PointsOverflow error, not a raw Panic
    ✔ E2: the same address twice in one batch is rewarded twice and totals stay consistent (both clubs)
    ✔ E3: the points cap is exact at the boundary (uint32 max is allowed, +1 is not) even through join()
    ✔ E4: a non-member in the middle of a batch reverts the whole batch (no partial rewards)
    ✔ E5: a deposit of 0 while capped is rejected cleanly and the box stays consistent (45ms)

  Exercises — Day 11
    ✔ ex1: naive member = 4 slots, packed member = 1 slot, order matters
    ✔ ex2: the model lands in the right range of the measured saving (69.7% for 50 members)
    ✔ ex3: V1 -> V2 safe, V1 -> reordered unsafe, and the real proxy agrees on where totalDeposits lives


  39 passing (4s)
```
