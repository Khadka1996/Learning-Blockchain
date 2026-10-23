"use strict";
// Day 09 — Easy exercise: commitments by hand, and the ERC-20 look-alike check.
const { ethers } = require("hardhat");

async function main() {
  const [, alice] = await ethers.getSigners();
  const puzzle = await ethers.deployContract("CommitRevealPuzzle", [ethers.keccak256(ethers.toUtf8Bytes("satoshi"))]);
  const salt = ethers.id("my secret salt");

  // 1) Build the commitment off-chain, exactly like the contract does.
  const byHand = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "string", "bytes32"], [alice.address, "satoshi", salt]),
  );
  const fromContract = await puzzle.makeCommitment(alice.address, "satoshi", salt);
  console.log("By hand:       ", byHand);
  console.log("From contract: ", fromContract);
  console.log("Same?          ", byHand === fromContract);

  // Why abi.encode and not encodePacked: packed strings have no boundaries.
  const packed = (a, b) => ethers.keccak256(ethers.solidityPacked(["string", "string"], [a, b]));
  console.log('Packed ("ab","c") == ("a","bc")?', packed("ab", "c") === packed("a", "bc"), "(collision!)");

  // 2) Which fixed contracts look like an ERC-20?
  const erc20 = ethers.id("transfer(address,uint256)").slice(0, 10);
  console.log("\nERC-20 transfer selector:", erc20);
  for (const name of ["SafeBank", "SafeWallet", "MsgSenderWallet", "CommitRevealPuzzle", "SafeKingOfTheHill"]) {
    const f = await ethers.getContractFactory(name);
    const has = f.interface.fragments.some((x) => x.type === "function" && x.selector === erc20);
    console.log(`  ${name.padEnd(20)} ${has ? "LOOKS LIKE AN ERC-20 (bad)" : "ok"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
