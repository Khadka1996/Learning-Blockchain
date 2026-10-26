# Day 12 — QA & security review

**Scope:** `contracts/oracle/SafePriceReader.sol`, `contracts/bridge/L1Lockbox.sol`, `contracts/bridge/SafeBridge.sol`, `contracts/bridge/WrappedToken.sol`, `src/rollup.js`, `src/deploy.js`. `NaivePriceReader` and `NaiveBridge` are broken **on purpose** (they are the "before" pictures) and were checked only to confirm their bugs are real. `MockV3Aggregator`, `TestToken` and `FeeToken` are test fixtures. OpenZeppelin 5.0.2 is a dependency and was not audited.
**Method:** tests first (unit + attack + 3 fuzz properties), then the tools (ESLint, Solhint, `npm audit`, Slither 102 detectors), then a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md), adding a test for every idea.
**Rounds:** 3 (round 1: 40 tests + tools · round 2: manual attacker review, 3 fixes + 7 probe tests · round 3: everything re-run on the final code, clean).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| L1 | Low | Manual review (integer edge cases) | **The rollup simulation could silently lose precision.** Balances are JS numbers; a genesis with a balance near 2^53 let a transfer produce a non-exact number, and `stateRoot` throws above 2^64, which would make a fraud proof **impossible to compute** (a watcher could never challenge). | `RollupL1` refuses a genesis unless every balance and the total are non-negative safe integers (supply is conserved, so no balance can grow past it); `applyTx` also treats a transfer whose result would be inexact as a no-op. | `L1: rollup refuses a genesis whose balances cannot be represented exactly; transfers never lose precision` |
| L2 | Low | Manual review (input validation) | **`SafePriceReader(feed = 0x0)` failed with an empty revert.** The constructor called `feed.decimals()` before its zero-address check, so the clear `BadConfig` never fired. | Zero-address and range checks run first; `decimals()` is read after. | `L2: SafePriceReader with feed = address(0) fails with a clear BadConfig, not an empty revert` |
| L3 | Low | Slither `missing-zero-check` | **`WrappedToken` could be deployed with `bridge = 0x0`**: a token nobody can ever mint, and the deployment would look fine. | Constructor reverts with `NotBridge` on the zero address. | `L3: a WrappedToken wired to address(0) (unmintable forever) cannot be deployed` |
| P1 | Info | Manual pentest (weird tokens) | Fee-on-transfer token locked in the lockbox: does L2 mint 100 for a deposit that delivered 99? | No: the lockbox emits what **arrived** (balance before/after). | `P1: fee-on-transfer token — the lockbox records what ARRIVED (99)…` |
| P2 | Info | Manual pentest (front-running) | An MEV bot copies a pending `mint` and sends it first. | Harmless: the recipient is inside the signed message, so the bot just pays Alice's gas. | `P2: front-running a relay is harmless…` |
| P3 | Info | Manual pentest (replay) | Reuse deposit #0's signatures for deposit #1 with the same recipient and amount. | Refused: the deposit id is in the digest. | `P3: a signature for deposit #0 cannot be reused for deposit #1…` |
| P4 | Info | Manual pentest (incentives) | Can a cheating sequencer "challenge itself" and keep its bond? | No: only half the bond goes to the challenger, the rest is burned. | `P4: a sequencer that challenges its OWN fraud still loses half its bond` |
| P5 | Info | Manual pentest (signatures) | Duplicate signer, outsider signer, high-s malleable signature, cross-bridge replay, tampered amount/recipient. | All refused. | 02-bridge `attacks on SafeBridge — all must fail` (8 tests) |
| I1 | Info | Slither `uninitialized-local` | `last` in `SafeBridge.mint` "never initialized". | Default 0 was intended (any real signer is > 0); now explicit `address last = address(0)` for readers. | `one validator signing twice does not meet a 2-of-3 threshold` |
| I2 | Info | Slither `reentrancy-balance`, `reentrancy-benign`, `incorrect-equality` | `L1Lockbox.deposit` reads the balance, calls the token, then compares. | Intended: that **is** the fee-on-transfer measurement; the function is `nonReentrant`, and `received == 0` is a safety check, not a balance assumption. | `P1` |
| I3 | Info | Slither `unused-return` (×3) | `latestRoundData()` values ignored. | Intended: `roundId`/`answeredInRound` are deprecated for staleness by Chainlink; we check `updatedAt` instead. | 01-oracle tests |
| I4 | Info | Slither `timestamp` (×2) | Comparisons with `block.timestamp`. | Intended: staleness **is** a time comparison; validators can shift time by seconds, heartbeats are an hour. | `heartbeat boundary…` |
| I5 | Info | Slither `missing-inheritance` | `WrappedToken` "should inherit" `IMintable`. | Cosmetic: the interfaces are declared next to their bridges on purpose. | — |

### Known issues (accepted, with reasoning)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K1 | **If `threshold` validator keys are stolen, the attacker can mint unbacked tokens** (the Ronin scenario). | That is the trust model of every multisig bridge, not a code bug. Mitigations live outside the contract: independent operators, hardware keys, rate limits, a pause guardian, and light-client or ZK bridges that don't rely on signers at all. |
| K2 | **The validator set is fixed** (no rotation, no pause). | Keeps today's contract small. A production bridge needs rotation through governance with a timelock, plus an emergency pause. |
| K3 | **One-way only:** the lockbox has no release path for burned wrapped tokens. | Today's lesson is the minting side, where the big hacks happened. Burn-and-release is the same pattern in reverse (good evening exercise). |
| K4 | **Validators must wait for finality on chain A before signing.** A reorg could erase a deposit after its mint. | An off-chain rule for the validator software; nothing the destination contract can see. |
| K5 | **The rollup simulation trusts the sequencer to answer bisection questions.** A real protocol gives each side a deadline per move, and a side that doesn't answer loses. Challenges also cost nothing here (a real challenger posts a bond too). | Simulation scope, stated in the README. The core properties (fraud always found, honest batches never reverted) are fuzz-tested. |
| K6 | **SafePriceReader pauses the app whenever the feed is broken** (fail closed). | Deliberate. A fallback feed or a governed circuit breaker is the production answer; picking a wrong price is worse. |

