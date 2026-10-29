# Security self-audit — CertificateRegistry (Day 15 capstone)

| | |
|---|---|
| **Project** | CertCheck — on-chain certificate verification dApp |
| **Author / auditor** | Manish Khadka (self-audit — see *Limitations*) |
| **Date** | 29 October 2026 |
| **Scope** | `contracts/CertificateRegistry.sol` (≈140 lines), `src/certificate.js`, `src/verify.js`, `frontend/app.js`, `frontend/index.html`, `scripts/deploy.js`, `scripts/env.js` |
| **Out of scope** | OpenZeppelin `AccessControl` 5.0.2 (trusted dependency), `contracts/v1/` (kept only to reproduce M1), MetaMask, the RPC provider |
| **Compiler** | solc 0.8.24, optimizer 200 runs, EVM target `paris` |
| **Result** | 3 Medium and 1 Low found and **fixed**; 2 tool findings fixed or triaged; 4 known issues accepted with reasoning. No open High or Medium. |

## 1. System overview

A school (**issuer**) gives a student a certificate **file** (JSON). Only the file's **fingerprint** — `keccak256` of its canonical text — is written to the `CertificateRegistry` contract. Anyone (an employer) later drops the file into the web page; the page recomputes the fingerprint and asks the contract, for free, whether that issuer recorded it and whether it was revoked.

```mermaid
flowchart LR
  A[Admin<br/>multisig in production] -- grant / remove ISSUER_ROLE --> R[(CertificateRegistry)]
  S[Issuer: a school] -- "issue(hash)" / "revoke(issuer, hash, reason)" --> R
  S -- certificate.json --> T[Student]
  T -- certificate.json --> E[Employer + CertCheck page]
  E -- "verify(issuer, hash) — free read" --> R
```

### Roles and powers

| Role | Can | Cannot |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | add / remove issuers; revoke **any** certificate | issue (unless it grants itself `ISSUER_ROLE`, which is public on-chain) |
| `ISSUER_ROLE` | issue; revoke its **own** certificates while it still has the role | touch another issuer's certificates; re-issue a revoked certificate |
| anyone | `verify` (free) | anything that changes state |

### Data on-chain

Per certificate: **one storage slot** (`issuedAt` + `revokedAt`, 2 × `uint40`) under `issuer → hash`. **No personal data**: names and grades stay in the file, which carries a 16-byte random salt.

## 2. Method

1. **Specification first:** the roles table above and these invariants:
   - I1 only an active issuer creates a record, and only in its own column;
   - I2 a record never goes back from Revoked to Valid, and is never deleted;
   - I3 `issuedCount` / `revokedCount` equal the number of records / revoked records;
   - I4 a file verifies only against the registry and chain it names, under the issuer it names;
   - I5 untrusted file text never executes in the page.
2. **Tests:** 36 in total — 13 unit, 4 property/fuzz (fast-check: 3,000 runs on the fingerprint, 60 random 25-step sequences of issue/revoke/role changes compared with a JavaScript model), 7 attack, 8 browser E2E (Playwright + Chromium), 4 deploy/secrets.
3. **Tools:** Slither 0.11.6 (102 detectors), Solhint (recommended + custom errors), ESLint (bans `innerHTML` in the frontend), `npm audit --omit=dev`.
4. **Manual attacker review** with [`tools/README.md`](../tools/README.md): access control, front-running, replay / spoofing, reentrancy, DoS, input validation, privacy, secrets, XSS.

### Severity scale

| Severity | Meaning here |
|---|---|
| High | Anyone can forge a Valid certificate or erase real ones |
| Medium | A privileged-but-limited party (another issuer, a removed issuer) or a careless verifier can cause wrong results |
| Low | Wrong data or bad UX with no security gain for an attacker |
| Info | Tool output, defence-in-depth, confirmed-safe checks |

## 3. Findings

### M1 — Medium — A rival issuer could front-run `issue()` and take over a certificate *(fixed)*

**Where:** v1 `mapping(bytes32 => Record)`, `_issue()`.
**What:** Records were keyed by hash alone and stored `issuer = msg.sender`. Pending transactions are public. A second accredited issuer copies `issue(h)` and resends it with a higher fee.
**Impact:** Reproduced in `test/03-attacks.test.js`: the rival's transaction mined first, the real school's **reverted** with `AlreadyIssued`, and `verify(h)` named the rival as issuer. The school can neither issue nor revoke its own certificate.
**Fix:** `mapping(address issuer => mapping(bytes32 => Record))`. `issue` writes only to `msg.sender`'s column; `verify(issuer, hash)` reads the column of the issuer **written inside the file**, and that field is covered by the hash. The same attack now leaves the school's record untouched (`fixed (per-issuer records)` test).

