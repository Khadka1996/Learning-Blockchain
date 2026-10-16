# Day 02 — QA & security review

**Scope:** `src/` (block encoding, mining, chain validation, three CLI scripts). Plain Node.js, no Solidity today, so Slither / Solhint do not apply.
**Method:** the first draft (v1) followed the usual tutorial pattern: hash = `SHA-256(index + prevHash + timestamp + JSON.stringify(data) + nonce + difficulty)`, and `isValid()` only checks *hash = recomputed hash* and *prevHash = parent's hash*. I attacked v1 with a script before writing the final version: forging, downgrading difficulty, ambiguous encodings, a fake genesis, nonsense indexes and times, and huge difficulties. Then I wrote one test per finding, fixed, and re-ran with the checklist in [`tools/README.md`](../tools/README.md).
**Rounds:** 2 (round 1: v1 attack script, 8 findings; round 2: final code re-attacked, clean).

### v1 attack output (before fixes)

```
A1 forged w/o PoW valid? true false      ← edited block, hash recomputed, NOT mined: accepted
A2 difficulty-1 chain valid? true        ← whole history re-mined at difficulty 1: accepted
A3 collision true                        ← two different headers, one hash
A3b nonce/difficulty collision true
A4 foreign genesis valid? true
A5 bad index/time valid? true            ← index 99 after 1, timestamp −10^15
A6 genesis edited valid? true            ← loop started at block 1
A7 throws undefined must be positive     ← raw BigInt error for difficulty 300
A8 exit 124                              ← mining at difficulty 256: killed by `timeout 5`
```

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| F1 | **High** | Attack script (A1) | **Unmined blocks accepted.** `isValid()` compared the stored hash with a recomputed one but never checked the Proof-of-Work target, so an attacker could edit any block, recompute hashes and re-link the rest *instantly*. Proof of Work was decoration. | `checkBlock` requires `meetsDifficulty(hash, difficulty)` for every block. | `F1: a forged chain with recomputed but UNMINED hashes is rejected` |
| F2 | **High** | Attack script (A2) | **Difficulty taken from the block itself.** A forger wrote `difficulty: 1` into each block and re-mined history ~65,000× cheaper. | The required difficulty comes from the chain's rules; a block with any other value is rejected. | `F2: blocks mined at a lower difficulty…` |
| F3 | Medium | Attack script (A3) | **Ambiguous encoding → header collisions.** Plain string concatenation: index `1` + timestamp `12` looks the same as index `11` + timestamp `2`; nonce `34` + difficulty `4` = nonce `3` + difficulty `44`. Two different blocks, one hash. | Fixed-type fields in a JSON array (`[version, index, prevHash, timestamp, difficulty, nonce, dataHash]`). | `F3: field boundaries are unambiguous`, `F3 property: …never serialise to the same bytes` (3,000 runs) |
| F4 | Medium | Attack script (A4, A6) | **Genesis never checked.** The loop started at block 1, so an edited genesis, or a completely different history with its own genesis, was valid. | Block 0 must equal the rule-defined genesis (`genesisBlock(difficulty)`) and pass the same checks. | `F4: a foreign or edited genesis block is rejected` |
| F5 | Low | Manual | Missing or wrong-type fields were hashed as the text `"undefined"`; `hashBlock(null)` crashed. | `assertHeaderShape`: whole-number index/timestamp/nonce, 64-hex `prevHash`, valid difficulty. Validator returns a reason instead of crashing. | `F5: malformed headers are rejected`, `malformed blocks inside a chain give a reason` |
| F6 | Medium | Attack script (A5) | Index 99 after block 1, timestamps before the parent or 30,000 years ahead were accepted. | Index = parent + 1; timestamp ≥ parent's and ≤ now + 2 h (Bitcoin's future limit). | `F6: wrong index, time travel backwards and far-future timestamps are rejected` (incl. the exact 2 h boundary) |
| F7 | Info | Attack script (A7) | `meetsDifficulty(h, 300)` threw a raw BigInt `RangeError`. | `parseDifficulty`: whole number of bits 1–32, clear message; strict parsing (`"0x10"`, `"1e1"` rejected). | `F7/F8: difficulty outside 1–32 bits is refused…` |
| F8 | Medium | Attack script (A8) | **Infinite loop (DoS).** `mineBlock` at difficulty 256 can never succeed and looped forever. | Difficulty capped at 32 bits; `maxAttempts` (default 2^32, Bitcoin's nonce size) guarantees termination. | `F8: mining always terminates` |

## Correctness checks added

- fast-check properties: header hashes are deterministic 64-hex strings (1,000 runs); different headers never serialise identically (3,000 runs); the fast byte-level zero-bit check agrees with the BigInt check (3,000 runs); **changing any field of any block is detected at that block or earlier** (500 runs).
- Exact boundary tests for the target: a hash with exactly *d* leading zero bits passes, *d − 1* fails, for d = 1, 7, 8, 9, 16, 31, 32.
- The demo chain is reproducible (fixed timestamps): pinned genesis and tip hashes.
- CLIs: bad input → one `Error:` line, exit code 1, no stack trace; importing a script has no side effects.

## Final green run (morning)

```
$ npm test
# tests 20
# pass 20
# fail 0

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

---

## Evening audit

**Reviewer stance:** external auditor, fresh eyes, assuming the morning author missed things.
**Scope:** everything in `src/` after the morning fixes, plus the new evening code (difficulty adjustment, exercise solutions).
**Method:** re-ran tests / ESLint / `npm audit`; then attacked the payload encoder (every value `JSON.stringify` treats specially), object aliasing, extra/unknown fields, `__proto__` keys, getters, cycles, deep nesting, huge payloads, and the clock and retarget parameters. Every real issue got a failing test **first** ([`test/evening-audit.test.js`](test/evening-audit.test.js)), then the fix. No Solidity, so Slither / Solhint do not apply.
**Rounds:** 3 (round 1: E1–E5; round 2: re-attacked the fixes with getters, `__proto__` and cycles, all held; round 3: reviewed the new retarget code → E6 and known issue K1; final re-run clean).

| ID | Severity | How found | Description | Fix | Proving test |
|----|----------|-----------|-------------|-----|--------------|
| E1 | Medium | Manual (fuzzing `JSON.stringify` edge cases) | **Different payloads, same block hash.** The data hash used `JSON.stringify`, which silently rewrites values: `{a: undefined}` and `{}` both → `d5dfcac3…`; `NaN` and `null` → `61733a8c…`; `-0` and `0` → `b4db5305…`; and `{amount: 500, toJSON: () => ({amount: 5})}` hashed **exactly like** `{amount: 5}` (`adc66f74…`). A block could show 500 coins while its Proof of Work certified 5. | `canonicalJson`: strict canonical encoder (sorted keys, like RFC 8785). Allows only null, booleans, finite numbers (not −0), strings, dense arrays and plain objects; refuses `undefined`, functions, symbols, BigInt, Date/Map/class instances, `toJSON`, sparse arrays. | `E1: payloads JSON.stringify would silently merge…`, `E1: the strict encoder refuses…`, `E1: key order does not change the hash`, `E1 property: two DIFFERENT accepted JSON values never give the same block hash` (3,000 runs) |
| E2 | Medium | Manual (aliasing review) | **Caller could rewrite the ledger.** `addBlock(payment)` stored the caller's object by reference: `payment.amount = 500` after mining changed the stored block (it showed 500 and the chain turned invalid). The returned `block` *was* the stored block. | The payload is read once, encoded, hashed, and the stored data is a deep-frozen copy rebuilt from those exact bytes; blocks are frozen. | `E2: caller objects are copied and stored blocks are frozen`; round 2: a getter that returns a new value on every read cannot split "hashed" from "stored" |
| E3 | Low | Manual | **Unhashed fields accepted.** A block with an extra `amount: 500` beside `data` was VALID, even though no hash or work covers it. Apps displaying it would show unverified data. | Blocks may contain exactly the header fields + `hash`; anything else (including `__proto__`) is rejected with the field name. | `E3: blocks with fields that are not covered by the hash are rejected`, round-2 `__proto__` test |
| E4 | Low | Manual | `addBlock(data, now + 3 h)` mined and **appended a block its own validator rejects**, and a too-early timestamp was silently replaced by the parent's. | Timestamp checked *before* mining (no wasted work), then the mined block goes through the same `checkBlock` as `validate()` before it is appended. | `E4: addBlock refuses blocks that would make the chain invalid` |
| E5 | Low | Manual (DoS review) | No payload size or depth limit: every validator must hash whatever a miner stuffs into a block. | 1 MB canonical-size limit (Bitcoin's original block-size limit) and 32 levels of nesting. | `E5: payloads above 1 MB are refused` (exact boundary) |
| E6 | Low | Manual (round 3) | A bad clock value (`now: NaN` or `"x"`) made `timestamp > now + 2h` always false, so the future-time rule was **silently switched off**. | `parseNow`: `now` must be whole milliseconds ≥ 0, else a clear error. | `E6: an invalid clock value is refused…` |

**Checked, not vulnerable:** lone UTF-16 surrogates (the Day 01 E1 bug) inside block data: `JSON.stringify` escapes them as `\ud800`, so they never merge with `�` (pinned by a test). `__proto__` keys from `JSON.parse` do not pollute `Object.prototype`. Cyclic payloads are refused.

### Known issues (accepted, documented)

| ID | Severity | Description | Reasoning |
|----|----------|-------------|-----------|
| K1 | Low | **Time-warp:** with difficulty adjustment on, a miner can claim slow timestamps (up to 2 h ahead of the clock) to make the next window easier. | Bounded: at most −2 bits per window and timestamps must stay ≤ now + 2 h and ≥ the parent's. This is a real, known class of attack on Bitcoin-style retargeting (mitigated there by median-time-past). It is pinned by a test so the behaviour is explicit. Covered properly with forks on Day 04. |
| K2 | Info | Validation picks no winner between two valid chains (no fork choice yet). | Out of scope for Day 02. Day 04 adds "most cumulative work wins". |

### Evening improvement

**Difficulty adjustment** (`Blockchain(difficulty, { retarget: { interval, targetMs } })`, `npm run retarget`). At the first block of every new window the required difficulty is re-derived from the previous window's timestamps: 2× too fast → +1 bit, 2× too slow → −1 bit, capped at ±2 bits (×4, like Bitcoin) and at 1–32 bits. `validateBlocks` re-derives it for every block, so a miner who ignores the rule is rejected (`wrong difficulty 6 (chain requires 8)`).

### Final green run (evening)

```
$ npm test          # 20 morning + 16 audit/improvement + 4 exercise-solution tests
# tests 40
# pass 40
# fail 0

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

**Result:** 0 high, 0 medium findings open. Morning: 2 high + 4 medium + 1 low + 1 info fixed. Evening: 2 medium + 4 low fixed; 1 low + 1 info accepted.
