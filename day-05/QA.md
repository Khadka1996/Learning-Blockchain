# Day 05 — QA & security review

**Scope:** `src/evm.js` (mini-EVM interpreter + assembler + deployer), `src/storage.js` (slot helpers), `src/demo.js`, `contracts/Layout.sol`, test-only `contracts/test/ReentrantWithdrawer.sol`.
**Method:** tests first, then the tools (ESLint, Solhint, `npm audit --omit=dev`, `npx hardhat compile` + Slither), then a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md): bad inputs, edge cases, overflow, denial of service (memory, CPU, trace size), reentrancy, access control, replay, front-running.
The strongest check today is **differential testing**: [`test/evm.diff.test.js`](test/evm.diff.test.js) runs 150 random programs (twice each, so the second run starts from "dirty" storage) on my mini-EVM **and** on Hardhat's real EVM, and requires every opcode's gas, the final storage, the return data, the status and the total `gasUsed` to be identical.
**Rounds:** 3 (round 1: differential test, 1 finding · round 2: manual attack on the interpreter and the contract, 4 findings · round 3: everything re-run, clean).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| M1 | **Medium** | Manual | **Host memory DoS.** `gasLimit` had no upper bound. With a limit of 9 × 10¹⁵, memory expansion to ~4 GB looked "affordable" (≈ 3.5 × 10¹³ gas), so one `MSTORE` at offset `0xffffffe0` made Node try to allocate 4 GB. | `gasLimit` must be 21,000 … 30,000,000 (one block). At 30 M gas, quadratic memory pricing caps memory at ~4 MB. | `M1: a huge gas limit is refused…` |
| D1 | Low | Differential test | **Trace mismatch.** When code ran off its last byte, the real EVM records an implicit `STOP` step; mine recorded nothing. Gas was the same (0), but the traces differed. | Record the implicit `STOP` in the trace. | `D1: running off the end…`, property test |
| L1 | Low | Manual | **Trace size DoS.** A 30 M-gas loop is ~3 M steps; keeping every step as an object could use gigabytes. | Keep at most 100,000 steps; `traceTruncated: true` tells the caller. Gas accounting is unaffected. | `L1: a long loop keeps at most MAX_TRACE steps…` |
| L2 | Low | Manual | **Silent wrong state.** `storage` with Number keys (`0` instead of `0n`) was accepted and then never matched, so `SLOAD` read 0. | `execute` checks storage is a `Map<bigint, bigint>` with 256-bit values. | `L2: storage with Number keys…` |
| L3 | Low | Manual | `deployer()` accepted runtime code starting with `0xEF`, which every post-London chain refuses (EIP-3541), so the deploy would fail later with a vague error. | Refuse it up front with a clear `RangeError`. | `L3: deployer() refuses…` |
| I1 | Info | Differential test | **Hardhat tracer quirk.** For code whose *first* opcode is `STOP`, Hardhat's `debug_traceTransaction` returns no steps at all. | Not a bug in my code; the comparison accepts exactly this case (gas is 0 either way). | property test (`compare`) |

### Tool results

| Tool | Result |
|---|---|
| `npm test` | 45 / 45 pass (incl. 150-program differential property test: 10,134 opcode steps in 300 transactions compared) |
| ESLint + Solhint (`npm run lint`) | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither (102 detectors) | 6 informational, 0 high / medium / low — see below |

Slither's 6 results, each reviewed:
- `immutable-states` ×3 (`small`, `big`, `owner` could be `immutable`): **intentional**. An immutable is baked into the bytecode and does not live in storage, which would defeat the purpose of a storage-layout demo. (Day 11 will make exactly this change for gas.)
- `low-level-calls` in `withdraw`: `call{value:}` is the recommended way to send ETH (`transfer`'s 2,300-gas stipend breaks smart-contract wallets). The return value is checked and the balance is cut before the call.
- `reentrancy-benign` + `naming-convention` in `ReentrantWithdrawer`: test-only attacker contract.

### Also attacked and found safe (no change needed)

- **Reentrancy:** `withdraw` follows checks → effects → interaction. `ReentrantWithdrawer` re-enters from `receive()`; the second withdraw reverts and the pot keeps the other user's 1,000 wei (test `a re-entering contract cannot withdraw twice`).
- **Access control:** `push` and `setPaused` revert with `NotOwner(caller)` for anyone else. Pausing blocks deposits but **not** withdrawals, on purpose: users can always take their money out.
- **Overflow:** `balances + msg.value` is checked by Solidity ≥ 0.8. The interpreter wraps at 2²⁵⁶ exactly like the EVM (tests for `ADD`, `SUB`, `SDIV(-2²⁵⁵, -1)`).
- **Replay:** a raw transaction signed for chain id 1 is refused on chain 31337 (EIP-155); the same signed transaction sent twice is refused (nonce already used).
- **Bad jumps:** a `0x5b` byte inside PUSH data is not a valid jump target (unit test + differential test).
- **Front-running / `tx.origin`:** nothing in `Layout` depends on transaction order or uses `tx.origin`.
- **Forced ETH** (via `selfdestruct` from another contract) can make the contract's balance larger than the sum of `balances`. Harmless: no logic reads `address(this).balance`.

## Known issues (accepted)

| ID | Severity | Description | Why it is accepted |
|----|----------|-------------|--------------------|
| K1 | Info | The mini-EVM implements ~70 opcodes: no `CALL`, `CREATE`, `LOG`, calldata, environment or precompiles. | A teaching interpreter; unknown opcodes fail safely as `INVALID`. The differential test covers everything that is implemented. |
| K2 | Info | Intrinsic gas assumes empty calldata (exactly 21,000). | The interpreter has no calldata yet; real transactions add 4 gas per zero byte and 16 per non-zero byte (EIP-2028). |
| K3 | Info | `items` can grow without limit. | Only the owner can push, so only the owner could make it expensive for themselves. |

## Final run

```
$ npm test
  Ethereum accounts, nonces and gas fees            5 passing
  mini-EVM vs Hardhat's EVM (differential)          5 passing
      compared 10,134 opcode steps in 300 transactions
  mini-EVM: arithmetic / failures / gas rules      18 passing
  Layout.sol: storage layout + access/deposits     10 passing
  QA regressions                                    7 passing
  45 passing (5s)

$ npm run lint                → 0 problems
$ npm audit --omit=dev        → found 0 vulnerabilities
$ slither . --hardhat-ignore-compile
  INFO:Slither:. analyzed (3 contracts with 102 detectors), 6 result(s) found   (all informational, reviewed above)
```