### M2 — Medium — Look-alike registries fool a verifier who only checks the hash *(fixed in the verifier)*

**What:** The contract is open source; anyone can deploy a copy, become its admin and issuer, and record any hash there.
**Impact:** A verifier asking "is this hash Valid?" on the wrong contract gets **Valid** for a forged certificate (reproduced).
**Fix:** The file contains `registry` and `chainId` (both inside the hash). `verifyDocument()` returns `WRONG_REGISTRY` unless both match the registry the verifier trusts; the page only uses registries from its own `config.js`. Covered by unit + E2E tests.

### M3 — Medium — A removed issuer could still revoke all its real certificates *(fixed)*

**Where:** `revoke()`: `if (msg.sender != issuer && !isAdmin) revert`.
**What:** Removing an issuer (e.g. after its key was stolen) blocked new issues but not revocations.
**Impact:** The thief, already locked out, could still cancel every genuine certificate of that school — permanently, since I2 forbids re-issue. Reproduced: the revoke succeeded.
**Fix:** The issuer may revoke only while `hasRole(ISSUER_ROLE, issuer)`; otherwise only the admin can. The fuzz model was updated to this rule and agrees over 60 random sequences.

### L1 — Low — Wrong default date in the issue form east of UTC *(fixed)*

`toISOString()` is UTC: in Nepal (UTC+5:45) the form proposed **yesterday** before 05:45. Now uses the browser's local date. E2E test with `timezoneId: "Asia/Kathmandu"` fails on the old code and passes now.

### Tool findings

| ID | Tool | Finding | Resolution |
|----|------|---------|------------|
| S1 | Slither `costly-loop` | `++issuedCount` inside the batch loop | Fixed: `issuedCount += n` once per batch |
| S2 | Slither `incorrect-equality` ×2, `timestamp` | `issuedAt == 0`, `revokedAt == 0` | False positive: `0` means "never happened", not a time comparison |

### Confirmed-safe checks (Info)

| Check | Result |
|---|---|
| Reentrancy | No external calls and no ETH handling in the contract: no reentrancy surface |
| Re-issue after revoke | Impossible (`AlreadyIssued`); records are never deleted |
| Access control | 60 random sequences of issue / revoke / grant / remove by 5 accounts match the model |
| DoS | Batch 1–100 (`BadBatchSize`), 100 certificates < 3M gas; reason ≤ 200 bytes |
| Privacy | Unsalted hash: found among 1,000 guessed names. Salted: 0 hits; files without salt are refused |
| Canonical form | Key order, spacing and pretty-printing never change the hash; any real change always does (2,000 fuzz runs) |
| Hostile files | 13 crafted files + 1,000 random JSON values → `BAD_FILE`, never hashed |
| XSS | A name containing `<img onerror>` renders as text; no `innerHTML` anywhere (ESLint rule); CSP `script-src 'self'` |
| Secrets | `.env` git-ignored, placeholders in `.env.example`, Hardhat's public keys refused, `config.js` holds public data only |

## 4. Centralisation & trust assumptions

| ID | Assumption / risk | Recommendation |
|----|-------------------|----------------|
| K1 | One admin key decides who may issue and can revoke anything. | Use a multisig (e.g. Safe 2-of-3) and `AccessControlDefaultAdminRules` (two-step, time-delayed admin transfer). |
| K2 | Certificates made with a stolen key before removal stay Valid until revoked one by one. The page shows ⚠️ `VALID_OLD_ISSUER` for every certificate of a removed issuer. | Optional upgrade: record `removedAt` per issuer and treat later records as invalid; publish an incident list. |
| K3 | The chain proves *an address* issued it, not *which institution*. | Show a vetted address → institution list in the page; publish issuer addresses on the institution's own website. |
| K4 | Unicode look-alike names (Latin vs Cyrillic `a`). | Issuers should restrict names to expected scripts; out of scope here. |

## 5. Gas (from `npm start`, Hardhat, optimizer on)

| Action | Gas |
|---|---:|
| Deploy registry | 677,764 |
| Issue 1 certificate | 70,391 |
| Issue a class of 30 (batch) | 766,497 (**25,549 each**, 64% less) |
| Revoke | 56,065 |
| Verify | 0 (free read) |

## 6. Limitations

This is a **self-audit**: the same person wrote and reviewed the code, so blind spots are likely. It is a learning project and has **not** been reviewed by an independent auditor or deployed with real value. Before any real use: an external audit, a multisig admin, a testnet pilot with real issuers, and monitoring of `CertificateRevoked` / role events.
