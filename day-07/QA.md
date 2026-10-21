# Day 07 — QA & security review

**Scope:** `contracts/MiniToken.sol`, `contracts/LearningToken.sol`, `contracts/TokenVault.sol`, `contracts/exercises/TokenPlus.sol`, `src/demo.js`, `qa/mutation.js`, and the test-only helpers in `contracts/test/` (several are deliberately broken). OpenZeppelin 5.0.2 itself is a dependency and was not audited here.
**Method:** tests first, then the tools (ESLint, Solhint, `npm audit`, Slither), a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md), then **mutation testing**: break the contracts on purpose, one small change at a time, and check that a test notices ([`qa/mutation.js`](qa/mutation.js)).
**Rounds:** 2 (round 1: first full pass, 3 mutants survived · round 2: tests added, everything re-run on the final code, clean).

Unlike Day 06 there was no earlier version to review: I wrote the code and the tests in the morning and attacked both in the evening. So the findings below are things I had **designed for but not proven**.

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| T1 | Low | Mutation testing | **`NothingReceived` was never exercised.** `TokenVault` refuses a deposit that delivers 0 tokens (a token can report success and move nothing), but no test used such a token. Removing the check changed no test result. | New `GhostToken` helper (returns `true`, moves nothing) plus a naive-vault control that gives free credit for it. | `a token that returns true but moves NOTHING is refused` |
| T2 | Low | Mutation testing | **The reentrancy guards on `deposit` and `depositWithPermit` were never exercised.** The attacker only re-entered `withdraw`, so removing either guard changed no test result. Cross-function reentrancy (re-entering a *different* function while `withdraw` runs) was untested. | `HookAttacker` gained modes that re-enter `deposit` and `depositWithPermit` from the token callback; each must be refused with the guard's own error. | `CROSS-FUNCTION reentrancy: the hook cannot call deposit()` / `nor depositWithPermit()` |
| I1 | Info | Review | A deposit into an address that is not a token at all (an ordinary account) had no test. It reverts, as it should. | Test added. | `depositing 'a token' that is just a normal account (no code) reverts` |

**Not findings but worth recording:** while writing the demo, `depositWithPermit` seemed to "fail" when a relayer submitted Ram's signature. The contract was right: it deliberately treats `msg.sender` as the token owner. The demo story was wrong, not the vault (a relayer path would need a separate `depositFor`). And my first `HookToken` helper reverted when sending to the vault because it demanded a hook every receiver lacked; real ERC-777 hooks are optional, so the helper was corrected.

### Mutation testing

| Pass | Result |
|---|---|
| First pass, 34 mutants | MiniToken **17 / 17** killed · TokenVault **14 / 17** killed, 3 survivors (T1, T2 ×2) |
| After the new tests, the 3 survivors re-run | **3 / 3** killed |
| **Final** | **34 / 34** broken versions caught |

The 34 mutants include: constructor does not mint, receiver never credited, sender never debited, `<` becomes `<=` in both the balance and allowance checks, `transferFrom` skips the allowance, unlimited allowances get reduced, spending an allowance emits `Approval`, decimals 6, vault credits the requested amount instead of what arrived, plain `transfer`/`transferFrom` instead of `SafeERC20`, effects after the external call (guard kept), permit failure not tolerated, every guard removed, and `solvencyCheck` using `>`.

### Tool results

| Tool | Result |
|---|---|
| `npm test` | **167 / 167 pass**, including 150 random programs against OpenZeppelin and 200 against a JavaScript model |
| Mutation testing | **34 / 34** caught |
| ESLint + Solhint | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (full) | advisories in Hardhat 2's *dev* toolchain (`@fastify/busboy`, `adm-zip`); the fix is a breaking jump to Hardhat 3. Accepted: dev-only, local chain, no untrusted input |
| Slither (102 detectors) | 18 results in our code, **3 in production contracts, none a real issue**; 15 in the deliberately bad test helpers |

