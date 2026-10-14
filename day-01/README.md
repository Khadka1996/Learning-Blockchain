# Day 01 — Hashing & SHA-256

> Every blockchain is built on one simple tool: the **cryptographic hash function**. Today is about understanding it properly.

## What is a hash?

A hash function takes **any input** (a word, a transaction, a 2 GB file) and returns a **fixed-size fingerprint**. Bitcoin and Ethereum-era tooling lean heavily on **SHA-256**, which always outputs 256 bits (64 hex characters).

```
"Hello, Blockchain!"  →  7526b1d2bc17587443fbf1fafb27e95d70615bc7576c6e34c1f139c9ce857733
```

## The 5 properties that make hashes useful for blockchain

| Property | Meaning | Why blockchain needs it |
|---|---|---|
| **Deterministic** | Same input → same output, always | Every node can verify the same data independently |
| **Fixed size** | Output is always 256 bits | Blocks can reference each other compactly |
| **Fast to compute** | Hashing is cheap | Verification is quick for everyone |
| **Avalanche effect** | 1 tiny change → ~50% of bits flip | Tampering with data is instantly visible |
| **One-way (preimage resistant)** | You can't reverse a hash to get the input | Enables Proof of Work and commitments |

Plus **collision resistance**: it's practically impossible to find two different inputs with the same hash.

## Code

No dependencies — just Node.js's built-in `crypto` module.

```bash
cd day-01
npm start                      # hash a string, check determinism & fixed size
npm run avalanche              # 1-character change → how many bits flip?
npm run preimage               # brute-force a hash with 5 leading zeros
npm run fingerprint            # SHA-256 fingerprint of a file
node src/hash.js "your text"   # hash anything you want
```

| File | What it shows |
|---|---|
| [`src/hash.js`](src/hash.js) | Basic SHA-256, determinism, fixed output size |
| [`src/avalanche.js`](src/avalanche.js) | Counts how many of the 256 bits change when you edit one character |
| [`src/preimage.js`](src/preimage.js) | Why hashes are one-way — the brute-force idea behind mining |
| [`src/file-fingerprint.js`](src/file-fingerprint.js) | Hashing files to detect tampering |

## Results from my run

**Avalanche effect** — changing `10 coins` to `11 coins`:

```
A: c8eb8907d8041eed49180b850883d1d7d3d06cfa5ad4a4d206ef3f31cd25b1dc
B: 3e536e8a54b5d083c8456b6a109696f97efcb552f80fc20d6572a47a52ff90b5
Bits changed: 137 / 256 (53.5%)
```

One character changed and more than half the fingerprint flipped. That's why nobody can quietly edit a transaction.

**Brute-forcing 5 leading zeros:**

```
Hash     : 000001370acec5b212ad7957f57cb6d908dcb3870de98c4c05e3fabb92d3fe5a
Attempts : 742,576 in 787 ms  (expected ~1,048,576)
```

Each extra zero makes this ~16× harder. Bitcoin miners do exactly this at enormous scale — that's **Proof of Work** (Day 03).

## Key takeaways

1. A hash is a **fingerprint**: tiny, unique, and impossible to fake.
2. The **avalanche effect** is what makes blockchain data tamper-evident.
3. **One-way + brute force = mining.** The only way to find a hash with a given pattern is to guess.

## Coming next

**Day 02 — Blocks & chains:** put hashes inside blocks, link each block to the previous one's hash, and watch the whole chain break when one block is edited.
