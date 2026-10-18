# Day 04 — QA & security review

**Scope:** `src/` (Merkle tree + proofs, block header + PoW, full node with fork choice / orphans / reorgs, P2P simulator, three CLI scripts). Plain Node.js, no Solidity today, so Slither / Solhint do not apply.
**Method:** As on Day 03, I first wrote a short "tutorial-style" v1 ([`qa/v1-attack.js`](qa/v1-attack.js): Bitcoin-style Merkle tree without tags, "longest chain = most blocks", difficulty read from the block, unlimited orphans) and attacked it. Then I wrote the real version, a regression test per finding, and attacked it again with the checklist in [`tools/README.md`](../tools/README.md): bad inputs, edge cases, forged / replayed / overspent payments inside blocks, time-of-check / time-of-use, denial of service (memory, stuck node), fork-choice manipulation, timestamps.
**Rounds:** 3 (round 1: v1 attacked, 4 findings · round 2: real version, design review + test suite, 4 findings · round 3: re-attack + full suite, clean).

### Round 1 — v1 attack output (before fixes)

```
A1 [a,b,c] and [a,b,c,c] share a root?                                         true
A2 64-byte inner node proven as a 'transaction'?                               true
A3 attacker chain with ~8 guesses of work beats honest chain with ~131,000?    attacker work 8, honest 131072
A4 100,000 junk orphans kept in memory?                                        100000
```

### Round 2 — real version (before fixes M2, F1)

```
runs ending split: 70 /199
receive: added
NODE STUCK: own block refused: transaction 0 rejected: signature is not valid for this sender and these exact contents (nothing was applied)
```

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| A3 | **High** | Attack script | **Cheap chain wins.** v1 followed the chain with the most *blocks* and trusted the difficulty written in each block. An attacker's 4 blocks at 1 bit (~8 guesses in total) beat 2 honest blocks worth ~131,000 guesses, so the attacker could rewrite history for free. | Fork choice by **total work** (Σ 2^bits); `bits` must equal the network's rule, and the hash must really have that many zero bits. | `A3: difficulty is a network rule…`, `fork choice: equal work keeps…` |
| A1 | Medium | Attack script | **Duplicate-last trick (CVE-2012-2459).** Pairing an odd node with itself gave `[a,b,c]` and `[a,b,c,c]` the same root, so a valid block could be "mutated" into an invalid one with the same hash (Bitcoin's 2012 split risk). | The last node of an odd level moves up unchanged; the root also commits to the leaf count. | `A1: [a,b,c] and [a,b,c,c] have different roots…` |
| A2 | Medium | Attack script | **Second preimage.** Leaves and inner nodes were hashed the same way, so the 64 bytes of an inner node verified as a "transaction" in the block. | Domain tags: leaf `H(0x00‖·)`, node `H(0x01‖·‖·)` (RFC 6962). | `A2: an inner node's 64 bytes cannot be proven as a leaf` |
| A4 | Medium | Attack script | **Memory DoS.** v1 kept every block whose parent was unknown, forever. | Orphans must pass shape, difficulty and PoW checks first; pool capped at 100 (oldest dropped). | `A4: the orphan pool is bounded` |
| M1 | Medium | Manual (design review) | **A proof could lie about the position.** In a 3-leaf tree, leaf 2's path `[H(a,b)]` also proved "leaf 1 of a 2-leaf tree" against the same root. | The root hashes the leaf count: `H(0x02‖count‖top)`; left/right is computed from `index` + `leafCount`, never taken from the proof; every sibling must be used exactly once. Mutation check: removing the count makes 3 tests fail. | `M1: a proof cannot lie about the number of leaves or the position` |
| M2 | Medium | Manual (round 2) | **One payment bricks the node.** Blocks stored the peer's own transaction objects. A payment whose `amount` getter said `1` while the block was checked and `100` afterwards made every later replay of the chain fail: the node could never accept another block. | `readTxs` freezes a plain copy of every transaction (Day 03's `snapshot`); the node only ever uses those copies. | `M2: a payment with a getter cannot change after the block is accepted` |
| F1 | Low | Property test | **Simulation ended split.** 70 of 199 slow runs ended with nodes on different equal-work tips, so "all nodes agree" was not guaranteed. This is real network behaviour (a tie lasts until the next block), not a node bug. | After mining stops, the simulator mines one more block once the network is quiet; reported as `splitAtEnd`. | `F1: a tie at the end is broken by one more block…`, `property: whatever the timing…` |
| L2 | Low | Manual (round 2) | `mine()` spent Proof-of-Work on blocks with bad payments and only failed afterwards. | Check the payments against the tip's balances before mining. | `L2: mining refuses bad payments before doing any work` |

