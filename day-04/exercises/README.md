# Day 04 — Exercises

Try each one before opening [`solutions/`](solutions/). All solutions are tested (`npm test`).

```bash
npm run ex:easy        # how long is a Merkle proof, without building the tree?
npm run ex:medium      # find which payments differ between two trees, top-down
npm run ex:challenge   # one proof for many payments (multiproof)
```

## 1. Easy — Proof length without building the tree

**Goal:** Write `proofLength(leafCount, index)` that returns how many sibling hashes the proof for leaf `index` contains, using only arithmetic (no hashing). Check it against `merkleProof(...).siblings.length` for every tree size 1…64 and every index. Then explain why, in a tree of 5 leaves, leaf 4 needs only **1** hash while leaf 0 needs 3.

**Hint:** Walk up level by level like `verifyProof` does: an odd index always has a left sibling; an even index has a right sibling only if `index + 1 < width`; otherwise the node moves up unchanged (no sibling). The next width is `ceil(width / 2)`.

## 2. Medium — Spot the difference, top-down

**Goal:** Two nodes each hold 1,024 payments and their Merkle roots differ. Write `findDifferences(leavesA, leavesB)` that returns the indexes of the leaves that differ **and** how many hashes were compared. Start at the top; only go down into a subtree whose hashes differ. Compare the cost against checking all 1,024 leaves.

**Hints:**
- Build every level with the exported `leafHash` / `nodeHash` (odd node moves up unchanged, as in `merkle.js`).
- Two subtrees with the same hash are identical below, so skip them. This is how Git, Cassandra's anti-entropy repair and Certificate Transparency compare large data sets.
- Both lists must have the same length; refuse anything else with a clear error.

## 3. Challenge — One proof for many payments (multiproof)

**Goal:** A shop wants to prove that 8 of the 1,000 payments in a block are inside, with fewer hashes than 8 separate proofs. Write `multiProof(leaves, indexes)` and `verifyMultiProof(items, proof, root)` where `items` is `[{ index, leaf }]`. It must return `false` (never throw) for a wrong leaf, a wrong index, a duplicate index, a missing hash or an extra hash.

**Hints:**
- At each level, keep the set of positions you already know. A sibling you can compute yourself is **not** put in the proof; only the others are, in a fixed order (level by level, left to right).
- The verifier must use every proof hash **exactly once**, and decide left/right from the index and leaf count only (same rule as the morning's M1 fix).
- Finish with the same root step as `merkleRoot`: `finalRoot(leafCount, top)`.
