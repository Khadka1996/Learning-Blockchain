# Day 02 — Exercises

Try each one before opening [`solutions/`](solutions/). All solutions are tested (`npm test`).

```bash
npm run ex:easy        # run the easy solution
npm run ex:medium      # run the medium solution
npm run ex:challenge   # run the challenge solution
```

## 1. Easy — Where does the chain break?

**Goal:** Write `findBreak(blocks, difficulty)` that returns `null` for a valid chain, or `{ firstBad, reason, mustRemine }`: the first invalid block, why, and how many blocks an attacker would have to re-mine to hide the edit. Test it by editing block 0, 1 and 4 of the demo chain.

**Hint:** `validateBlocks` already stops at the *first* bad block. Everything from there to the tip depends on it through `prevHash`, so all of it must be re-mined.

## 2. Medium — Why wait for 6 confirmations?

**Goal:** Implement Satoshi's formula from §11 of the [Bitcoin whitepaper](https://bitcoin.org/bitcoin.pdf): the probability that an attacker with a share `q` of all hash power ever catches up from `z` blocks behind. Reproduce the paper's tables (for `q = 0.1`: z=1 → 0.2045873, z=5 → 0.0009137) and its "z needed for P < 0.1%" table.

**Hints:**
- While the honest network finds `z` blocks, the attacker's progress is Poisson-distributed with λ = z·q/p (p = 1 − q).
- From `z − k` blocks behind, the catch-up chance is (q/p)^(z−k) (the gambler's ruin).
- `P = 1 − Σ_{k=0..z} Poisson(k; λ) · (1 − (q/p)^(z−k))`. If q ≥ p the answer is simply 1.

## 3. Challenge — Check Bitcoin's real Proof of Work

**Goal:** Bitcoin does not store "difficulty in bits"; its header has a 4-byte compact target called **`bits`** (`0x1d00ffff` in the genesis block). Write `compactToTarget(bits)` and `checkHeaderPow(headerHex)` that double-SHA-256es an 80-byte header and checks **hash ≤ target**. Verify the genesis block, then show that nonce + 1 fails.

**Hints:**
- `bits` = 1 byte exponent E + 3 bytes mantissa M; target = M × 256^(E−3). Test vectors are in the [Bitcoin developer reference](https://developer.bitcoin.org/reference/block_chain.html#target-nbits) (`0x05009234` → `0x92340000`).
- `0x00800000` is a sign bit. A "negative" target is invalid.
- Read the hash as a **little-endian** number: reverse the 32 bytes, exactly as when displaying the block id (Day 01 exercise 2).
