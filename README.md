# Learning Blockchain in 15 Days

A public, day-by-day log of mastering blockchain development — from hashing fundamentals to DeFi, upgradeable contracts, Layer 2 and zero-knowledge proofs.

> ### 📘 Free complete study guide (PDF, 84 pages)
> All 15 days in one book: Ethereum, Solidity smart contracts, ERC-20, NFTs, smart-contract security, DeFi, Layer 2, zero-knowledge proofs and more, explained in plain words with diagrams, tested code, security fixes, interview questions and exercises.
> **[Download the PDF](guide/Learning-Blockchain-Complete-Study-Guide.pdf)** · [About the guide](guide/)

Each day has its own folder with notes, working code, tests, a QA & security report, and exercises. Mornings cover the concept and code; evenings run QA, fix what breaks, and add exercises.

### Quality bar for every day

1. **Build** — concept notes + small, well-commented code
2. **Test** — unit tests (and fuzz/invariant tests for contracts)
3. **QA & security review** — lint, `npm audit`, static analysis (Slither / Solhint for Solidity), and a manual attack checklist
4. **Fix & repeat** — every bug found is logged in `QA.md`, fixed, and re-tested until the suite is green

**Day 0:** 14 October 2026 · **Day 1:** 15 October 2026 · **Day 15:** 29 October 2026
**Author:** [Manish Khadka](https://khadka-manish.com.np) · [LinkedIn](https://www.linkedin.com/in/manishkhadka1996) · [GitHub](https://github.com/Khadka1996)

---

## Roadmap

| Day | Date | Topic | What gets built | Status |
|----:|------|-------|-----------------|:------:|
| 00 | 14 Oct | [Setup](day-00) | Repo, tools, roadmap | ✅ |
| 01 | 15 Oct | [Hashing & SHA-256](day-01) | Hash explorer in Node.js | ✅ |
| **Phase 1 — Foundations** | | | | |
| 02 | 16 Oct | [Blocks, chains & Proof of Work](day-02) | Mineable blockchain with tamper detection | ✅ |
| 03 | 17 Oct | [Keys, signatures & transactions](day-03) | secp256k1 wallets, signed transfers, balances | ✅ |
| 04 | 18 Oct | [Merkle trees, forks & consensus](day-04) | Merkle proofs, longest-chain rule, P2P simulation | ✅ |
| **Phase 2 — Ethereum & Solidity** | | | | |
| 05 | 19 Oct | [Ethereum & the EVM](day-05) | Mini-EVM, gas, opcodes, storage layout — differential-tested against Hardhat | ✅ |
| 06 | 20 Oct | [Solidity fundamentals](day-06) | A tested ETH vault: events, modifiers, custom errors, reentrancy attack & fix, mutation testing | ✅ |
| 07 | 21 Oct | [ERC-20 tokens](day-07) | A token from scratch + the OpenZeppelin version (cap, permit), allowances, a vault that survives fee/USDT/callback tokens, differential + mutation testing | ✅ |
| 08 | 22 Oct | [NFTs: ERC-721 & ERC-1155](day-08) | An ERC-721 from scratch (differential-tested vs OpenZeppelin), a paid collection with royalties (ERC-2981) and a re-entrant-mint attack & fix, ERC-1155 game items | ✅ |
| **Phase 3 — Advanced** | | | | |
| 09 | 23 Oct | [Smart-contract security](day-09) | 5 broken contracts (re-entrancy, access control, tx.origin, front-running, DoS), a working exploit and a fix for each, fuzz invariants, Slither | ✅ |
| 10 | 24 Oct | [DeFi: AMM from scratch](day-10) | Constant-product (x·y=k) swap pool with a 0.3% fee and LP shares, a working sandwich bot vs slippage limits, donation & weird-token attacks, fuzz invariants | ✅ |
| 11 | 25 Oct | [Gas optimisation & upgradeable contracts](day-11) | The same contract written twice (up to 70% less gas, differential-fuzzed), measured gas reports, a UUPS proxy upgraded V1 → V2 without losing a balance, and the reordered-storage disaster | ✅ |
| 12 | 26 Oct | [Oracles, Layer 2 & bridges](day-12) | A price reader that refuses 6 kinds of bad price (stale, zero, glitch, L2 down), a simulated optimistic rollup whose fraud proof finds 1 lie in 1,000 txs in 10 steps, and a safe vs naive token bridge (replay & duplicate-signer attacks) | ✅ |
| 13 | 27 Oct | [Full-stack dApp](day-13) | A TipJar dApp: contract + plain HTML/JS page with ethers.js + MetaMask, deploy script for a local chain or Sepolia (secrets in `.env`, never in git), 11 browser tests clicking the real page (XSS, wrong network, Cancel, account switches) | ✅ |
| 14 | 28 Oct | [Zero-knowledge & account abstraction](day-14) | A circom + snarkjs proof of a secret checked on-chain (and a copied proof stolen from the mempool vs one bound to its recipient), plus an ERC-4337 smart wallet with a 1 ETH/day limit and guardian recovery; QA found and fixed a way past the limit through gas | ✅ |
| **Phase 4 — Capstone** | | | | |
| 15 | 29 Oct | [Capstone: certificate dApp + self-audit](day-15) | CertCheck: a registry where schools record certificate fingerprints (issuer roles, issue / batch / revoke, free verify), a web page that checks a file in ~2 ms with no wallet, 36 tests incl. browser E2E, and a professional self-audit that found and fixed 3 Medium + 1 Low (+ 1 Low in the evening review) | ✅ |

---

## Retrospective — 15 days of learning Blockchain

**What I built.** From one hash on Day 1 to a working certificate-checking app on Day 15: a mineable chain, signed transactions, Merkle proofs, a mini-EVM, tested Solidity contracts (vault, ERC-20, NFTs, an AMM, upgradeable proxies, an oracle reader, a bridge), a full-stack dApp, a zero-knowledge proof, an ERC-4337 wallet and the CertCheck capstone. Every day has runnable code, tests, a QA/security review and a PDF study guide.

**Every day, one link:**

| Day | Topic |
|----:|-------|
| 01 | [Hashing & SHA-256](day-01) |
| 02 | [Blocks, chains & Proof of Work](day-02) |
| 03 | [Keys, signatures & transactions](day-03) |
| 04 | [Merkle trees, forks & consensus](day-04) |
| 05 | [Ethereum & the EVM](day-05) |
| 06 | [Solidity fundamentals](day-06) |
| 07 | [ERC-20 tokens](day-07) |
| 08 | [NFTs: ERC-721 & ERC-1155](day-08) |
| 09 | [Smart-contract security](day-09) |
| 10 | [DeFi: AMM from scratch](day-10) |
| 11 | [Gas optimisation & upgradeable contracts](day-11) |
| 12 | [Oracles, Layer 2 & bridges](day-12) |
| 13 | [Full-stack dApp](day-13) |
| 14 | [Zero-knowledge & account abstraction](day-14) |
| 15 | [Capstone: certificate dApp + self-audit](day-15) |

**5 lessons learned**

1. **A hash is a fingerprint, and that idea carries everything.** Blocks, Merkle trees, signatures, certificates and ZK locks all start from it (Days 1, 2, 4, 14, 15).
2. **Blockchain code is hard to fix after launch, so test like an attacker before it ships.** Re-entrancy, front-running, bad oracles and bridge replays all appeared in my own code until a test caught them (Days 6, 9, 10, 12).
3. **Everything public can be copied.** A transaction in the mempool, a proof, a hash of a guessable secret: design so that a copy cannot hurt you (Days 9, 14, 15).
4. **Ask who is allowed to do what, and who can take it back.** Most bugs I found were about roles: a removed issuer who could still revoke, a guardian who was also the owner, a registry left with no admin (Days 9, 14, 15).
5. **A passing test is only proof of what it checks.** Reviewing a second time, as a stranger, found a bug every single day. Write the failing test first, then the fix.

**Next steps.** Deploy CertCheck to Sepolia with a multisig admin; read a real audit report end to end; learn Foundry for fuzzing and invariants; write a circom circuit that does something useful; get an independent human review before any real money or real certificates depend on it.

---

## Repository structure

```
Learning-Blockchain/
├── day-00/        # setup notes
├── day-01/        # each day: README (notes) + code + exercises
│   ├── README.md      # concept notes + results
│   ├── src/           # code (contracts/ for Solidity days)
│   ├── test/          # unit, fuzz & invariant tests
│   ├── QA.md          # bugs & security findings → fixes
│   ├── exercises/     # easy / medium / challenge + solutions
│   └── notes.pdf      # printable study guide with references
├── ...
└── day-15/
```

## Tech stack

- **Languages:** JavaScript (Node.js), Solidity
- **Tooling:** Hardhat, Foundry, ethers.js, OpenZeppelin, Slither, Solhint, circom
- **Network:** Sepolia testnet (no real money involved)
- **Wallet:** MetaMask

## Running any day's code

```bash
git clone https://github.com/Khadka1996/Learning-Blockchain.git
cd Learning-Blockchain/day-01
npm install
npm start
```

Each day's README lists its exact commands.

---

## Follow along

Progress is posted on [LinkedIn](https://www.linkedin.com/in/manishkhadka1996) every morning and evening. Suggestions and corrections are welcome — open an issue.

## License

[MIT](LICENSE)
