// Medium 4-6: a minimum deposit, an indexed event, and a reverted withdrawal that changes nothing.
const { ethers } = require("hardhat");

const errorName = (e) => /custom error '(\w+)/.exec(e.message)?.[1] ?? e.message;

async function main() {
  const [, alice] = await ethers.getSigners();

  const plus = await (await ethers.getContractFactory("VaultPlus")).deploy(1_000n);
  await plus.waitForDeployment();
  try {
    await plus.connect(alice).deposit({ value: 999n });
  } catch (e) {
    console.log("4. deposit of 999 wei with minimum 1,000 ->", errorName(e));
  }

  const vault = await (await ethers.getContractFactory("LearningVault")).deploy();
  await vault.waitForDeployment();
  const receipt = await (await vault.connect(alice).deposit({ value: 100n })).wait();
  const log = receipt.logs[0];
  console.log(`5. Deposited log has ${log.topics.length} topics: [event signature, indexed account]`);
  console.log("   topic[1] =", ethers.getAddress("0x" + log.topics[1].slice(26)), "(alice)");

  try {
    await vault.connect(alice).withdraw(101n);
  } catch (e) {
    console.log("6. withdraw(101) of 100 ->", errorName(e));
  }
  console.log(
    `   balance still ${await vault.balances(alice.address)}, totalDeposits still ${await vault.totalDeposits()}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
