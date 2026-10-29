# Day 15 — QA & security review (morning)

**Scope:** `contracts/CertificateRegistry.sol`, `src/certificate.js`, `src/verify.js`, `frontend/` (`index.html`, `app.js`, `style.css`), `scripts/deploy.js`, `scripts/env.js`, `scripts/build-web.js`, `src/serve.js`. `contracts/v1/CertificateRegistryV1.sol` is my first design, kept **only** to reproduce finding M1. OpenZeppelin `AccessControl` 5.0.2 is trusted, not re-audited.
**Method:** unit tests → fuzz/property tests (fast-check) → browser end-to-end tests (Playwright + Chromium) → tools (ESLint, Solhint, `npm audit --omit=dev`, Slither 0.11.6 with 102 detectors) → manual attacker review with the checklist in [`tools/README.md`](../tools/README.md). Every idea in the review became a test.
**Rounds:** 4.
1. 13 unit tests + tools on v1 of the design.
2. Manual attacker review. Found **M1** (front-running between issuers) → redesigned storage per issuer. Found **M2** (fake registry) → `verifyDocument()` checks registry + chain. Wrote the attack tests.
3. Attack tests found **M3** (removed issuer can still revoke). Slither `costly-loop` → fixed. Browser review found **L1** (wrong default date in Nepal) → fixed.
4. `hardhat clean`, everything re-run on the final code: all green.

The full professional write-up of these findings is in **[AUDIT.md](AUDIT.md)**.

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| M1 | **Medium** | Manual review (front-running) | In v1 a certificate was stored under its **hash alone**. Another accredited issuer could copy a pending `issue(h)` from the mempool and send it first with a higher fee. Reproduced: the rival's tx mined first, the real school's tx **reverted** (`AlreadyIssued`) and the registry said the **rival** issued the certificate. | Records are now stored per `(issuer, hash)`. `verify(issuer, hash)` looks up the issuer **named inside the certificate file**, and the file's hash covers that issuer field. A rival copying the hash only creates a record in its own column. | `M1 … V1 … the rival … wins`, `M1 … fixed (per-issuer records)` |
| M2 | **Medium** | Manual review (spoofing) | Anyone can deploy their own `CertificateRegistry`, make themselves an issuer and "issue" any hash. A verifier who only checks "is this hash Valid somewhere?" is fooled. | The certificate file names its `registry` and `chainId`, both inside the hash. `verifyDocument()` returns `WRONG_REGISTRY` unless they match the registry the verifier trusts. The page only knows registries from its own config. | `M2 — a forger deploys their OWN registry…`, e2e `an edited certificate, a wrong registry and junk are all refused` |
| M3 | **Medium** | Attack test (stolen issuer key) | `revoke` allowed `msg.sender == issuer` even **after** the admin removed that issuer. A thief holding a stolen issuer key, already locked out of issuing, could still cancel every **real** certificate the school ever issued. Reproduced: the revoke went through. | The issuer may revoke only while it still holds `ISSUER_ROLE`. After removal only the admin can revoke its certificates. | `M3 — stolen issuer key …`, fuzz model (revoke rule) |
| L1 | Low | Manual review (browser) | The issue form's default date used `toISOString()` (UTC). In Nepal (UTC+5:45) that is **yesterday** before 5:45 am, so a certificate could carry the wrong date. | Use the browser's local date. | e2e `L1: … LOCAL date (Nepal, 01:45 on 30 Oct)` (fails on the old code: `'2026-10-29'` ≠ `'2026-10-30'`) |
| S1 | Info | Slither `costly-loop` | `issueBatch` wrote `issuedCount` once per certificate. | Count once per batch (`issuedCount += n`). | `issueBatch: a whole class…`, fuzz model checks `issuedCount` |
| S2 | Info | Slither `incorrect-equality`, `timestamp` (×2) | `r.issuedAt == 0` / `r.revokedAt == 0`. | False positive: `0` is the "never happened" marker, not a time comparison. `block.timestamp` is never 0 on a real chain. | `rejects the zero hash and duplicates`, `a revoked certificate can never be re-issued…` |
| P1 | Info | Manual pentest (privacy) | Only a hash is on-chain, but without a salt anyone could hash guesses ("Manish Khadka, Blockchain 101"). Reproduced on an unsalted hash: found in a list of 1,000 names. | Every certificate carries 16 random bytes (`salt`); the library refuses a file without one. 0 hits with the salt. | `Privacy — WITHOUT a salt…` |
| P2 | Info | Manual pentest (re-issue after revoke) | Can a cancelled certificate be made Valid again? | No: the record stays forever, `issue` → `AlreadyIssued`. | `a revoked certificate can never be re-issued back to Valid` |
| P3 | Info | Manual pentest (access control) | Issue as admin / student / stranger; revoke as another issuer / student / stranger. | All refused. The admin must grant itself `ISSUER_ROLE` to issue (visible on-chain). | `non-issuers … cannot issue`, `another issuer … cannot revoke`, fuzz model (60 random sequences) |
| P4 | Info | Manual pentest (DoS / gas) | Huge batches, long revoke reasons. | Batch 1–100 (`BadBatchSize`); 100 certificates use < 3M gas. Reason ≤ 200 bytes (`ReasonTooLong`). No loops over storage, no external calls → no reentrancy surface. | `a full batch of 100…`, `…over-long reason` |
| P5 | Info | Manual pentest (hostile files) | Empty, `null`, arrays, broken JSON, 20 KB files, extra fields, wrong version, 30 Feb, short salt, control characters, 121-char names, `chainId` as text, bad addresses, random JSON (1,000 fuzz runs). | All → `BAD_FILE` before any chain call. | `hostile certificate files…`, fuzz `random junk JSON…` |
| P6 | Info | Manual pentest (XSS) | A certificate whose student name is `<img src=x onerror=…>`. | Shown as plain text (`textContent` only, ESLint bans `innerHTML`, CSP `script-src 'self'`). Nothing runs. | e2e `XSS: …` |
| P7 | Info | Manual pentest (canonical form) | Same certificate with keys reordered / extra spaces / pretty-printed → must give the same hash; any real change → a new hash. | Canonical JSON (sorted keys, trimmed, NFC). 2,000 fuzz runs. | fuzz `key order…`, `changing any meaningful field…` |
| P8 | Info | Manual pentest (secrets) | Private keys in git or in the page config. | `.env` is git-ignored, `.env.example` holds placeholders, Hardhat's public test keys are refused, `config.js` holds only public data. | 05-deploy tests |

