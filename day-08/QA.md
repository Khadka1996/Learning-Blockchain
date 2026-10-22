# Day 08 — QA & security review

**Scope:** `contracts/MiniNFT.sol`, `contracts/LearningNFT.sol`, `contracts/GameItems.sol`, `src/demo.js`, `qa/mutation.js`, and the test-only helpers in `contracts/test/Helpers.sol` (several are deliberately broken or hostile). OpenZeppelin 5.0.2 itself is a dependency and was not audited here.
**Method:** tests first (one ERC-721 behaviour suite run on my token *and* on OpenZeppelin's), a **differential fuzz test** (random programs on both, every step compared), the tools (ESLint, Solhint, `npm audit`, Slither), a manual attacker review with the checklist in [`tools/README.md`](../tools/README.md), then **mutation testing** ([`qa/mutation.js`](qa/mutation.js)).
**Rounds:** 3 (round 1: shared suite failed on MiniNFT · round 2: Slither + lint findings fixed · round 3: everything re-run on the final code, clean).

## Findings

| ID | Severity | Found by | Description | Fix | Proving test |
|----|----------|----------|-------------|-----|--------------|
| M1 | Low | Shared ERC-721 test suite (written against OpenZeppelin's behaviour) | **MiniNFT checked the arguments in a different order from OpenZeppelin.** When a *stranger* called `transferFrom` with the wrong `from`, MiniNFT answered `ERC721IncorrectOwner` while OpenZeppelin answers `ERC721InsufficientApproval`. Not a theft risk, but a wallet or marketplace decoding errors would show the wrong reason, and the two contracts were no longer interchangeable. | Permission is now checked before `from`, exactly like OpenZeppelin 5. | `a STRANGER passing the wrong 'from' gets the approval error first` (MiniNFT and OpenZeppelin), plus the differential test |
| S1 | Low | Slither `uninitialized-local` (Medium) | `digits` in `MiniNFT._toString` and `already` in `GameItems.mintBatch` relied on Solidity's implicit zero. Correct today, but an easy trap when code is edited later. | Both initialised to `0` explicitly. | `tokenURI = base + id, including 0 and a huge id`; `the same id twice in one batch cannot sneak past its cap` |
| L1 | Info | Solhint `no-inline-assembly` | The receiver-error bubbling in `MiniNFT` uses 3 lines of assembly. | Kept (it is the only way to re-throw raw revert data, and OpenZeppelin does the same); the reason is now written next to it and the warning disabled for that line only. | `to a contract that refuses: its own error is passed on` |

### Mutation testing

| Pass | Result |
|---|---|
| Full pass, 34 mutants (21 MiniNFT, 9 LearningNFT, 4 GameItems) | **34 / 34** killed |
| After S1 and L1, the 3 mutants on the edited lines re-run | **3 / 3** killed |

The 34 mutants include: an interface id not advertised, `ownerOf` returning `0x0`, anyone can approve / mint / burn, approval check skipped, operators ignored, wrong `from` accepted, approval surviving a transfer, balances not updated, the receiver check skipped, a wrong receiver answer accepted, the receiver's own error swallowed, double mint, quantity 0, sold-out off by one, wallet limit removed, overpayment accepted, **limits recorded after minting (the re-entrancy bug)**, owner mint past the cap, withdraw failure ignored, ERC-2981 not advertised, cap off by one, repeated ids in a batch, and two crowns.

### Tool results

| Tool | Result |
|---|---|
| `npm test` | **99 / 99 pass**, including 120 random programs (1,394 steps: 454 succeeded on both contracts, 940 failed on both with the identical error and arguments) |
| Mutation testing | **34 / 34** caught |
| ESLint + Solhint | 0 errors, 0 warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Slither (102 detectors) | after S1: **5 results in production contracts, all informational and explained below**; the rest are in OpenZeppelin or the deliberately bad test helpers |

Slither, production contracts:
- `assembly` (MiniNFT): see L1. **Accepted.**
- `low-level-calls` (`LearningNFT.withdraw`): sending ETH needs `call`; the result is checked and a failure reverts with `WithdrawFailed` (tested with an owner contract that refuses ETH). **Accepted.**
- `missing-inheritance` (MiniNFT should inherit `IERC721`; LearningNFT "should inherit" the test-only `IMintable`): MiniNFT re-declares the events and errors on purpose, to show them; inheriting the interface would clash. **Accepted.**
- `pragma` (OpenZeppelin uses `^0.8.20`, we pin `0.8.24`): **accepted**, everything compiles with 0.8.24.

Slither, test helpers: `reentrancy-no-eth` / `reentrancy-benign` in `NaiveNFT` and `ReentrantMinter`, `missing-zero-check`, `costly-loop`: **intentional.** They exist to be bad.

### Also attacked and found safe (no change needed)

- **Re-entrant minting** (the day's main attack): `_safeMint` calls the buyer, who calls `mint` again. A naive contract that records the wallet count *after* minting gives the attacker **6 tokens with a limit of 3**. `LearningNFT` records everything first: 3 re-entries tried, all refused, attacker holds 3. A re-entry *inside* the limit still works and gets fresh ids (no collision).
- **Black-hole transfers:** `safeTransferFrom` refuses contracts without the hook, with the wrong 4-byte answer, or that revert (their own error is passed on). ERC-1155 has no unsafe transfer at all, so a hook-less contract can never receive.
- **Payment edge cases:** too little and too much ETH are both refused; `mint(2²⁵⁶−1)` is refused before the price multiplication; supply stops at exactly 100 for buyers and the owner.
- **Royalty edge cases:** above 100% refused at deploy; tiny prices round down (19 wei × 5% = 0); a plain transfer pays nothing, by design of ERC-2981.
- **ERC-1155 caps:** the same id twice in one batch is summed, so it cannot pass its cap; undefined ids cannot be minted; mismatched arrays are refused.
- **Hand-written vs OpenZeppelin:** identical success/failure, error names and arguments, events, owners, balances and approvals over 120 random programs.

## Known issues (accepted)

| ID | Severity | Description | Why it is accepted |
|----|----------|-------------|--------------------|
| K1 | Info | **ERC-2981 royalties are not enforced.** `royaltyInfo` only answers "how much should the artist get"; any transfer can skip it. | This is how ERC-2981 is designed. Enforcement means restricting transfers (operator filters), which breaks ownership. Shown in a test. |
| K2 | Info | **`setApprovalForAll` is all-or-nothing**, and on ERC-1155 it is the *only* approval: approving a marketplace for GOLD also lets it move the CROWN. | Inherent to the standards. The classic NFT phishing scam is a fake "approve all" request; shown in a test so the risk is visible. |
| K3 | Info | **`MiniNFT.mint` does not check the receiver hook** (like OpenZeppelin's `_mint`). The minter could mint into a contract that cannot hold NFTs. | Only the minter can mint; `LearningNFT` uses `_safeMint` for buyers. |
| K4 | Info | **Metadata is a link, not the picture.** If the server behind `baseURI` disappears, the NFT points at nothing, and the owner of `LearningNFT` can change the base URI. | Expected for a learning collection; production collections use IPFS content hashes and freeze the URI. |
| K5 | Info | `GameItems.mintBatch` checks repeated ids with a nested loop (O(n²)). | Owner-only and batches are small; a mapping-based check would cost more for the normal case. |
