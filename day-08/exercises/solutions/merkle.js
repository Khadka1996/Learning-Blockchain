// A tiny Merkle tree that matches OpenZeppelin's MerkleProof (sorted pairs, double-hashed leaves).
const { ethers } = require("hardhat");

const leafOf = (address) =>
  ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [address])));

// Sort each pair before hashing, so a proof does not need to say "left" or "right".
const hashPair = (a, b) => (BigInt(a) < BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a])));

function buildTree(addresses) {
  let level = addresses.map(leafOf);
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    level = next;
    levels.push(level);
  }
  const root = level[0];
  const proofFor = (address) => {
    let index = levels[0].indexOf(leafOf(address));
    if (index < 0) return [];
    const proof = [];
    for (const lvl of levels.slice(0, -1)) {
      const sibling = index ^ 1;
      if (sibling < lvl.length) proof.push(lvl[sibling]);
      index = Math.floor(index / 2);
    }
    return proof;
  };
  return { root, proofFor };
}

module.exports = { buildTree, leafOf };