Also verified and kept (no change needed): forged, replayed (within and across blocks) and overspent payments make a block invalid; wrong chain id, height, parent time, Merkle root, `hash` field or extra fields are refused; a block more than 2 hours in the future is refused; `receive` and `verifyProof` never throw on 500 random inputs each; children of an invalid block are never connected; 30 blocks delivered in reverse order all connect; node, prototype and network rules are frozen.

## Known issues (accepted for a teaching node)

| ID | Severity | Description | Why it is accepted |
|----|----------|-------------|--------------------|
| K1 | Low | Each block is checked by replaying balances from genesis (O(height) per block). | Fine for hundreds of blocks. Real nodes keep the current state plus "undo data" per block for reorgs. |
| K2 | Low | An attacker who pays the (tiny, 8–12 bit) Proof of Work can push honest blocks out of the 100-slot orphan pool. | The honest block is simply requested again from a peer, as the simulator does. Real difficulty makes this expensive. |
| K3 | Info | No deep-reorg limit, and payments from a losing block are not put back in a waiting room (mempool). | The mempool is a future step; finality limits come with Proof of Stake (Ethereum's Casper FFG). |
| K4 | Info | A miner may set its timestamp up to 2 hours ahead. | Same rule as Bitcoin. There is no difficulty adjustment today, so time cannot be "warped" for profit. |

## Final run

```
$ npm test
# tests 25
# pass 25
# fail 0

$ npm run lint
> eslint .            (no problems)

$ npm audit --omit=dev
found 0 vulnerabilities
```

## Evening audit

**Reviewer stance:** external auditor, fresh eyes, assuming the morning author missed things.
**Scope:** everything in `src/` after the morning fixes, plus the new evening code (light client `src/spv.js`, exercise solutions).
**Method:** re-ran tests / ESLint / `npm audit` / the v1 attack script; then attacked what the morning did not touch: *what exactly does the block hash cover?* (Day 03's `txId` leaves the signature out), what a node does with a copy of a block that has the same hash but different bytes, how often an invalid block can be made to cost a full re-check, what happens to the children of an invalid block, and how the public read API (`chain`, `ledgerAt`) handles unknown hashes. Every real issue got a failing test **first** ([`test/evening-audit.test.js`](test/evening-audit.test.js): 5 of 8 failed before the fixes), then the fix. No Solidity, so Slither / Solhint do not apply.
**Rounds:** 3 (round 1: E1–E3 found, tests written, fixed; round 2: re-attacked the fixes — a temporary failure (block from the future) and a wrong `hash` field must **not** be blacklisted; property test with honest blocks, mutated copies and invalid branches in random order; round 3: reviewed the light client and exercise solutions with fuzz tests that they never throw; final re-run clean).

### Round 1 — attack output (before fixes)

```
Mallory sends block 2 with one broken signature, before the victim has block 1
real block 2 → duplicate                 ← the honest block is thrown away
victim tip height 1, honest height 2, Ram 0 coins (should be 30)

20 resends of one invalid block at height 100: 2,044 ms   (≈100 ms of replay + signature checks each)
```

After the fixes the same script ([`qa/evening-attack.js`](qa/evening-attack.js), `npm run attack:evening`) prints `real block 2 → orphan`, `victim tip height 2 … Ram 30`, and `20 resends … 96 ms` (only the first one is checked).

| ID | Severity | How found | Description | Fix | Proving test |
|----|----------|-----------|-------------|-----|--------------|
| E1 | **Medium** | Manual (what does the hash commit to?) | **Same hash, different block.** Merkle leaves were Day 03 `txId`s, which **exclude the signature**. A copy of a block with a broken signature had the *same* hash and passed the Merkle check. Sent as an orphan **before** the real block, it made the node drop the honest block as a "duplicate"; when the parent arrived, the fake failed and the victim was stuck one block behind (Ram's 30 coins missing). Sita could also re-sign her own payment (random *k*) and make two different blocks with one hash. Bitcoin had the same class of problem ("mutated blocks", fixed by the BIP 141 witness commitment). | Merkle leaf = `JSON["learning-blockchain/tx-leaf", txId, signature]`: the block hash now covers every signature. A copy with any changed byte fails the Merkle check before it is stored. | `E1: the block hash commits to every signature…`, `E1: a mutated copy sent first cannot block the real block…` |
| E2 | Low | Manual (DoS review) | **Free re-checks.** A block that failed a permanent rule (bad payment, wrong height, time before parent) was forgotten, so re-sending it cost a full ledger replay every time (~100 ms at height 100) for one Proof of Work. Its children were parked as orphans and took slots in the pool. | Remember invalid hashes (bounded set, 10,000); a block whose parent is invalid is invalid too, also for orphans already waiting (Bitcoin Core's `BLOCK_FAILED_CHILD`). Only *permanent* failures are remembered: a block from the future or a wrong `hash` field is not. Safe only **because** of E1. | `E2: a block that failed for good is remembered…`, `E2: an orphan whose parent turns out invalid…`, `E2: a temporary failure … is NOT remembered`, `E2: … 'hash' field … not blacklisted` |
| E3 | Low | Manual (API fuzzing) | `node.chain(hash)` / `ledgerAt(hash)` with an unknown hash crashed with `TypeError: Cannot read properties of undefined`. | Clear `RangeError("unknown block …")`. | `E3: asking about an unknown block gives a clear error…` |

**Checked, not vulnerable:** honest blocks + mutated copies + an invalid side branch delivered in any order, with repeats, always end on the honest tip with an empty orphan pool (property test, 200 runs). The light client never throws on 300 random inputs, refuses headers with the wrong difficulty, without real work or with an unknown parent, and refuses payments in a block on a losing branch.

### Known issues (after the evening)

| ID | Severity | Status |
|----|----------|--------|
| K1 | Low | Unchanged (replay from genesis per block). It is now visible: the 30-block light-client demo takes ~18 s, almost all of it in the full node. |
| K2 | Low | Unchanged (orphan pool eviction). The invalid set can be evicted the same way; the cost is only a re-check. |
| K3, K4 | Info | Unchanged (no mempool / deep-reorg limit; 2-hour future timestamps). |
| K5 | Info | **New.** A block has a 1,000-transaction limit but no **byte** limit; a huge signature string is hashed (after the PoW check) before it is refused. Real chains cap block weight (Bitcoin) or gas (Ethereum). |
| K6 | Info | **New.** A light client trusts that full nodes checked the payments: a chain with the most work but invalid payments would fool it (Bitcoin whitepaper §8). Fraud proofs / validity proofs come on Day 12 and 14. |

### Evening improvement

**A light client (SPV)** — [`src/spv.js`](src/spv.js), `npm run spv`. It stores only headers, follows the header chain with the most work, and checks "is my payment in block X, and how deep?" with a Merkle proof from a full node:

```
1. A full node has 30 blocks with 600 payments: 205,611 bytes
   The phone keeps only the 30 headers:            5,986 bytes (34× less)

2. "Sita paid Ram 25 coins in block 5" + a 5-hash proof (160 bytes)
   phone says: paid, 26 confirmations deep

3. Server claims it was 250 coins → refused: Merkle proof does not match the block
4. Payment in a block that lost a fork → refused: block is not on the best chain (stale branch)
5. Header without real Proof of Work → rejected: not enough Proof of Work
```

### Final green run (evening)

```
$ npm test          # 25 morning + 9 audit + 6 light-client + 4 exercise-solution tests
# tests 44
# pass 44
# fail 0

$ npm run lint
eslint: 0 problems

$ npm audit --omit=dev
found 0 vulnerabilities
```

**Result:** 0 high, 0 medium findings open. Morning: 1 high + 5 medium + 2 low fixed. Evening: 1 medium + 2 low fixed; 2 low + 4 info accepted.
