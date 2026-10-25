"use strict";
/**
 * npm start — guided tour of Day 11
 *   Part A: the same contract written two ways, gas measured from real receipts
 *   Part B: a UUPS proxy upgraded from V1 to V2 without losing a single balance
 */
const { ethers, upgrades } = require("hardhat");
const { report } = require("./gas-report");

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const eth = (v) => ethers.formatEther(v);

async function impl(addr) {
  const raw = await ethers.provider.getStorage(addr, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

async function partB() {
  const [owner, alice, bob, eve] = await ethers.getSigners();
  console.log("\nB. Upgradeable contract (UUPS proxy)\n");

  const bank = await upgrades.deployProxy(await ethers.getContractFactory("PiggyBankV1"), [owner.address], { kind: "uups" });
  const proxy = await bank.getAddress();
  console.log(`   1. Deployed PiggyBank V1 behind proxy ${proxy}`);
  console.log(`      logic (implementation) lives at   ${await impl(proxy)}`);

  await bank.connect(alice).deposit({ value: ethers.parseEther("3") });
  await bank.connect(bob).deposit({ value: ethers.parseEther("2") });
  console.log(`   2. Alice saves 3 ETH, Bob saves 2 ETH -> total ${eth(await bank.totalDeposits())} ETH, version ${await bank.version()}`);

  try {
    await bank.connect(eve).upgradeToAndCall(owner.address, "0x");
  } catch (e) {
    console.log(`   3. Eve tries to upgrade -> reverted (${bank.interface.parseError(e.data).name})`);
  }

  try {
    await upgrades.validateUpgrade(proxy, await ethers.getContractFactory("PiggyBankV2Broken"), { kind: "uups" });
  } catch (e) {
    console.log(`   4. A V2 with reordered variables is rejected by the storage check:`);
    console.log(`      "${e.message.split("\n")[0]}" (balanceOf moved from slot 0 to slot 1)`);
  }

  const v2 = await upgrades.upgradeProxy(proxy, await ethers.getContractFactory("PiggyBankV2"), {
    call: { fn: "initializeV2", args: [ethers.parseEther("5")] },
  });
  console.log(`   5. Owner upgrades to V2 (cap 5 ETH per user, emergency pause)`);
  console.log(`      same address ${await v2.getAddress()}, new logic at ${await impl(proxy)}`);
  console.log(
    `      Alice still has ${eth(await v2.balanceOf(alice.address))} ETH, Bob ${eth(await v2.balanceOf(bob.address))} ETH, version ${await v2.version()}`
  );

  try {
    await v2.connect(alice).deposit({ value: ethers.parseEther("3") });
  } catch (e) {
    const err = v2.interface.parseError(e.data);
    console.log(`   6. Alice tries to add 3 ETH -> ${err.name}(${eth(err.args[0])} > ${eth(err.args[1])})`);
  }
  await v2.connect(owner).setPaused(true);
  await v2.connect(alice).withdraw(ethers.parseEther("3"));
  console.log(`   7. Owner pauses deposits; Alice can still withdraw her 3 ETH. Box now holds ${eth(await ethers.provider.getBalance(proxy))} ETH`);
}

async function main() {
  console.log("A. Gas optimisation\n");
  await report();
  await partB();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
