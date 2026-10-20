// Challenge 7-9: the re-entrancy attack, the pause trade-off, and two-step ownership.
const { ethers } = require("hardhat");

const eth = (wei) => ethers.formatEther(wei);
const balanceOf = async (c) => eth(await ethers.provider.getBalance(await c.getAddress()));

async function deploy(name, ...args) {
  const c = await (await ethers.getContractFactory(name)).deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function main() {
  const [owner, victim, alice] = await ethers.getSigners();

  console.log("7. Attacker contract vs two vaults (victim has 5 ETH, attacker stakes 1 ETH)");
  for (const name of ["VulnerableVault", "LearningVault"]) {
    const vault = await deploy(name);
    await (await vault.connect(victim).deposit({ value: ethers.parseEther("5") })).wait();
    const attacker = await deploy("ReentrantAttacker", await vault.getAddress());
    await (await attacker.attack({ value: ethers.parseEther("1") })).wait();
    console.log(`   ${name.padEnd(16)} attacker holds ${await balanceOf(attacker)} ETH, vault holds ${await balanceOf(vault)} ETH`);
  }

  console.log("\n8. The pause trade-off");
  console.log("   Pausing withdrawals can stop an attacker who is draining the vault RIGHT NOW,");
  console.log("   but it also freezes every honest user, and if the owner key is lost or stolen");
  console.log("   while paused, nobody ever gets their money back. LearningVault pauses only");
  console.log("   deposits, so the worst a bad owner can do is stop NEW deposits. The price: it");
  console.log("   cannot stop an exploit that goes through withdraw(). Real systems add a timelock,");
  console.log("   a multisig owner, or a pause that auto-expires.");

  console.log("\n9. Two-step ownership");
  const plus = await deploy("VaultPlus", 1n);
  await (await plus.transferOwnership(alice.address)).wait();
  console.log(`   after transferOwnership: owner is still the deployer (${(await plus.owner()) === owner.address}), pendingOwner = alice`);
  await (await plus.connect(alice).acceptOwnership()).wait();
  console.log(`   after acceptOwnership:   owner is alice (${(await plus.owner()) === alice.address}), pendingOwner cleared`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
