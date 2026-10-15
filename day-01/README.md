# Day 01 — Hashing & SHA-256

> Every blockchain is built on one simple tool: the **cryptographic hash function**. Today is about understanding it properly — and testing it like production code.

## What is a hash? (plain words)

A hash function takes **any input** — a word, a payment, a 2 GB file — and returns a **short, fixed-size fingerprint**. Bitcoin uses **SHA-256**, which always outputs 256 bits (64 hex characters).

Think of it like a fingerprint for data: tiny compared to the person, unique to them, and you can't rebuild the person from the print.

```
"Hello, Blockchain!"  →  7526b1d2bc17587443fbf1fafb27e95d70615bc7576c6e34c1f139c9ce857733
```

```mermaid
flowchart LR
    A["any data<br/>(text, payment, file)"] --> H{{"SHA-256"}}
    H --> F["256-bit fingerprint<br/>64 hex characters"]
    F -. "impossible to go back" .-> A
```

## The properties that make hashes useful for blockchain

| Property | Meaning | Why blockchain needs it |
|---|---|---|
| **Deterministic** | Same input → same output, always | Every computer can check the same data independently |
| **Fixed size** | Output is always 256 bits | Blocks can point to each other with a short reference |
| **Fast to compute** | Hashing is cheap | Checking is quick for everyone |
| **Avalanche effect** | 1 tiny change → ~50% of bits flip | Tampering is instantly visible |
| **One-way (preimage resistant)** | You can't reverse a hash to get the input | Enables Proof of Work and commitments |
| **Collision resistant** | Practically impossible to find two inputs with the same hash | A fingerprint can safely stand in for the data |

## Code

