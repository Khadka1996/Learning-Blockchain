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
