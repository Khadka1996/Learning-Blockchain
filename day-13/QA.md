# Day 13 — QA & security review

**Scope:** `contracts/TipJar.sol`, `frontend/` (`index.html`, `app.js`, `style.css`), `scripts/deploy.js`, `scripts/env.js`, `src/serve.js`, `hardhat.config.js`. `contracts/test-helpers/` are test fixtures. `frontend/vendor/ethers.umd.min.js` is ethers 6.17.0 copied unchanged from npm and was not audited.
**Method:** tests first (contract unit + 2 fuzz properties + browser E2E), then the tools (ESLint with an `innerHTML` ban, Solhint, `npm audit`, Slither 102 detectors), then a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md) **plus a web checklist** (XSS, CSP, clickjacking, path traversal, secret handling, wallet events, wrong network, stale config), adding a test for every idea.
**Rounds:** 3 (round 1: 32 tests + tools, lint fixes · round 2: manual attacker review, 4 Low fixed + 11 probe tests · round 3: everything re-run on the final code after a clean build).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| L1 | Low | Manual review (wallet events / races) | **Two quick `accountsChanged` events left two polling timers running.** `setup()` is async; a second call started before the first finished, both reached `setInterval`, and only one timer id was kept. Each extra switch added another timer: double RPC traffic forever, and an older account's view could overwrite the newer one. Reproduced: **2 timers instead of 1** with the fix removed. | Each `setup()` takes a generation number and stops after every `await` if a newer one has started; disconnect also bumps it. | `L1: two quick account switches leave exactly ONE polling timer` (E2E) |
| L2 | Low | Manual review (deploy script) | **A damaged `frontend/config.js` was silently replaced.** `readConfig` swallowed parse errors and started from `{}`, so the next local deploy would erase the Sepolia address the live site relies on. | Missing file → start fresh; file present but unparseable → throw and refuse to overwrite. | `L2: a corrupted frontend/config.js is NOT silently replaced` |
| L3 | Low | Manual review (deploy script) | **`npx hardhat run scripts/deploy.js` without `--network` "succeeded"** on Hardhat's in-memory chain (also chain id 31337) and wrote that address into the frontend config. The chain vanishes when the script exits, so the page points at nothing. | The script refuses the `hardhat` network unless a test opts in explicitly. | `L3: deploying to the temporary in-memory chain refuses (and writes nothing)` |
| L4 | Low | Manual review (web: clickjacking) | **The page could be framed.** A malicious site could load the dApp in an invisible iframe and trick a click on "Send tip" / "Withdraw". (The wallet popup still asks, which is why this is Low.) `frame-ancestors` can't be set from a `<meta>` CSP. | `src/serve.js` sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (+ `nosniff`, `no-referrer`). README: a real host must send the same headers. | `L4: the server forbids framing…` |
| I1 | Info | Manual review (CSP) | `connect-src` allowed `http://127.0.0.1:8545` and any `https:` origin, but the page itself never connects anywhere (the wallet does). | Tightened to `connect-src 'self'`; E2E still green. | `L4: … CSP allows only its own scripts` |
| I2 | Info | Manual pentest (Unicode spoofing) | A message with a right-to-left override (`U+202E`) could visually reverse text. | Messages are rendered with `unicode-bidi: isolate` in their own block, so the address/amount line can't be flipped. | `Info: a message with a right-to-left override…` (E2E) |
| P1 | Info | Manual pentest (XSS) | Tip message `<img src=x onerror=…><script>…</script>` written straight to the contract (skipping the page). | Shown as literal text, no element created, nothing runs. Three locks: `textContent`, a CSP without `unsafe-inline`, and an ESLint rule + test banning `innerHTML`. | `XSS: a message that is HTML/JS is shown as plain text and never runs` (E2E), `frontend source never uses innerHTML…` |
| P2 | Info | Manual pentest (path traversal) | `/../hardhat.config.js`, `%2e%2e`, `..%2f`, null byte, broken `%` escape against the static server. | All refused (400/404); only files inside `frontend/` are served, on `127.0.0.1` only. | `path traversal is refused…` |
| P3 | Info | Manual pentest (secrets) | Placeholders, `http://` RPC, short key, Hardhat's public key, key leaking into error text or into `config.js`. | All refused / never printed; `.env` is git-ignored. | 03-tooling `Deploy settings (.env)` (5 tests), `deploy script writes ABI + address per chain and KEEPS other chains` |
| P4 | Info | Manual pentest (re-entrancy) | An owner **contract** re-enters `withdraw()` from its `receive()`. | Second call finds a 0 balance and reverts; attacker receives exactly the jar balance once. | `re-entrancy: an owner contract that calls withdraw() again…` |
| P5 | Info | Manual pentest (edge cases) | `getTips(MaxUint256, MaxUint256)`, `limit = 0`, offset past the end, 52 tips with a huge limit; 35 vs 36 emoji (140 vs 144 bytes); exactly `MIN_TIP` vs 1 wei less. | No revert / underflow, page capped at 50, byte limit exact, boundary exact. | 01-tipjar tests, fuzz `P1` (25 random runs vs a JS model), `P2` (120 random strings incl. full Unicode) |
| P6 | Info | Manual pentest (UX attacks) | Wallet "Cancel", wrong network, stale address after node restart, no wallet, double-click on Send. | Each gives one plain sentence; no transaction sent; the busy flag blocks double submits. | E2E tests 3, 4, 6, 7, 8 |
| S1 | Info | Slither `incorrect-equality` | `amount == 0` in `withdraw`. | Intended: it is the "jar is empty" check. ETH forced in via `selfdestruct` only makes the balance bigger, which the owner can withdraw. | `refuses address(0) and an empty jar` |
| S2 | Info | Slither `low-level-calls` | `to.call{value: amount}("")` in `withdraw`. | Intended: `transfer`'s 2,300-gas limit breaks smart-wallet owners. Result checked, state settled before the call. | `a recipient that refuses ETH makes it revert with TransferFailed` |
| S3 | Info | Slither `timestamp` | `getTips` flagged for "timestamp comparisons". | False positive: the comparisons are on `offset`/`limit`; the struct merely contains a `timestamp` field. | — |
| S4 | Info | Slither `locked-ether`, `reentrancy-benign` (×2 total) | In `test-helpers/Helpers.sol`. | Test fixtures, re-entering on purpose; never deployed. | — |
| T1 | Info | ESLint / Solhint (round 1) | 14 `no-undef` (browser globals inside Playwright callbacks), 1 `gas-custom-errors`, 1 `one-contract-per-file` in fixtures. | `/* global */` for page code, custom error `NoThanks()`, rule disabled for the fixture file only. | `npm run lint` clean |

