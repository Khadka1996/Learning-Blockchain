# Day 09 — QA & security review

**Scope:** the five fixed contracts in `contracts/fixed/` (the production code of the day), `src/demo.js`, `test/helpers.js`. The contracts in `contracts/vulnerable/` and `contracts/attackers/` are **broken or hostile on purpose**: they were checked only to confirm each one fails in exactly the intended way. OpenZeppelin 5.0.2 is a dependency and was not audited.
**Method:** exploit tests first (every attack must succeed on the broken contract and fail on the fixed one), fuzz invariants with fast-check, the tools (ESLint, Solhint, `npm audit`, Slither 102 detectors), then a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md).
**Rounds:** 3 (round 1: tools · round 2: manual attacker review · round 3: everything re-run on the final code, clean).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| M1 | **Medium** | Manual review (access control) | **`SafeWallet` inherited `renounceOwnership()` from OpenZeppelin `Ownable`.** One call by the owner (a mistaken click, a compromised UI) would leave the wallet with no owner, and every ETH inside would be locked forever, since `withdrawAll` is owner-only. | `renounceOwnership()` overridden to revert with `RenounceDisabled`. | `M1: SafeWallet owner cannot renounce ownership and lock the ETH forever` |
| S1 | Low | Slither `erc20-interface` (Medium) | `SafeBank` and the two wallets had a function called `transfer(address,uint256)` that returns nothing. That is the ERC-20 selector (`0xa9059cbb`): wallets, explorers and integrations that see it may treat the contract as a token, and an ERC-20 caller expecting a `bool` would misread the result. | Renamed to `transferBalance` (SafeBank) and `pay` (wallets). | `S1: no fixed contract exposes an ERC-20-looking transfer(address,uint256)` |
| T1 | Low | Manual review of my own tests | **The cross-function re-entrancy test passed for the wrong reason.** In `SafeBank` the balance is already zero (CEI) when the attacker re-enters `transferBalance`, so the call would fail with `InsufficientBalance` even if the lock were removed. The test only checked "it failed", so it did not prove the lock works. | `CrossFunctionAttacker` now records the 4-byte error it got back; the test asserts it is `ReentrancyGuardReentrantCall`. | `FIX: the lock also blocks CROSS-function re-entry (withdraw → transfer)` |
| L1 | Info | Solhint | 4 warnings in test-only attackers (`no-complex-fallback`, `reentrancy`, `one-contract-per-file`). | Helpers split into one contract per file; the attack callbacks keep their (intentional) complexity, with the reason written next to a one-line disable. | `npm run lint` → 0 warnings |
| I1 | Info | Manual review (accounting) | Can ETH forced in with `selfdestruct` (which the receiver cannot refuse) break the books? | No change needed: `SafeBank` and `SafeKingOfTheHill` never use `address(this).balance` for accounting, only their own records. The fuzz invariant is "held == owed" only because nothing is force-fed there; in general it is "held ≥ owed". | `I1: ETH forced in with selfdestruct does not confuse SafeBank or SafeKingOfTheHill accounting` |

### Known issues (accepted, with reasoning)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K1 | **Low-entropy answers can be guessed offline.** `answerHash` is public, so if the answer is a dictionary word (like `"satoshi"`) anyone can hash a word list and find it without watching the mempool. | This is a property of *any* "hash puzzle", not of the front-running fix. Commit–reveal stops *copying*; it cannot make a weak secret strong. Real uses need a high-entropy secret. Documented in the README. |
| K2 | **Censorship.** A block producer can refuse to include Alice's reveal. | Commit–reveal protects against *copying*, not against a producer ignoring you. Out of scope for one contract (rollups, inclusion lists and private relays address it). |
| K3 | `SafeKingOfTheHill`: the current king's own bid stays locked until someone outbids them. | That is the game's rule, not a bug: the bid *is* the prize. |

## Tool results (final round)

| Tool | Result |
|---|---|
| `npm test` | **26 / 26 pass** (4 s) |
| `FUZZ_RUNS=200 npm test` | **26 / 26 pass**: 200 random programs, **1,257 steps**, the SafeBank invariant held after every step |
| ESLint + Solhint | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither (102 detectors, 25 contracts) | 30 results, all explained below; **none open in `contracts/fixed/`** |
| `npm start` and `npm run demo:localhost` | same output on the in-process chain and on a separate `hardhat node` |

