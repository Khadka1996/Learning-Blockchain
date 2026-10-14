# Day 00 — The Plan & Setup

**Date:** 14 October 2026 · **Day 1 starts:** 15 October 2026

> For the next 15 days I'm learning blockchain properly — from how a hash works to DeFi, smart-contract security and zero-knowledge proofs — building, testing and attacking real code every day, in public.

## Why I'm doing this

I've spent 4 years building web apps and leading development teams. Blockchain keeps coming up in conversations with clients and developers, and I want to understand it from first principles rather than from headlines. The best way I know to learn something is to build it, break it, and explain it.

## How each day works

| Time | What happens |
|---|---|
| **Morning** | Learn the concept → build small, working code → test it → first QA & security check → push to GitHub → share what I'm learning |
| **Evening** | Independent audit: try to break the code, fix every bug found, re-test → exercises → a PDF study guide → share what I understood |

Every day's folder contains: notes (`README.md`), code, tests, a QA & security report (`QA.md`), exercises with solutions, and a printable study guide (`notes.pdf`).

## The 15-day path: very basic → very advanced

| Phase | Days | What I'll learn |
|---|---|---|
| **1. Foundations** | 1–4 | Hashing, blocks & Proof of Work, keys & signed transactions, Merkle trees & consensus — a small blockchain built from scratch |
| **2. Ethereum & Solidity** | 5–8 | The EVM and gas, Solidity, my own ERC-20 token and NFT collection |
| **3. Advanced** | 9–14 | Smart-contract hacking & defence, a DeFi swap pool, gas optimisation & upgradeable contracts, oracles & Layer 2, a full dApp, zero-knowledge proofs & smart wallets |
| **4. Capstone** | 15 | An on-chain certificate verification dApp with a full self-audit |

## Tools

| Tool | Why | Check |
|------|-----|-------|
| Node.js 20 LTS+ | Runs all JavaScript code and Hardhat | `node -v` |
| Git | Version control | `git --version` |
| VS Code + *Solidity* extension (Nomic Foundation) | Editor with smart-contract support | — |
| Hardhat, ethers.js, OpenZeppelin | Compile, test and deploy smart contracts | installed per day |
| Slither, Solhint | Security analysis and linting | installed per day |
| MetaMask (browser extension) | Wallet for testnet transactions (Day 13) | — |

## Wallet safety (from Day 0)

- Use a **separate MetaMask account for learning only**. Never reuse a wallet that holds real funds.
- Never commit a private key or seed phrase. Keys go in a `.env` file, which is already in `.gitignore`.
- Testnet ETH (Sepolia) is free from a faucet and has no real value.

## Git identity

```bash
git config --global user.name "Manish Khadka"
git config --global user.email "<your GitHub email>"
```

## Goals for these 15 days

1. Understand *why* blockchains work — hashing, signatures, consensus — by building one from scratch.
2. Write, test, audit and deploy real smart contracts.
3. Learn the attacks that have cost real projects millions, and how to prevent them.
4. Ship one complete dApp with a frontend and an audit report.
5. Explain every day's learning in plain words that anyone can follow.

## Starting resources

- [Bitcoin: A Peer-to-Peer Electronic Cash System](https://bitcoin.org/bitcoin.pdf) — Satoshi Nakamoto, 2008
- [ethereum.org developer docs](https://ethereum.org/en/developers/docs/)
- [Solidity documentation](https://docs.soliditylang.org/)
- [Hardhat docs](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- *Mastering Bitcoin* (Antonopoulos) and *Mastering Ethereum* (Antonopoulos & Wood)

✅ Day 0 complete. Next: **Day 01 — Hashing & SHA-256** (15 October).
