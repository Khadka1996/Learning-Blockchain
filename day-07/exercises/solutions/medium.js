// Medium 4-6: a capped mint, the approve race and its compare-and-set fix, and the supply invariant.
const { ethers } = require("hardhat");

const errName = (e) => /custom error '(\w+)/.exec(e.message)?.[1] ?? "reverted";

async function main() {
  const [owner, alice] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("TokenPlus");

  console.log("4. Owner-only mint that can never pass the cap (cap 10,000, supply 5,000)");
  const token = await Factory.deploy("Plus", "PLUS", 5_000n, 10_000n);
  await token.waitForDeployment();
  await (await token.mint(alice.address, 5_000n)).wait();
  console.log("   minted 5,000 more -> totalSupply", (await token.totalSupply()).toString());
  try {
    await token.mint(alice.address, 1n);
  } catch (e) {
    console.log("   one more unit      ->", errName(e));
  }
  try {
    await token.connect(alice).mint(alice.address, 1n);
  } catch (e) {
    console.log("   a stranger mints   ->", errName(e));
  }

  console.log("\n5. The approve race, then the compare-and-set fix");
  const t = await Factory.deploy("Plus", "PLUS", 5_000n, 10_000n);
  await t.waitForDeployment();
  await (await t.approve(alice.address, 100n)).wait();
  await (await t.connect(alice).transferFrom(owner.address, alice.address, 100n)).wait(); // the front-run
  try {
    await t.approveIfCurrent(alice.address, 100n, 50n);
  } catch (e) {
    console.log("   owner wants 'allowance 100 -> 50' but 100 was already spent ->", errName(e));
    console.log("   no fresh allowance is created, so the spender cannot take 100 + 50.");
  }

  console.log("\n6. Invariant: the sum of all balances equals totalSupply (checked after every operation in test/fuzz.test.js)");
  const sum = (await t.balanceOf(owner.address)) + (await t.balanceOf(alice.address));
  console.log("   owner + alice =", sum.toString(), "  totalSupply =", (await t.totalSupply()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
