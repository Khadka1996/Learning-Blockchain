# Day 03 — QA & security review

**Scope:** `src/` (keys & addresses, ECDSA sign/verify, signed transfers, account ledger, three CLI scripts). Plain Node.js, no Solidity today, so Slither / Solhint do not apply.
**Method:** I first wrote a short "tutorial-style" v1 (sign `JSON.stringify({from, to, amount})`, verify with Node's `crypto.verify`, balances in a plain object) and attacked it with a script. Then I wrote the real version, one regression test per finding, and attacked *that* again with [`src/attack.js`](src/attack.js) and the checklist in [`tools/README.md`](../tools/README.md): bad inputs, edge cases, overflow / precision, replay, cross-chain replay, malleability, access control (signing as someone else), partial state updates and time-of-check / time-of-use.
**Rounds:** 3 (round 1: v1 attack script, 9 findings · round 2: real version attacked, 1 new finding · round 3: re-attack + full suite, clean).

### Round 1 — v1 attack output (before fixes)

```
B1 forged by Mallory accepted? throws: bad signature             ← good
B2 amount edited after signing accepted? throws: bad signature   ← good
B3 replay: same tx applied twice accepted? 80                    ← Ram got 40 coins TWICE
B4 high-S twin signature accepted? true                          ← 2nd valid signature, no key needed
B5 fractional amount 0.1+0.2 accepted? 99.7                      ← 99.69999999999999 in memory
B6 batch half-applied after a failure? 40                        ← first payment stuck, second failed
B7 bad recipient 'hello' accepted? 1                             ← coin sent to an address nobody can own
B8 signature for another chain (testnet) replayed? true
B9 garbage public key throws: un.subarray is not a function      ← crash, not a clean refusal
B10 huge amount 2^60 credited to an address (no supply check) 1152921504606847000   ← signed 2^60+1, rounded
B11 '__proto__' as recipient 1 keys; bal of __proto__ = [object Object]   ← coin vanished from supply
```

### Round 2 — real version, getter attack (before fix M1)

```
13. ACCEPTED Getter: amount reads 1 when checked, 100 when paid
      → GOT THROUGH: Sita signed for 1 coin, ledger paid 100

Mallory tried 13 attacks: 12 refused, 1 got through.
```

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| B3 | **High** | Attack script | **Replay.** The signed message had no counter, so one valid payment could be applied again and again until the sender was empty. | Per-account `nonce` inside the signed bytes; the ledger accepts exactly the next nonce. | `B3: the same signed payment cannot be applied twice (nonce)` |
| M1 | **High** | Manual (round 2) | **Time-of-check / time-of-use.** The ledger read `tx.amount` several times. A getter answered `1` while the signature and balance were checked and `100` when coins moved: Sita signed for 1 coin and paid 100. | `verifyTransfer` reads every field **once** into a frozen snapshot; the ledger only uses that snapshot. | `M1: verifyTransfer reads each field once…`, `M1: a getter cannot change the amount…` |
| B4 | Medium | Attack script | **Signature malleability.** For any valid (r, s), (r, n − s) is also valid. Anyone could create a second signature for Sita's payment without her key, changing anything that hashes the signature (the weakness Mt. Gox blamed in 2014). | Signer always outputs low-S; verifier refuses s > n/2, r or s = 0, r ≥ n. Tx id excludes the signature. | `B4: signatures are always low-S, and the high-S twin…`, `degenerate or malformed signatures…` |
| B5 | Medium | Attack script | Fractional amounts: 0.1 + 0.2 left Sita with 99.69999999999999 coins. | Amounts are whole coins (like satoshis / wei), safe integers ≥ 1. | `B5/B10/B7: amounts must be safe whole numbers…` |
| B6 | Medium | Attack script | **Partial batch.** `applyAll` applied payments one by one; a failure halfway left the first half applied. | Check the whole batch on a scratch copy, then commit all at once. | `B6: a batch is all-or-nothing` |
| B8 | Medium | Attack script | **Cross-chain replay.** A payment signed on a test network was valid on any other ledger. | `chainId` inside the signed bytes and checked by the ledger (like EIP-155). | `B8: a signature made for another chain is refused` |
| B10 | Medium | Attack script | Precision loss: amounts above 2^53 are rounded by JavaScript, so the signed number and the moved number can differ. | Only `Number.isSafeInteger` amounts; total supply ≤ 2^53 − 1 so sums are always exact. | `B5/B10/B7…`, `B11: … too large` |
| B11 | Medium | Attack script | Balances in a plain object: paying to `"__proto__"` made the coin disappear (supply 100 → 99 visible). | `Map` storage + strict 40-hex addresses for recipients and genesis. | `B11: genesis and recipients cannot use prototype keys` |
| B7 | Low | Attack script | Any string was accepted as a recipient (`"hello"`), burning coins forever. | `to` must be a 40-hex-char address. | `B5/B10/B7…` |
| B9 | Low | Attack script | A garbage public key crashed the verifier with a raw `TypeError`. | Strict compressed-key format + on-curve check; `verifySignature` / `verifyTransfer` never throw. | `B9: public keys that are not exactly one valid compressed curve point…`, `verifyTransfer never throws on garbage` |

Also hardened (no exploit found, added on review): a domain string in the signed bytes so a transfer signature can never be reused for another message type; unexpected fields are refused (they would not be covered by the signature); wallets are frozen and never print the private key (`JSON.stringify`, `console.log`); private keys must be in 1 … n − 1.

## Known issues (accepted, with reasoning)

| ID | Severity | Issue | Why it stays for now |
|----|----------|-------|----------------------|
| K1 | Low | ECDSA uses OpenSSL's random *k*, not RFC 6979 deterministic *k*. A broken random generator that repeats *k* would leak the private key (PS3, 2010). | Node's `crypto` has no RFC 6979 option; OpenSSL's CSPRNG is the standard choice. Real wallets use libsecp256k1 (RFC 6979). |
| K2 | Low | Addresses have no checksum, so a typo can send coins to a valid-looking address nobody owns. | Bitcoin uses Base58Check / Bech32, Ethereum EIP-55 mixed case. Good exercise for the evening. |
| K3 | Info | No transaction fees, so spam is free. | Fees and mempool ordering arrive with blocks (Day 04) and front-running (Day 09). |
| K4 | Info | A nonce of 2^53 − 1 would lock an account. | Needs 9 quadrillion payments from one address. |

## Final green run

```
$ npm test
# tests 26
# pass 26
# fail 0

$ npm run attack
Mallory tried 13 attacks: 13 refused, 0 got through.

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

0 high / medium findings open.

## Evening audit

**Reviewer stance:** external auditor, fresh eyes, assuming the morning author missed things.
**Scope:** everything in `src/` after the morning fixes, plus the new evening code (checksummed addresses, exercise solutions).
**Method:** re-ran tests / ESLint / `npm audit` / the 13-attack script; then attacked what the morning attacks did not touch: who can change ledger state *without* a signature, how `applyAll` reads its list (holes, getters, proxies), what `genesis` accepts, which message types `sign` / `verify` accept (numbers, arrays > 255, lone surrogates), public-key encodings (x ≥ p aliases), and access control / replay / duplicate-signer tricks on the new 2-of-3 vault. Every real issue got a failing test **first** ([`test/evening-audit.test.js`](test/evening-audit.test.js): 6 of 7 failed before the fixes), then the fix. No Solidity, so Slither / Solhint do not apply.
**Rounds:** 3 (round 1: E1–E4; round 2: re-attacked the fixes: subclassing, `Object.defineProperty`, prototype patching → prototype frozen too; round 3: reviewed the exercise solutions, capped multisig approvals at the number of owners; final re-run clean).

| ID | Severity | How found | Description | Fix | Proving test |
|----|----------|-----------|-------------|-----|--------------|
| E1 | Medium | Manual (state-access review) | **Coins without a signature.** `balances`, `nonces`, `chainId` and `totalSupply` were public, writable fields. `ledger.balances.set(mallory, 1e6)` minted 1,000,000 coins (sum of balances 1,000,100, "supply" still 100), and `ledger.chainId = "lb-testnet"` made a testnet signature apply: the B8 cross-chain fix could be switched off from outside. | All state in private `#fields`; `chainId` / `totalSupply` are read-only getters; the instance, the prototype and the class are frozen; `accounts()` returns a copy. The only way to change state is a verified transaction. | `E1: ledger state cannot be changed without a signed transaction` |
| E2 | Low | Manual (fuzzing `applyAll` inputs) | **Silent holes.** `applyAll` used `forEach`, which skips holes: a batch with `length: 3` and one real payment returned 1 id and applied it. A block builder counting "3 transactions" would be wrong. | Copy the list first, reading each element exactly once; refuse holes (`transaction 1 is missing`); check on scratch state, then commit. | `E2: applyAll refuses holes and reads the list exactly once` |
| E3 | Low | Manual | **Wrong genesis type accepted.** `new Ledger(chain, new Map([[sita, 100]]))` created a ledger with supply **0** (a Map has no own enumerable keys); `null` crashed with a raw `TypeError`. | Genesis must be a plain object (prototype `Object.prototype` or `null`). | `E3: genesis must be a plain object…` |
| E4 | Low | Manual (input fuzzing) | **Message type confusion.** `sign` / `verify` passed anything to `Buffer.from`: `[360, 361]` became the bytes of `"hi"` (each number mod 256) and **verified as true**; lone surrogates `"\ud800"` / `"\udc00"` both became U+FFFD, so one signature fitted two strings (the Day 01 bug again); `verify(…, 5, sig)` **threw** although documented as "never throws". The transfer path was not affected (it always signs `JSON.stringify` bytes). | `messageBytes`: only `Buffer` / `Uint8Array` or well-formed strings. `sign` throws a clear error, `verify` returns `false`. | `E4: sign/verify take bytes or well-formed text only…` |

**Checked, not vulnerable:** a compressed key whose x is ≥ p (x = 1 + p, an alias of the valid x = 1) is refused by OpenSSL's point decoder, so one key cannot have two addresses (pinned by a test). A `Proxy` whose `ownKeys` throws gives `{ ok: false }`, not a crash. Subclassing `Ledger` cannot reach the private state.

### Known issues (after the evening)

| ID | Severity | Status |
|----|----------|--------|
| K1 | Low | Unchanged: random *k* from OpenSSL, not RFC 6979. |
| K2 | Low | **Fixed** by the evening improvement (checksummed addresses). Raw 40-hex addresses are still accepted *inside* transactions; the checksum protects the human step (typing / pasting) via `parseAddress`. |
| K3, K4 | Info | Unchanged (fees on Day 04 / 09; nonce 2^53 − 1). |
| K5 | Info | `wallet.sign(bytes)` signs whatever it is given. Code that lets an attacker choose the bytes could be tricked into signing a transfer. Domain strings stop *accidental* reuse, not a malicious caller; real wallets show the user what they sign (EIP-712). |

### Evening improvement

**Checksummed addresses** (`toChecksumAddress`, `isChecksumAddress`, `parseAddress`, `npm run typo`). The EIP-55 trick: hash the lowercase address and write letter *i* in upper case when hash nibble *i* is ≥ 8. Uses SHA-256 because Node has no Keccak-256, so it is not Ethereum-compatible. Result over 10,000 random one-character typos:

```
Sita's address        aa8a5b204a46be63be0862c239ac0911e70f9cab
with checksum         AA8A5b204a46BE63Be0862C239aC0911E70f9CAB

One-character typos tried: 10,000
caught by the checksum:    9,999 (99.99%)
missed:                    1
without a checksum:        0 caught, every typo sends coins to an address nobody owns
```

### Final green run (evening)

```
$ npm test          # 26 morning + 7 audit/improvement + 5 exercise-solution tests
# tests 38
# pass 38
# fail 0

$ npm run attack
Mallory tried 13 attacks: 13 refused, 0 got through.

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

**Result:** 0 high, 0 medium findings open. Morning: 2 high + 6 medium + 2 low fixed. Evening: 1 medium + 3 low fixed; 1 low + 3 info accepted.