Slither, production contracts (all three are in `TokenVault._deposit`):
- `reentrancy-balance` (High) and `reentrancy-benign` (Low): **accepted.** `_deposit` must read the balance before and after `transferFrom` (that is how it learns what *arrived*) and write state afterwards, so "effects before interaction" is impossible there. Protection: `deposit` and `depositWithPermit` are `nonReentrant`, tested in T2, and tokens are accounted separately so a hostile token can only hurt its own book.
- `incorrect-equality` (Medium): **accepted.** `received == 0` is the intended `NothingReceived` check, not a balance-equality trap (T1).

Slither, test helpers: `unchecked-transfer`, `reentrancy`, `unused-return`, `erc20-interface`, `immutable-states` in `NaiveTokenVault`, `NoReturnToken`, `HookAttacker`: **intentional.** They exist to be bad.

### Also attacked and found safe (no change needed)

- **Fee-on-transfer tokens:** `TokenVault` credits the measured difference and stays solvent; the control vault ends up owing 2000 while holding 1980.
- **USDT-style (no return value) and returns-`false` tokens:** handled by `SafeERC20`; the control vault cannot deposit the first and gives free credit for the second.
- **Permit front-running:** an observer using the signature first no longer blocks the deposit (`try/catch`), and a garbage signature gives no allowance (the `transferFrom` then fails with the normal allowance error). A token with no `permit` function cannot create a *phantom* allowance, because the vault never assumes `permit` worked.
- **Reentrancy and read-only reentrancy:** during a token callback the vault's balance and total are already final.
- **Replay and cross-token signatures:** a used nonce, a changed field, a different signer, an expired deadline and a signature for another token are all refused.
- **Overflow and supply:** Solidity ≥ 0.8 checks arithmetic; the sum of all balances equals `totalSupply` after every random step; the cap holds at exactly `cap` and `cap + 1`.
- **Hand-written vs OpenZeppelin:** identical success/failure, error names and arguments, events, balances and allowances over 150 random programs.

## Known issues (accepted)

| ID | Severity | Description | Why it is accepted |
|----|----------|-------------|--------------------|
| K1 | Info | **The approve race exists in `MiniToken` and `LearningToken`.** Lowering an allowance can leak the old amount. | Inherent to ERC-20. Demonstrated in `test/allowance.test.js`; mitigations are `increase`/`decreaseAllowance`, `approveIfCurrent` (exercise 5) or `permit`. |
| K2 | Info | An unlimited approval exposes all present and future balance to that spender. | A deliberate, documented convention (saves gas). Users choose it. |
| K3 | Info | `TokenVault` does not support **rebasing** tokens (balances that change on their own). | A negative rebase would make the vault insolvent; `solvencyCheck` reveals it. Documented in the contract. |
| K4 | Info | Tokens sent to the vault by a plain `transfer` (not `deposit`) are stuck. | Nothing credits them; harmless for solvency (`>=`). |
| K5 | Info | The owner of `LearningToken` can mint up to the cap. | By design; the cap is the promise. A real token would add a timelock or multisig (later days). |
| K6 | Info | Not independently audited. | Learning code. **Do not deploy with real funds.** |

## Final run

```
$ npm test
  ERC-20 behaviour: MiniToken (hand-written)                       31 passing
  ERC-20 behaviour: OZReference (plain OpenZeppelin ERC20)         31 passing
  ERC-20 behaviour: LearningToken (OpenZeppelin + cap + permit)    31 passing
  LearningToken: cap, mint, burnFrom, permit                       18 passing
  TokenVault: allowances, weird tokens, permit, reentrancy         27 passing
  Allowances: the approve race and the unlimited approval           5 passing
  Differential: MiniToken vs OpenZeppelin (150 programs)            1 passing
  LearningToken: random operations vs a model (200 programs)       1 passing
  MiniToken: storage layout (raw eth_getStorageAt)                  6 passing
  Gas                                                               5 passing
  Exercises: solutions                                             11 passing
  167 passing

$ npm run lint              → 0 problems
$ npm audit --omit=dev      → found 0 vulnerabilities
$ npm run qa:mutation       → 34 of 34 mutants killed
$ slither . --hardhat-ignore-compile --filter-paths "node_modules|contracts/test"
                            → 3 results, all explained above
```
