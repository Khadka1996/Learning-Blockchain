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
