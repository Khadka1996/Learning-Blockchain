# Day 01 — QA & security review

**Scope:** `src/` (SHA-256 helpers and four CLI scripts). Plain Node.js, no Solidity today, so Slither / Solhint do not apply.
**Method:** automated checks (tests, ESLint, `npm audit`) + a manual attacker review using the checklist in [`tools/README.md`](../tools/README.md): bad inputs, edge cases, resource exhaustion (DoS), error handling, hidden side effects.
**Rounds:** 3 (round 1: original code; round 2: after first fixes; round 3: final re-run, nothing new found).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| F1 | Medium | Manual | `preimage.js abc` → `Number("abc")` is `NaN`, `"0".repeat(NaN)` is `""`, so **every** hash "matched" after 1 attempt and the script reported a fake success (`Expected avg: ~NaN`). | `parseZeros()` validates input: whole number 1–8, else a clear error and exit code 1. | `F1–F3: parseZeros…`, `F1/F2/F3: preimage CLI refuses bad input…` |
| F2 | Low | Manual | `preimage.js -1` crashed with an uncaught `RangeError` and a stack trace. | Same validation; CLI catches errors and prints one clean line. | same as F1 |
| F3 | Medium | Manual | `preimage.js 65` asks for more zeros than a hash has (64 chars) → **infinite loop** (process hung; killed by `timeout` after 5 s). Large values like 12 would run for days. | Cap at 8 zeros and add a `maxAttempts` limit so the search always ends. | `F3: findLeadingZeros always terminates`, CLI test |
| F4 | Low | Manual | `file-fingerprint.js /missing` printed an error but **exited 0**, so scripts/CI would think it succeeded. Size came from a separate `statSync` call after streaming, which could disagree with the bytes actually hashed if the file changed meanwhile. | Exit code 1 on any error; size is counted from the streamed bytes. Added optional `<expected-hex>` verify mode (exit 1 on mismatch). | `F4: fingerprint CLI exits 1…`, `hashFile equals hashing the bytes in memory…`, `tamper detection…` |
| F5 | Low | Manual | `require("./hash.js")` (to reuse `sha256`) printed output — importing a module ran the CLI. | All logic moved to side-effect-free `src/lib.js`; CLIs run only when `require.main === module`. | `F5: requiring a script has no side effects` |
| F6 | Info | Manual | `sha256(42)` / `sha256(null)` surfaced a Node internal error (`ERR_INVALID_ARG_TYPE`). | Explicit type check with a clear `TypeError` (string, Buffer or Uint8Array only). | `F6: sha256 rejects non-hashable input…` |
| F8 | Medium | Manual (round 2) | `file-fingerprint.js /dev/zero` (or a pipe) streams forever → **hang / denial of service**. | `hashFile` accepts regular files only (`stat().isFile()`). | `F8: fingerprint refuses endless devices…` |
| F9 | Info | Manual (round 2) | After the F1 fix, `Number()` still accepted `"0x3"` and `"1e3"` as numbers. | Strings must be plain decimal digits (`/^\d+$/`). | `parseZeros` test (rejects `"0x3"`, `"1e3"`, `"5abc"`) |

## Known issues (accepted, documented)

| ID | Severity | Description | Reasoning |
|----|----------|-------------|-----------|
| F7 | Info | Visually identical Unicode text can hash differently: `"café"` with a single `é` vs `e` + combining accent → different SHA-256. | This is correct behaviour — a hash covers exact bytes. Apps that hash *user-typed text* must normalise first (`str.normalize("NFC")`). Documented in README takeaway #4 and pinned by a test so the behaviour is explicit. |

## Correctness checks added

- Official SHA-256 test vectors (`""`, `"abc"`, 448-bit message) from NIST FIPS 180-4 examples.
- fast-check property tests: 2,000 random Unicode strings / byte arrays → always 64 lowercase hex chars and deterministic; 2,000 random distinct pairs → no collisions; Hamming distance is 0 for self, symmetric, ≤ 256.
- Statistical avalanche test: 5,000 random one-character edits must average 125–131 bits flipped (theory: 128 ± 0.11) and never 0.

## Final green run

