"use strict";
/**
 * Runs the SAME scenario against ClubNaive and ClubOptimized and records the gas used
 * by every transaction (from real receipts on the local Hardhat chain).
 */
const { ethers } = require("hardhat");

const FEE = ethers.parseEther("0.01");

async function gasOf(txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  return Number(receipt.gasUsed);
}

/** @returns {Promise<Record<string, number>>} label -> gas used */
async function measureClub(contractName, batchSizes = [10, 50]) {
  const signers = await ethers.getSigners();
  const [owner, alice, bob] = signers;
  const Factory = await ethers.getContractFactory(contractName, owner);
  const club = await Factory.deploy(FEE);
  const deployReceipt = await club.deploymentTransaction().wait();
  const r = { deploy: Number(deployReceipt.gasUsed) };

  r["join (no referrer)"] = await gasOf(club.connect(alice).join(ethers.ZeroAddress, { value: FEE }));
  r["join (with referrer)"] = await gasOf(club.connect(bob).join(alice.address, { value: FEE }));

  // Fresh random members so each batch size is measured from the same starting state.
  for (const n of batchSizes) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await owner.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
      await club.connect(w).join(ethers.ZeroAddress, { value: FEE });
      list.push(w.address);
    }
    r[`addPointsBatch (${n} members)`] = await gasOf(club.addPointsBatch(list, 5));
    if (n === batchSizes[batchSizes.length - 1]) {
      // Same members again: now every points slot is already non-zero in BOTH versions,
      // so this row shows the savings that do NOT come from packing.
      r[`addPointsBatch again (${n})`] = await gasOf(club.addPointsBatch(list, 5));
    }
  }

  r["withdraw"] = await gasOf(club.withdraw(owner.address));
  const code = await ethers.provider.getCode(await club.getAddress());
  r["bytecode size (bytes)"] = (code.length - 2) / 2;
  return r;
}

module.exports = { measureClub, FEE };
