// Easy 1-3: depositCount, getBalance, and why `owner` is immutable but `paused` is not.
const { ethers } = require("hardhat");

async function main() {
  const [, alice, bob] = await ethers.getSigners();
  const plus = await (await ethers.getContractFactory("VaultPlus")).deploy(1_000n);
  await plus.waitForDeployment();

  await (await plus.connect(alice).deposit({ value: 5_000n })).wait();
  await (await plus.connect(bob).deposit({ value: 2_000n })).wait();
  await (await plus.connect(alice).deposit({ value: 1_000n })).wait();

  console.log("1. depositCount          =", (await plus.depositCount()).toString(), "(3 successful deposits)");
  console.log("2. getBalance(alice)     =", (await plus.getBalance(alice.address)).toString(), "wei");
  console.log("   getBalance(bob)       =", (await plus.getBalance(bob.address)).toString(), "wei");
  console.log("3. owner is immutable because it must never change after deployment, so the compiler");
  console.log("   copies it into the bytecode (cheap to read, no storage slot). `paused` must change");
  console.log("   at run time, so it has to live in storage.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