### Known issues (accepted, with reasoning)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K1 | **The owner is fixed forever** (`immutable`, no transfer). A lost owner key = tips stuck forever. | Keeps the contract tiny for today's full-stack lesson. Production: `Ownable2Step` (Day 06/09) or a multisig as owner. |
| K2 | **Messages are public and permanent.** A tipper can post anything (whitespace-only, rude text, a phishing URL); the contract can't moderate. | That is how public chains work. The page shows messages as plain text (no clickable links), so a URL can't become a link. A real app would add an off-chain filter in the UI, not in the contract. |
| K3 | **The browser tests use a stand-in wallet, not MetaMask.** The popups themselves are not tested. | MetaMask can't run in this headless environment. The stand-in uses the same EIP-1193 interface and the same error code (4001) MetaMask uses; manual testing with the real extension is described in the README. |
| K4 | **Sepolia deployment was not executed here** (public RPCs are unreachable from this environment). | The deploy path is the same code as `deploy:local`; settings validation, config merging and the "not configured" message are tested. |
| K5 | **Polling every 8 s** instead of event subscriptions. | Simple and works with every wallet/RPC; one `getTips(0,20)` + 3 small reads per poll. With L1 fixed there is exactly one poller. |
| K6 | **`frontend/vendor/ethers.umd.min.js` is trusted as-is.** | Copied from the npm package (version pinned in `package-lock.json`); served from our own origin, so no CDN can swap it. A production build would add Subresource Integrity or a bundler. |

## Tool results (final round, after `npx hardhat clean && npx hardhat compile`)

| Tool | Result |
|---|---|
| `npm test` | **39 / 39 pass** (~7 s): 13 contract · 2 fuzz · 13 deploy/env/server/QA · 11 browser E2E |
| `npx eslint .` | clean (0 problems), including the `innerHTML` ban on `frontend/` |
| `npx solhint 'contracts/**/*.sol'` | clean (0 problems) |
| `npm audit --omit=dev` | found 0 vulnerabilities |
| `slither . --hardhat-ignore-compile` | 3 contracts, 102 detectors, 6 results, all Info and explained above (S1–S4); no high/medium |

