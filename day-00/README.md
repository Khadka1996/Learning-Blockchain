# Day 00 — Setup

Getting the environment ready before Day 1.

## Tools

| Tool | Why | Check |
|------|-----|-------|
| Node.js 20 LTS+ | Runs all JavaScript code and Hardhat | `node -v` |
| Git | Version control | `git --version` |
| VS Code | Editor | — |
| VS Code extension: *Solidity* (Nomic Foundation) | Syntax + errors for smart contracts | — |
| MetaMask (browser extension) | Wallet for testnet transactions (Day 12+) | — |

## Wallet safety (do this right from Day 0)

- Create a **separate MetaMask account for learning only**. Never reuse a wallet that holds real funds.
- Never commit a private key or seed phrase. Keys go in a `.env` file, which is already in `.gitignore`.
- Testnet ETH (Sepolia) is free from a faucet and has no real value.

## Git identity

```bash
git config --global user.name "Manish Khadka"
git config --global user.email "<your GitHub email>"
```

## Goals for these 15 days

1. Understand *why* blockchains work — hashing, consensus, signatures — by building a toy chain from scratch.
2. Write, test and deploy real smart contracts on Ethereum's Sepolia testnet.
3. Ship one end-to-end dApp with a frontend.
4. Learn the common security mistakes before they cost money.

## Resources

- [ethereum.org developer docs](https://ethereum.org/en/developers/docs/)
- [Solidity documentation](https://docs.soliditylang.org/)
- [Hardhat docs](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- Bitcoin whitepaper — Satoshi Nakamoto (2008)

✅ Day 0 complete. Next: **Day 01 — Hashing & SHA-256**.
