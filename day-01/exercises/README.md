# Day 01 — Exercises

Try each one before opening [`solutions/`](solutions/). All solutions reuse `src/lib.js` and are tested.

```bash
npm run ex:easy        # run the easy solution
npm run ex:medium      # run the medium solution
npm run ex:challenge   # run the challenge solution
npm test               # includes the solution tests
```

## 1. Easy — Spot the tampered record

**Goal:** You are given a list of records, each with the SHA-256 hash that was published when it was created. Some records were edited afterwards. Write `findTampered(records)` that returns the ids of the records whose current text no longer matches its published hash.

```js
[{ id: 1, text: "Pay Sita 5 coins", publishedHash: "…" }, …]
```

**Hint:** Re-hash each record's text with `sha256Hex` and compare. One changed character is enough to break the match — that is the avalanche effect from this morning.

## 2. Medium — Verify Bitcoin's very first block

**Goal:** Bitcoin does not use SHA-256 once; it uses **double SHA-256** (`SHA-256(SHA-256(x))`, called `hash256`). Write `hash256(bytes)` and use it on the 80-byte header of the Bitcoin genesis block (given in hex in the solution) to reproduce its famous id:

```
000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f
```

Then count its leading zero hex digits — that is the Proof of Work Satoshi did in January 2009.

**Hints:**
- Hash the raw **bytes** (`Buffer.from(hex, "hex")`), not the hex text.
- Bitcoin displays hashes **byte-reversed** (little-endian). Reverse the 32 bytes before printing.

## 3. Challenge — Commit–reveal (sealed-envelope voting)

**Goal:** Build a commitment scheme for a game of rock–paper–scissors played over the internet: each player first publishes `commit = sha256(salt ‖ choice)`, and only after both commitments are public do they reveal `salt` and `choice`.

Write `commit(choice)`, `verify(commitment, choice, salt)` and an attacker function `crackUnsalted(commitment)` that shows **why the salt is required**: without it, anyone can recover a choice by hashing the three possible moves.

**Hints:**
- Use 32 random bytes from `crypto.randomBytes` as the salt.
- Put a separator (or fixed-length salt) between the parts, so `salt+choice` can't be re-split differently.
- Compare hashes with `crypto.timingSafeEqual`, and reject malformed input (wrong length, not hex, unknown move).
- This exact idea appears again on Day 09 (front-running) — commit–reveal is a classic defence.