No runtime dependencies — just Node.js's built-in `crypto` module. Dev tools: Node's test runner, [fast-check](https://fast-check.dev) (fuzzing) and ESLint.

```bash
cd day-01
npm install                    # dev tools only (tests + lint)
npm start                      # hash a string, check determinism & fixed size
npm run avalanche              # 1-character change → how many bits flip?
npm run avalanche:stats        # average over 10,000 random 1-character edits
npm run preimage               # brute-force a hash with 5 leading zeros
npm run preimage:table         # difficulty table for 1–5 zeros, generated from code
npm run fingerprint            # SHA-256 fingerprint of a file
node src/hash.js "your text"   # hash anything you want
node src/file-fingerprint.js <file> <expected-hex>   # verify a file is unchanged
npm test                       # 33 tests: official vectors, fuzzing, edge cases, audit, exercises
npm run lint
```

| File | What it shows |
|---|---|
| [`src/lib.js`](src/lib.js) | All logic as small, validated, side-effect-free functions |
| [`src/hash.js`](src/hash.js) | Basic SHA-256, determinism, fixed output size |
| [`src/avalanche.js`](src/avalanche.js) | Counts how many of the 256 bits change when you edit one character |
| [`src/preimage.js`](src/preimage.js) | Why hashes are one-way — the brute-force idea behind mining |
| [`src/file-fingerprint.js`](src/file-fingerprint.js) | Hashing and verifying files to detect tampering |
| [`test/lib.test.js`](test/lib.test.js) | NIST test vectors, fast-check property tests, QA regression tests |
| [`test/evening-audit.test.js`](test/evening-audit.test.js) | Evening audit: one failing-first test per finding (E1–E5) |
| [`exercises/`](exercises/) | 3 exercises (easy / medium / challenge) with tested solutions |
| [`notes.pdf`](notes.pdf) | Printable study guide: concept, code walkthrough, results, interview questions, references |
| [`QA.md`](QA.md) | Bugs found while attacking my own code, and how each was fixed |

## Results from my run

**Avalanche effect** — changing `10 coins` to `11 coins`:

```
A: "Manish sends 10 coins"
   c8eb8907d8041eed49180b850883d1d7d3d06cfa5ad4a4d206ef3f31cd25b1dc
B: "Manish sends 11 coins"
   3e536e8a54b5d083c8456b6a109696f97efcb552f80fc20d6572a47a52ff90b5

Bits changed: 137 / 256 (53.5%)
```

One character changed and more than half the fingerprint flipped. That's why nobody can quietly edit a transaction.

**Is that just luck?** `npm run avalanche:stats` repeats the experiment 10,000 times with random messages:

```
Random 1-character edits : 10,000
Average bits flipped     : 127.93 / 256 (49.97%)
Fewest / most flipped    : 99 / 156
```

Almost exactly half, every time — what a good hash function should do. (The numbers vary slightly per run because the messages are random.)

**Brute-forcing leading zeros** (one-way-ness in action):

| Leading zeros | Attempts needed (my run) | Expected on average |
|---:|---:|---:|
| 1 | 23 | 16 |
| 2 | 193 | 256 |
| 3 | 13,699 | 4,096 |
| 4 | 37,213 | 65,536 |
| 5 | 742,576 | 1,048,576 |
| 6 | 16,325,200 (≈ 44 s) | 16,777,216 |

```
Target prefix : 00000
Found input   : "manish-742575"
Hash          : 000001370acec5b212ad7957f57cb6d908dcb3870de98c4c05e3fabb92d3fe5a
Attempts      : 742,576 in 1952 ms
```

Each extra zero makes the search ~16× harder on average. There is no shortcut — only guessing. Bitcoin miners do exactly this at enormous scale; that's **Proof of Work** (Day 02).

**Quality:** 20 / 20 tests pass, ESLint clean, `npm audit` 0 vulnerabilities. 8 issues found and fixed while attacking the code — see [QA.md](QA.md).

## Key takeaways

1. A hash is a **fingerprint**: tiny, unique, and impossible to fake.
2. The **avalanche effect** (~50% of bits flip) is what makes blockchain data tamper-evident.
3. **One-way + brute force = mining.** The only way to find a hash with a given pattern is to guess.
4. Hash the **exact bytes** you mean: "café" typed two different ways gives two different hashes (see QA F7).

## References

- [NIST FIPS 180-4 — Secure Hash Standard (SHA-256 specification)](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)
- [NIST — SHA-256 example values (test vectors)](https://csrc.nist.gov/projects/cryptographic-standards-and-guidelines/example-values)
- [Bitcoin whitepaper — Satoshi Nakamoto (2008)](https://bitcoin.org/bitcoin.pdf)
- [Mastering Bitcoin, 3rd ed. — Antonopoulos & Harding (open source)](https://github.com/bitcoinbook/bitcoinbook)
- [Node.js `crypto` documentation — `createHash`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)
- [Bitcoin Developer Guide — Block chain (how hashes link blocks)](https://developer.bitcoin.org/devguide/block_chain.html)

## Evening update

An independent audit pass this evening found **5 more issues** (1 medium, 3 low, 1 info) — all fixed with a failing test first. Full table in [QA.md → Evening audit](QA.md#evening-audit).

- **The big one (E1): a real collision.** JavaScript strings can contain "half characters" (lone UTF-16 surrogates). Node quietly swaps them for `�` before hashing, so `"\uD800"`, `"\uDC00"` and `"\uFFFD"` all gave the **same** hash. The library now refuses malformed strings, and a 5,000-case fuzz test proves accepted strings never collide.
- **A race (E2):** the file check and the file read used the path twice; now the file is opened once and the open handle is checked.
- **Small CLI fixes:** `hash.js ""` now really hashes the empty string; number parsing is strict everywhere.
- **Improvement:** `npm run preimage:table` generates the difficulty table above from code, and a test pins its numbers.
- **Exercises:** [spot the tampered record, verify Bitcoin's genesis block with double SHA-256, and build a commit–reveal scheme](exercises/README.md).

**Quality now:** 33 / 33 tests pass, ESLint clean, `npm audit` 0 vulnerabilities.

## What I'd explore next

- **SHA-256 internals:** walk one 512-bit block through the 64 compression rounds (FIPS 180-4 §6.2) and see *where* the avalanche comes from.
- **Length-extension attacks:** why `sha256(secret ‖ message)` is not a safe signature, and why HMAC / SHA-3 fix it.
- **Keccak-256:** Ethereum's hash (not quite NIST SHA3-256) — compare outputs ahead of Day 05.

## Coming next

**Day 02 — Blocks, chains & Proof of Work:** put hashes inside blocks, link each block to the previous one's hash, mine them with the brute-force search from today, and watch the whole chain break when one block is edited.
