# Day 06 — QA & security review

**Scope:** `contracts/LearningVault.sol`, `contracts/StudyLog.sol`, `contracts/interfaces/IVault.sol`, `contracts/exercises/VaultPlus.sol`, `src/demo.js`, `qa/mutation.js`, and the test-only helpers in `contracts/test/` (one of them deliberately broken).
**Method:** tests first, then the tools (ESLint, Solhint, `npm audit`, Slither), then a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md), then **mutation testing**: break the contract on purpose, one small change at a time, and check that a test notices ([`qa/mutation.js`](qa/mutation.js)).
**Rounds:** 3 (round 1: review of the morning's code, 5 findings · round 2: Slither on the new code, 1 more finding · round 3: everything re-run on the final code, clean).

The morning version (19 tests, all green) was reviewed as if written by someone else. Run against 15 broken versions of the original contract, those 19 tests **let 5 through**: constructor event removed, failed payout ignored, reentrancy guard removed, `solvencyCheck` using `==`, and ETH sent *before* the balance update. A green suite is not the same as a watching suite.

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| M1 | **Medium** | Manual review | **Pause froze withdrawals.** `setPaused(true)` blocked `withdraw` too. The owner is `immutable`, so a lost or malicious owner key while paused locked every user's ETH forever. Day 05's contract deliberately keeps exits open. | `withdraw` no longer has `whenNotPaused`; pause stops deposits only. | `M1: users can still withdraw while the vault is paused` |
| L1 | Low | Manual attack (experiment) | **Unreplayable event log.** `Withdrawn` was emitted *after* the external call. A recipient that re-deposits from `receive()` made the log read `Deposited(100) → Deposited(50, newBalance 50) → Withdrawn(100, 50)`; replaying it gives a history that never happened. | Emit `Withdrawn` with the other effects, *before* the call: `Deposited → Withdrawn(…, 0) → Deposited`. | `L1: events are emitted in an order an indexer can replay` |
| L2 | Low | Gas measurement | **Guard reset to 0 every call.** `_entered` went 0 → 1 → 0, paying a fresh storage write each time: `withdraw` cost **52,031** gas. | Guard flips 1 ↔ 2 (never 0): **42,859** gas (−17.6 %). | `L2: withdraw no longer pays a fresh … guard write` |
| L3 | Low | Mutation testing | **Tests that could not fail.** The constructor test `expect(promise).not.to.equal(null)` is true for any value, so deleting the event passed. No test covered the reentrancy guard, `TransferFailed`, forced ETH or effects-before-interaction. | Real assertions; attacker + rejecting-receiver + `selfdestruct` helpers; a deliberately broken `VulnerableVault` as a control. Suite now kills **16 / 16** mutants. | `L3: the constructor event really is emitted` · `qa/mutation.js` |
| I1 | Info | Review | Dead `ZeroAddress` error; `solvencyCheck` comment said "should equal" but the code is `>=`. | Error removed, comment corrected. | `I1` ×2 |
| I2 | Info | Slither | My new `VaultPlus` hand-rolled a lock and reset it after the external call (`reentrancy-eth`). Safe in practice (the lock is held during the call) but a code smell. Found before shipping. | Same `nonReentrant` modifier as the vault; plus an attacker test against it. | `refuses re-entry: the same attacker …` |

**Repo and documentation fixes (not contract bugs):** the evening card said "AUDITED", showed a re-entrancy "before" that never existed and claimed "100 % covered" (now real numbers, badge "QA DONE", 15-segment progress bar); `notes.pdf` was one letter-size page (now the 6-page A4 study guide like Days 1–4); added `src/demo.js`, ESLint, the `start` / `lint` / `slither` / `qa:mutation` / `ex:*` scripts, exercise solutions and this findings table.

### Tool results

| Tool | Result |
|---|---|
| `npm test` | **75 / 75 pass** (incl. a 200-program random test against a JavaScript model) |
| Mutation testing (`npm run qa:mutation`) | **16 / 16** broken versions caught (original suite: 10 / 15) |
| ESLint + Solhint (`npm run lint`) | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities (no runtime dependencies) |
| `npm audit` (full) | advisories in Hardhat 2's *dev* toolchain (a multipart parser in `undici`, `adm-zip`); the fix is a breaking jump to Hardhat 3. Accepted: dev-only, local chain, no untrusted input |
| Slither (102 detectors) | 8 results; **none is a real issue** (2 intentional test contracts, 3 false positives, 3 informational), see below |

Slither's 8 results, each reviewed:
- `reentrancy-eth` (High) in **`VulnerableVault`** and `reentrancy-benign` in `ReentrantAttacker`: **intentional**, test-only contracts.
- `incorrect-equality` (Medium) in `StudyLog.countByStatus`: **false positive**. It compares two enum values, not ETH balances.
- `timestamp` ×2 (Low) in `StudyLog`: **false positive**. No logic depends on `block.timestamp`; the flagged lines compare ids and loop counters.
- `low-level-calls` ×3: `call{value:}` is the recommended way to send ETH (`transfer`'s 2,300-gas limit breaks smart-contract wallets). The result is checked and state is updated first.

### Also attacked and found safe (no change needed)

- **Reentrancy:** two independent layers. With the guard removed, effects-before-interaction still stops the drain; with the order broken, the guard still stops it. Each is covered by its own mutant.
- **Cross-function re-entry:** a recipient may call `deposit` during `withdraw`; accounting stays exact (`a receiver that re-deposits … keeps exact accounting`).
- **Failed payout:** a contract with no `receive()` makes the whole withdrawal revert and the state change is rolled back.
- **Forced ETH** (`selfdestruct`): balance can exceed `totalDeposits`; harmless because `solvencyCheck` uses `>=` and nothing credits the extra.
- **Plain ETH sends / unknown selectors:** refused (no `receive` / `fallback`).
- **Access control:** `setPaused` only for the owner (both directions); the owner is immutable, so ownership cannot be hijacked.
- **Overflow:** Solidity ≥ 0.8 checks arithmetic; fuzz test covers random sequences.
- **Enum out of range:** value 3 for `Status` is refused by the ABI decoder before any contract code runs (with a control call using value 2).
- **Front-running / `tx.origin`:** nothing depends on transaction order or uses `tx.origin`.

## Known issues (accepted)

| ID | Severity | Description | Why it is accepted |
|----|----------|-------------|--------------------|
| K1 | Info | The owner can still stop new deposits indefinitely. | By design: that harms nobody's existing funds. Real systems add a timelock or multisig (later days). |
| K2 | Info | A pause cannot stop an exploit that goes through `withdraw`. | The price of keeping exits open (finding M1). |
| K3 | Info | `StudyLog.countByStatus` loops over the whole array. | It is `view` and the learner is the only one who can grow the list. A state-changing function must never do this. |
| K4 | Info | Stray ETH from `selfdestruct` is stuck in the vault. | No function can credit it; documented by test. |
| K5 | Info | Not independently audited. | Learning code. **Do not deploy with real funds.** |

## Final run

```
$ npm test
  LearningVault: deposits, withdrawals, pause, access   27 passing
  LearningVault: attacks                                  8 passing
  LearningVault: storage layout (raw eth_getStorageAt)    4 passing
  QA regressions                                          6 passing
  random operations vs a JavaScript model (200 runs)      1 passing
  gas                                                     3 passing
  StudyLog                                               14 passing
  Exercises: solutions                                   12 passing
  75 passing

$ npm run lint              → 0 problems
$ npm audit --omit=dev      → found 0 vulnerabilities
$ npm run qa:mutation       → 16 of 16 mutants killed
$ slither . --hardhat-ignore-compile → 9 contracts, 102 detectors, 8 results (all reviewed above)
```
