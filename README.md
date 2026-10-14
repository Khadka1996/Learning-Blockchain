# Learning Blockchain in 15 Days

A public, day-by-day log of learning blockchain development from first principles to a working dApp.

Each day has its own folder with notes, working code and exercises. Mornings cover the concept and code; evenings add exercises and improvements.

**Started:** 14 October 2026 · **Ends:** 28 October 2026
**Author:** [Manish Khadka](https://khadka-manish.com.np) · [LinkedIn](https://www.linkedin.com/in/manishkhadka1996) · [GitHub](https://github.com/Khadka1996)

---

## Roadmap

| Day | Date | Topic | What gets built | Status |
|----:|------|-------|-----------------|:------:|
| 00 | 13 Oct | Setup | Repo, tools, roadmap | ✅ |
| 01 | 14 Oct | Hashing & SHA-256 | Hash explorer in Node.js | ⏳ |
| 02 | 15 Oct | Blocks & chains | A minimal blockchain in JavaScript | ⏳ |
| 03 | 16 Oct | Proof of Work | Mining with adjustable difficulty | ⏳ |
| 04 | 17 Oct | Keys & wallets | Generate key pairs, sign and verify | ⏳ |
| 05 | 18 Oct | Transactions | Signed transactions + balance checks | ⏳ |
| 06 | 19 Oct | Merkle trees | Merkle root and inclusion proofs | ⏳ |
| 07 | 20 Oct | Ethereum basics | Accounts, gas, EVM — read chain data with ethers.js | ⏳ |
| 08 | 21 Oct | Solidity fundamentals | First smart contract (storage & events) | ⏳ |
| 09 | 22 Oct | ERC-20 token | Custom token with OpenZeppelin | ⏳ |
| 10 | 23 Oct | ERC-721 NFT | Mintable NFT collection | ⏳ |
| 11 | 24 Oct | Testing with Hardhat | Unit tests for token + NFT | ⏳ |
| 12 | 25 Oct | Frontend + wallet | Connect MetaMask with ethers.js | ⏳ |
| 13 | 26 Oct | Full dApp | Deploy to Sepolia testnet + UI | ⏳ |
| 14 | 27 Oct | Security | Reentrancy, overflow, access control — break & fix | ⏳ |
| 15 | 28 Oct | Final project | Wrap-up project + retrospective | ⏳ |

---

## Repository structure

```
Learning-Blockchain/
├── day-00/        # setup notes
├── day-01/        # each day: README (notes) + code + exercises
│   ├── README.md
│   ├── src/
│   └── exercises/
├── ...
└── day-15/
```

## Tech stack

- **Languages:** JavaScript (Node.js), Solidity
- **Tooling:** Hardhat, ethers.js, OpenZeppelin
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