```
$ npm test
# tests 20
# pass 20
# fail 0
# duration_ms 1043.058492

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

---

## Evening audit

**Reviewer stance:** external auditor, fresh eyes, assuming the morning author missed things.
**Scope:** everything in `src/` after the morning fixes, plus the new evening code (`preimage --table`, exercise solutions).
**Method:** re-ran tests / ESLint / `npm audit`; then attacked each entry point with malformed Unicode, odd number formats, wrong JS types, FIFOs and symlinks, and a simulated file-swap race. Every real issue got a failing test **first** ([`test/evening-audit.test.js`](test/evening-audit.test.js)), then the fix. No Solidity today, so Slither / Solhint do not apply.
**Rounds:** 3 (round 1: 5 findings; round 2: fallback path for Node 18, empty files, symlinked pipes, CLI encoding → 1 known issue; round 3: clean).

| ID | Severity | How found | Description | Fix | Proving test |
|----|----------|-----------|-------------|-----|--------------|
| E1 | Medium | Manual (Unicode fuzzing) | **Real hash collision in the string API.** A lone UTF-16 surrogate has no UTF-8 form, so Node silently replaces it with U+FFFD. `sha256Hex("\uD800")`, `sha256Hex("\uDC00")` and `sha256Hex("�")` all returned `83d544cc…`. Three different inputs, one fingerprint — exactly what a hash library must never do. The morning collision test missed it because `fc.string()` only generates ASCII. | `assertHashable` now rejects strings that are not well-formed Unicode (`String.prototype.isWellFormed`, with a `/\p{Surrogate}/u` fallback for Node 18). Bytes are unaffected. | `E1: malformed strings…`, `E1 property: any two DIFFERENT strings that are accepted never share a hash` (fast-check, 5,000 runs over surrogate-heavy strings) |
| E2 | Low | Manual (race review) | **Time-of-check / time-of-use gap.** `hashFile` checked the *path* with `stat()`, then opened the *path* again. Swapping the file for a pipe in between brings back the F8 hang. | Open once (`O_NONBLOCK`), `fstat` the handle, stream from that same handle. | `E2: hashFile checks the file it actually opened` (simulates the race; old code hung until the 4 s timeout) |
| E3 | Low | Manual | `node src/hash.js ""` hashed `"Hello, Blockchain!"` instead of the empty string (`"" \|\| default`). You could not hash `""` from the CLI. | Use the demo text only when **no** argument is given. | `E3: hash CLI hashes an explicit empty string…` |
| E4 | Low | Manual | Same bug class as F9, in another place: `avalanche --stats 0x10` ran 16 trials, `--stats 1e2` ran 100; `parseZeros([5])` accepted an array. | One shared `toWholeNumber()` parser (numbers must be integers; strings plain decimal digits; every other type rejected), used by both CLIs. | `E4: avalanche --stats accepts only plain decimal…`, `E4: parseZeros rejects non-number, non-string types` |
| E5 | Info | Manual | `findLeadingZeros(1, { prefix: {} })` searched for `"[object Object]0"` without complaint. | `prefix` must be a string (`TypeError` otherwise). | `E5: findLeadingZeros requires a string prefix` |

### Known issues (accepted, documented)

| ID | Severity | Description | Reasoning |
|----|----------|-------------|-----------|
| E6 | Info | Invalid UTF-8 bytes typed as a CLI argument are turned into U+FFFD by Node **before** our code runs, so `hash.js` cannot hash raw invalid bytes. | Command-line arguments are text by definition. For exact bytes, put them in a file and use `file-fingerprint.js`. |
| E7 | Info | `preimage.js 8` is allowed and needs ~4.3 billion guesses on average (hours on a laptop). | Bounded (`maxAttempts`), user-chosen and clearly documented; it *is* the lesson — difficulty grows 16× per zero. |

### Evening improvement

`node src/preimage.js --table 5` (`npm run preimage:table`) now **generates** the README's difficulty table from code instead of it being typed by hand, and a test pins the first rows (23 / 193 / 13,699 attempts), so README and code can no longer drift apart.

### Final green run (evening)

```
$ npm test          # 20 morning + 8 audit/improvement + 5 exercise-solution tests
# tests 33
# pass 33
# fail 0

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

**Result:** 0 high, 0 medium findings open. 1 medium + 3 low + 1 info fixed; 2 info accepted.
