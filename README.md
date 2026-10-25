# Learning Blockchain in 15 Days

A public, day-by-day log of mastering blockchain development — from hashing fundamentals to DeFi, upgradeable contracts, Layer 2 and zero-knowledge proofs.

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
| 11 | 25 Oct | [Gas optimisation & upgradeable contracts](day-11) | The same contract written twice (up to 70% less gas, differential-fuzzed), measured gas reports, a UUPS proxy upgraded V1 → V2 without losing a balance, and the reordered-storage disaster | 🔨 |
| 12 | 26 Oct | Oracles, Layer 2 & cross-chain | Price-feed consumer, rollups explained, bridge risks | ⏳ |
| 13 | 27 Oct | Full-stack dApp | Frontend + MetaMask + Sepolia deployment | ⏳ |
| 14 | 28 Oct | Zero-knowledge & account abstraction | ZK proof basics (circom), ERC-4337 smart wallets | ⏳ |
| **Phase 4 — Capstone** | | | | |
| 15 | 29 Oct | Capstone + self-audit | On-chain certificate verification dApp + audit report + retrospective | ⏳ |

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