```
$ npm test
  TipJar — tipping                                  5 passing
  TipJar — reading pages (newest first)             3 passing
  TipJar — withdrawing                              5 passing
  TipJar — fuzz / property tests                    2 passing
  Deploy settings (.env)                            5 passing
  Static server — only serves frontend/             3 passing
  QA findings — deploy script & server              5 passing
  E2E — real frontend in Chromium + Hardhat chain  11 passing

  39 passing (7s)

$ npm audit --omit=dev
found 0 vulnerabilities

$ slither . --hardhat-ignore-compile
INFO:Slither:. analyzed (3 contracts with 102 detectors), 6 result(s) found
```


---

## Evening audit

**Who:** a second, independent pass as an outside auditor who did not write the code. **Method:** re-ran everything from a clean build, then attacked the parts the morning review covered least: the secret-handling code (`scripts/env.js`), which guards the one thing that costs real money if it goes wrong. Each idea became a test that was run **before** fixing.
**Rounds:** 2 (round 1: 3 failing tests written, 3 fixes · round 2: full re-run on clean build).

| ID | Severity | How found | Description | Fix | Proving test |
|----|----------|-----------|-------------|-----|--------------|
| E1 | Low | Manual pentest (secret handling) | **Only Hardhat account #0's key was blocked.** `checkSepoliaEnv` refused one public test key, but the 19 other accounts that `npx hardhat node` prints come from the same public phrase, so their keys are known to everyone too. Pasting account #1's key was accepted as "valid". Bots sweep these keys on every real network within seconds. | All 20 keys are derived from the public phrase and refused, in any form (`0x`, no prefix, upper case). | `E1: ALL 20 well-known Hardhat test keys are refused…` (failed before the fix: `HARDHAT_PUBLIC_KEYS` did not exist) |
| E2 | Low | Boundary values on the key | **An all-zero key passed the check** (`0x00…00` is 64 hex characters, so the format check was happy), although it is not a valid private key (the allowed range is 1 up to just below the curve order). The deploy would fail late with an unclear error. | Reject 0 and anything ≥ the secp256k1 order. An upper-case `0X` prefix is now normalised. | `E2: a private key with an upper-case 0X prefix…` (failed before: zero key accepted) |
| E3 | Low | Malformed data (URL) | **`https://` with no host name passed** the "starts with https://" check. | The URL is parsed with `new URL()`; it must be `https:` and have a host name. | `E3: RPC URLs with a placeholder, whitespace or a non-https scheme are refused` (failed before on `https://`) |
| E4 | Info | Probe: contract re-run (reentrancy, overflow, DoS) | Re-attacked `TipJar`: owner contract re-entering `withdraw`, `getTips(MaxUint256, MaxUint256)`, 120 tips read in pages, 140/144-byte emoji boundary, 10,000 random strings against a model. | Nothing found. The contract is unchanged. | morning tests `P4`, `P5` + exercise tests ex1/ex2 (fuzz of the byte rule against the real contract) |
| E5 | Info | Probe: path traversal / framing | Re-ran traversal, null byte, double-encoded dots and framing headers against `src/serve.js`. | Nothing found. | morning `P2`, `L4` |

New helper from the evening work: `npm run check:env` validates `.env` **without deploying and without printing the key**.

### Known issues
No new ones. K1–K6 above still apply. E1 reduces, but cannot remove, the risk of using a leaked key: the check only knows keys that are public by design.

### Final green output (evening, after `npx hardhat clean && npx hardhat compile`)

| Tool | Result |
|---|---|
| `npm test` | **45 / 45 pass** (39 morning + 3 evening-audit + 3 exercises) |
| `npm run ex` (exercises) | 3 / 3 pass |
| ESLint + Solhint | 0 problems |
| `npm audit --omit=dev` | found 0 vulnerabilities |
| Slither (102 detectors) | 6 results, all Info (S1–S4 above); 0 high / medium |

```
$ npm test
  Evening audit (see QA.md)                     3 passing
  Evening exercises (solutions)                 3 passing
  (+ 39 morning tests)
  45 passing (9s)
```