## Tool results (final round)

| Tool | Result |
|---|---|
| `npm test` | **47 / 47 pass** (~7 s) |
| Fuzz (fast-check, default runs) | 60 random (answer, age) pairs: price returned **only** when every check passes · 15 random deposit/relay sequences: wrapped supply ≤ locked after **every** step, equal at the end · 100 random batches (1–300 txs, any lie position): bisection always finds the exact tx in ≤ ⌈log₂ n⌉ rounds |
| ESLint + Solhint | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither (102 detectors, 28 contracts) | 9 results, all informational and explained above (I2–I5); **0 high / medium** |

### Final `npm test` output

```
  Oracles — SafePriceReader vs NaivePriceReader
    ✔ fresh price: both agree, scaled from 8 to 18 decimals
    ✔ stale price: naive keeps using it, safe refuses after the heartbeat
    ✔ heartbeat boundary: age == heartbeat is accepted, heartbeat + 1 is not
    ✔ zero and negative answers are refused; naive returns 0 or crashes
    ✔ missing or future timestamp is refused
    ✔ circuit breaker: answers outside [min, max] are refused
    ✔ L2 sequencer down → refused; back up → refused during the grace period, then accepted
    ✔ a sequencer status that starts in the future or at 0 is refused
    ✔ on L1 (no sequencer feed) the sequencer check is skipped
    ✔ rejects bad configuration
    ✔ handles feeds with other decimals (18 and 0)
    ✔ only the reporter can update the mock feed
    ✔ fuzz: safe returns a price ONLY when every check passes, and then it equals answer × 1e10 (333ms)

  Bridge — SafeBridge vs NaiveBridge (lock on L1, mint on L2)
    ✔ fuzz invariant: wrapped supply on L2 never exceeds tokens locked on L1, whatever the order of mints/replays (1415ms)
    happy path
      ✔ lock 100 → 2 of 3 validators sign → 100 wrapped minted; anyone may relay
      ✔ 3 of 3 also works
    attacks on SafeBridge — all must fail
      ✔ replay: the same deposit cannot be minted twice
      ✔ one validator signing twice does not meet a 2-of-3 threshold
      ✔ too few signatures / a non-validator signature are rejected
      ✔ tampering: changing the recipient or amount breaks every signature
      ✔ cross-bridge replay: signatures for bridge A are useless on bridge B (address bound in the digest) (57ms)
      ✔ wrong source chain, zero amount and zero recipient are rejected
      ✔ high-s (malleable) signatures are rejected by OpenZeppelin ECDSA
      ✔ only the bridge can mint wrapped tokens; the token can be wired once, by the deployer
      ✔ rejects unsafe validator sets: threshold 0, > N, minority, duplicates, zero address
    NaiveBridge — the bugs are real
      ✔ the same two signatures mint again and again (no deposit id)
      ✔ one validator signing twice passes a 2-of-3 check
    lockbox
      ✔ rejects zero amount / zero recipient and counts deposit ids

  Rollup (simulated) — batching, fraud proofs, challenge window
    state transition
      ✔ moves coins; total supply is conserved
      ✔ overspend, self-transfer, bad index, zero/negative/fractional amount are NO-OPs (never throw)
      ✔ the state root changes when any balance changes, and is deterministic
    cost model
      ✔ calldata gas = 4 per zero byte + 16 per non-zero byte (EIP-2028)
      ✔ one tx alone is MORE expensive than an L1 transfer; 100+ txs per batch are >10x cheaper
    optimistic fraud proofs
      ✔ an honest batch cannot be challenged and becomes final after 7 days (not before)
      ✔ a lie at tx #637 of 1,000 is found in 10 rounds; batch reverted, bond slashed, watcher paid (399ms)
      ✔ no challenges after the window closes; no batches without a bond
      ✔ an EMPTY batch that claims a different state is fraud
      ✔ a batch built on top of a fraudulent one is reverted too; the next batch builds on the last good root
      ✔ a challenger with a fake pre-state is rejected
      ✔ fuzz: for ANY batch and ANY lie position, bisection finds exactly that transaction in ⌈log2 n⌉ rounds (2328ms)

  QA findings (see QA.md)
    ✔ L1: rollup refuses a genesis whose balances cannot be represented exactly; transfers never lose precision
    ✔ L2: SafePriceReader with feed = address(0) fails with a clear BadConfig, not an empty revert
    ✔ L3: a WrappedToken wired to address(0) (unmintable forever) cannot be deployed
    ✔ P1: fee-on-transfer token — the lockbox records what ARRIVED (99), so L2 can never mint more than is locked
    ✔ P2: front-running a relay is harmless — the tokens still go to the recipient in the signed message (66ms)
    ✔ P3: a signature for deposit #0 cannot be reused for deposit #1 with the same recipient and amount (66ms)
    ✔ P4: a sequencer that challenges its OWN fraud still loses half its bond (no free exit)


  47 passing (7s)
```
