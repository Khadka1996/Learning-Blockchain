# Day 03 — Exercises

Try each one before opening [`solutions/`](solutions/). All solutions are tested (`npm test`).

```bash
npm run ex:easy        # signed notes
npm run ex:medium      # pick pending payments for the next block
npm run ex:challenge   # 2-of-3 shared vault
```

## 1. Easy — Sign a note, not a payment

**Goal:** Write `signNote(wallet, text)` and `verifyNote(publicKey, text, signature)` so Sita can sign *"I, Sita, agree to meet Ram at 5 pm."*. Show that the note fails to verify if one word changes or if Ram's key is used, and that Mallory **cannot** reuse the note signature as a payment from Sita.

**Hint:** Sign `JSON.stringify(["learning-blockchain/note", text])`, not the raw text. Transfers sign a different first element (`"learning-blockchain/transfer"`), so the two kinds of signature can never be swapped. This is called *domain separation*. Refuse text that is not well-formed Unicode (Day 01).

## 2. Medium — What goes into the next block?

**Goal:** Payments reach a node in any order. Write `selectForBlock(ledger, pending)` returning `{ selected, dropped, waiting }`, where `ledger.applyAll(selected)` always succeeds. Test with: Ram → Hari arriving *before* Sita has paid Ram; Sita's nonce 1 arriving before nonce 0; the same payment twice; and a nonce 5 when 2–4 never arrived.

**Hints:**
- Per sender, only the **next** nonce can go in. A nonce that is too high waits (Ethereum calls this "queued"); too low can never be valid.
- One payment can fund another (Sita → Ram → Hari), so repeat passes over the pool until nothing more fits.
- Keep your own running balances and nonces; don't touch the ledger until the end.

## 3. Challenge — A 2-of-3 shared vault

**Goal:** Sita, Ram and Hari share a vault with 100 coins. Money may move only when **2 different owners** sign the **exact same** payment. Build `makePolicy(threshold, publicKeys)`, an address for the vault, and `Vault.spend(payment, approvals)`. Mallory must fail with: one signature, the same owner twice, an outsider's signature, owners signing different amounts, and replaying a used approval set.

**Hints:**
- The vault's address must commit to the threshold **and** the sorted keys, so "1-of-3" and "2-of-3" with the same people are different vaults.
- Count *distinct* signers that belong to the policy. Bitcoin's original `CHECKMULTISIG` had an off-by-one bug that still forces a dummy element today ([BIP 147](https://github.com/bitcoin/bips/blob/master/bip-0147.mediawiki)): count carefully.
- Put chain id, vault address and nonce inside the signed bytes (replay protection, as in the morning).