Slither on the **fixed** contracts (after S1):
- `low-level-calls` (all five): sending ETH needs `call`; every result is checked and a failure reverts. **Accepted.**
- `incorrect-equality` (`c.hash == bytes32(0)` in `CommitRevealPuzzle`): the detector targets equality on *balances* or *timestamps*; this compares a stored hash to "empty". **False positive.**
- `missing-inheritance` (should inherit the attackers' small interfaces): those interfaces are test-only. **Accepted.**
- `pragma` / `solc-version` (OpenZeppelin `^0.8.20` vs our pinned `0.8.24`): everything compiles with 0.8.24, which is not affected by the listed bugs. **Accepted.**

Slither on the **deliberately broken** contracts, a useful lesson in itself:

| Planted bug | Slither's warning |
|---|---|
| Re-entrancy (`VulnerableBank`) | `reentrancy-eth` (High) ✅ |
| `tx.origin` (`TxOriginWallet`) | `tx-origin` (Medium) ✅, plus `arbitrary-send-eth` |
| Open `initialize()` (`VulnerableWallet`) | only `missing-zero-check` (Low) ❌ |
| Front-running (`HashPuzzle`) | only `arbitrary-send-eth` (it "pays whoever calls") ❌ (not the ordering problem) |
| Refund DoS (`KingOfTheHill`) | nothing beyond `low-level-calls` ❌ |

**2 of 5 caught directly.** The other three were only proven by the exploit tests.

### Final green output

```
  1. Re-entrancy
    ✔ EXPLOIT: a 1 ETH deposit drains all 11 ETH from VulnerableBank
    ✔ FIX: SafeBank refuses the re-entry; the thief only gets its own 1 ETH back
    ✔ FIX: the lock also blocks CROSS-function re-entry (withdraw → transfer)
    ✔ normal use still works: deposit, withdraw, transfer, events and errors
    ✔ a receiver that refuses ETH cannot lose its balance (withdraw reverts, balance kept)
  2. Access control
    ✔ EXPLOIT: anyone can call initialize() again, become owner and empty the wallet
    ✔ FIX: SafeWallet has no initialize(); strangers get OwnableUnauthorizedAccount
    ✔ FIX: ownership moves in two steps, so a wrong address cannot take over or lock it
    ✔ FIX: rejects the zero address as owner and as withdraw target
  3. tx.origin phishing
    ✔ EXPLOIT: the owner clicks a fake 'claim airdrop' and the wallet sends everything to the attacker
    ✔ the attacker cannot call TxOriginWallet directly (it only works through the victim)
    ✔ FIX: MsgSenderWallet sees the trap contract as the caller and refuses
  4. Front-running
    ✔ EXPLOIT: a bot copies Alice's pending answer with a higher tip and takes the prize
    ✔ FIX: copying Alice's reveal is useless; Alice wins with commit–reveal
    ✔ the commitment reveals nothing and is bound to one address
    ✔ FIX edge cases: empty, missing, same-block, wrong salt, wrong answer, already solved
    ✔ HashPuzzle: wrong answer and second solve revert
  5. Denial of service (push payments)
    ✔ works while everyone can receive ETH: the old king is refunded
    ✔ EXPLOIT: a king that refuses refunds freezes the game forever
    ✔ FIX: with pull payments the game goes on; the stubborn king only hurts itself
    ✔ FIX: an equal bid is still too low, and the same person can raise their own bid
  6. Invariants (fuzz)
      (200 random programs, 1257 steps, invariant held after every step)
    ✔ SafeBank: ETH held == sum of balances; withdraw pays exactly the balance
    ✔ SafeKingOfTheHill: ETH held == prize + all pending refunds, king always the highest bid
  7. QA findings (regression tests)
    ✔ S1: no fixed contract exposes an ERC-20-looking transfer(address,uint256)
    ✔ M1: SafeWallet owner cannot renounce ownership and lock the ETH forever
    ✔ I1: ETH forced in with selfdestruct does not confuse SafeBank or SafeKingOfTheHill accounting

  26 passing (15s)
```
