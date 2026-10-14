# Tools

## `hardhat.config.template.js`
Hardhat config that compiles Solidity **offline** using the `solc` npm package (solcjs),
so builds work even where compiler downloads are blocked.

Setup for a Solidity day:

```bash
npm init -y
npm i -D hardhat@2.22.17 solc@0.8.24 @nomicfoundation/hardhat-ethers@3 \
  @nomicfoundation/hardhat-chai-matchers@2 @nomicfoundation/hardhat-network-helpers@1 \
  chai@4 ethers@6 @openzeppelin/contracts@5.0.2 --legacy-peer-deps
cp ../tools/hardhat.config.template.js hardhat.config.js
npx hardhat test
```

## Security & QA checklist (run every day)
- `npm test` — all unit / fuzz / invariant tests green
- `npm audit --omit=dev` — no high/critical issues in runtime deps
- `npx solhint 'contracts/**/*.sol'` — Solidity lint
- `slither . --hardhat-ignore-compile` — static analysis (after `npx hardhat compile`)
- Manual review: reentrancy, access control, integer edge cases, unchecked external calls,
  front-running, denial of service, signature replay, input validation