### Known issues (accepted, with reasoning)

| ID | Description | Why it stays |
|----|-------------|--------------|
| K1 | **One admin key** controls who may issue. If it is lost, no new issuers; if it is stolen, the thief can add fake issuers. | Out of scope for a learning project. Production: make the admin a multisig (e.g. Safe 2-of-3) and use OpenZeppelin `AccessControlDefaultAdminRules` (2-step, delayed admin transfer). Documented in AUDIT.md. |
| K2 | Certificates a thief issued with a stolen key **before** it was removed stay Valid until the admin revokes them one by one; the page shows `VALID_OLD_ISSUER` (⚠️) for every certificate of a removed issuer. | A "revoke everything after time T" switch is a nice upgrade but adds a new admin power. The warning tells verifiers to double-check. |
| K3 | The registry proves "issuer address X recorded this", not "X is Kathmandu University". | Mapping addresses to real names is off-chain trust (the admin vets issuers). A production page should show a vetted issuer name list. |
| K4 | Look-alike letters (`Khadka` vs `Khadkа` with a Cyrillic `а`) give different, valid-looking names. | Only an issuer can create a Valid certificate, so this needs a careless issuer, not just a forger. NFC normalisation is applied; full confusable detection is out of scope. |

## Tools — final run

```
$ npx hardhat clean && npm test
  36 passing (11s)          # 13 unit · 4 fuzz · 7 attack · 8 browser e2e · 4 deploy/secrets

$ npm run lint             # ESLint + Solhint
(no problems)

$ npm audit --omit=dev
found 0 vulnerabilities

$ slither . --hardhat-ignore-compile --filter-paths "node_modules|contracts/v1"
3 results, all on the `== 0` "never happened" markers in verify():
  incorrect-equality ×2 (Slither rates the detector Medium) · timestamp ×1 (Low)
→ triaged as S2: false positives. 0 real high / medium findings left.
```
