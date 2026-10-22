# Day 08 — Exercises

Try each exercise before reading the solution. Solutions are runnable and tested
(`test/exercises.test.js`); the worked contracts are in [`contracts/exercises/`](../contracts/exercises).

```bash
npm run ex:easy
npm run ex:medium
npm run ex:challenge
```

## Easy

1. **Rebuild the ownership table from events.** Mint a few NFTs, move one, burn one. Then, using *only* the `Transfer` events, work out who owns what, and compare with `ownerOf`.
   *Hint:* a `Transfer` to `0x0` means the token was burned; the last event for an id wins.
2. **Compute the ERC-721 interface id yourself.** It is the XOR of the 4-byte selectors of the 9 ERC-721 functions. Check that `supportsInterface` agrees.
   *Hint:* a selector is the first 4 bytes of `keccak256("functionName(argTypes)")`; `safeTransferFrom` counts twice (two overloads).
3. **What does `tokenURI` actually store?** If the server behind it goes down, what happens to the NFT?

**Solution:** [`solutions/easy.js`](solutions/easy.js). *(1)* This is exactly what a marketplace indexer does.
*(2)* `0x80ac58cd`. *(3)* Only a link. The chain still proves who owns the token, but the picture and description disappear with the server. `ipfs://` links are content hashes, so the file cannot be swapped silently; `https://` links can be.

## Medium

4. **A soulbound certificate.** Write an ERC-721 that an issuer can award and revoke, that the holder can delete, and that **nobody can transfer or sell**.
   *Hint:* in OpenZeppelin 5 every mint, transfer and burn passes through `_update(to, tokenId, auth)`. Allow it only when `from` or `to` is `0x0`.
5. **Fix the re-entrant mint.** `NaiveNFT` (in `contracts/test/Helpers.sol`) lets a contract buyer mint 6 with a limit of 3. Explain why, and fix it.
   *Hint:* `_safeMint` calls the buyer before `mintedBy` is updated.

**Solution:** [`solutions/medium.js`](solutions/medium.js), contract [`SoulboundCertificate.sol`](../contracts/exercises/SoulboundCertificate.sol).
*(5)* Record the count (and the next id) **before** the `_safeMint` loop, as `LearningNFT.mint` does. Same idea as Day 06's checks → effects → interactions.

## Challenge

6. **An allowlist presale with one Merkle root (Day 04).** Only 1,000 listed addresses may claim one NFT each. Store only a 32-byte root; each buyer sends a proof.
   *Hint:* build the tree in JavaScript with sorted pairs and double-hashed leaves (`keccak256(keccak256(abi.encode(addr)))`) so OpenZeppelin's `MerkleProof` accepts it. Mark `claimed` before minting.
7. **Why a root?** Measure the gas to write the same 1,000 addresses into a `mapping(address => bool)` and compare it with deploying the whole Merkle contract.

**Solution:** [`solutions/challenge.js`](solutions/challenge.js) with [`solutions/merkle.js`](solutions/merkle.js), contracts [`AllowlistNFT.sol`](../contracts/exercises/AllowlistNFT.sol) and [`MappingAllowlist.sol`](../contracts/exercises/MappingAllowlist.sol).
*(7)* From my run: writing the list cost **22,858,999 gas** (22,858 per address, because every address fills a new storage slot), while the entire Merkle NFT contract deployed for **1,237,697 gas**. The list alone costs **18.5×** the whole contract. A proof for 1,000 addresses is only 10 hashes.
