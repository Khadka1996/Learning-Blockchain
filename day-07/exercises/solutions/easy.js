// Easy 1-3: increase/decrease allowance, burnFrom, and what "18 decimals" really means.
const { ethers } = require("hardhat");

const errName = (e) => /custom error '(\w+)/.exec(e.message)?.[1] ?? "reverted";

async function main() {
  const [owner, alice] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("TokenPlus")).deploy("Plus", "PLUS", 5_000n, 10_000n);
  await token.waitForDeployment();

  console.log("1. increaseAllowance / decreaseAllowance adjust the allowance instead of overwriting it");
  await (await token.approve(alice.address, 100n)).wait();
  await (await token.increaseAllowance(alice.address, 50n)).wait();
  console.log("   approve(100) then increase(50)  ->", (await token.allowance(owner.address, alice.address)).toString());
  await (await token.decreaseAllowance(alice.address, 30n)).wait();
  console.log("   then decrease(30)               ->", (await token.allowance(owner.address, alice.address)).toString());
  try {
    await token.decreaseAllowance(alice.address, 999n);
  } catch (e) {
    console.log("   decrease(999) is refused        ->", errName(e), "(it never silently clamps to 0)");
  }

  console.log("\n2. burnFrom burns someone's tokens with their permission (an allowance)");
  await (await token.connect(alice).burnFrom(owner.address, 100n)).wait();
  console.log("   alice burns 100 of owner's tokens -> totalSupply", (await token.totalSupply()).toString(), "(was 5000)");
  try {
    await token.connect(alice).burnFrom(owner.address, 1000n);
  } catch (e) {
    console.log("   asking for more than the allowance -> ", errName(e));
  }

  console.log("\n3. Decimals are only a display convention");
  console.log("   18 decimals: 2.5 tokens =", ethers.parseUnits("2.5", 18).toString(), "base units");
  console.log("    6 decimals (USDC): 2.5 tokens =", ethers.parseUnits("2.5", 6).toString(), "base units");
  console.log("   The contract only ever stores whole numbers; the wallet divides by 10^decimals to show a dot.");
  console.log("   18 matches Ether's own 18 decimals, so token maths feels the same as ETH maths.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
