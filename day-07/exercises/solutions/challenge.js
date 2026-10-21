// Challenge 7-9: a naive vault vs a fee-on-transfer token, permit front-running, differential testing.
const { ethers } = require("hardhat");
const { signPermit, latestTimestamp } = require("../../test/helpers/permit");

async function deploy(name, ...args) {
  const c = await (await ethers.getContractFactory(name)).deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function main() {
  const [owner, alice, bob, mallory] = await ethers.getSigners();

  console.log("7. A fee-on-transfer token (1% burned) in a naive vault and in TokenVault");
  const fee = await deploy("FeeToken", 1_000_000n);
  for (const name of ["NaiveTokenVault", "TokenVault"]) {
    for (const u of [alice, bob]) await (await fee.transfer(u.address, 2000n)).wait(); // they receive 1980
    const vault = await deploy(name);
    const token = await fee.getAddress();
    for (const u of [alice, bob]) {
      await (await fee.connect(u).approve(await vault.getAddress(), 1000n)).wait();
      await (await vault.connect(u).deposit(token, 1000n)).wait();
    }
    const credited =
      (await vault.balances(token, alice.address)) + (await vault.balances(token, bob.address));
    const held = await fee.balanceOf(await vault.getAddress());
    console.log(`   ${name.padEnd(16)} credited ${credited}, really holds ${held}${credited > held ? "  <- INSOLVENT" : "  <- solvent"}`);
  }
  console.log("   Fix: measure balanceOf(vault) before and after, credit the difference (TokenVault._deposit).");

  console.log("\n8. permit can be front-run; depositWithPermit must not break when that happens");
  const token = await deploy("LearningToken", owner.address, 1_000_000n, 2_000_000n);
  const vault = await deploy("TokenVault");
  await (await token.transfer(alice.address, 1000n)).wait();
  const deadline = (await latestTimestamp()) + 3600;
  const { v, r, s } = await signPermit(token, alice, await vault.getAddress(), 100n, deadline);
  await (await token.connect(mallory).permit(alice.address, await vault.getAddress(), 100n, deadline, v, r, s)).wait();
  console.log("   Mallory used Alice's signature first. A direct token.permit() by Alice would now revert:");
  await token.permit(alice.address, await vault.getAddress(), 100n, deadline, v, r, s).catch(() => console.log("   -> reverted (nonce already used)"));
  await (await vault.connect(alice).depositWithPermit(await token.getAddress(), 100n, deadline, v, r, s)).wait();
  console.log("   depositWithPermit ignores the failed permit and still deposits:", (await vault.balances(await token.getAddress(), alice.address)).toString());

  console.log("\n9. Differential testing: run your token and OpenZeppelin on the same random operations.");
  console.log("   See test/differential.test.js: after every operation both must agree on success, error name + arguments,");
  console.log("   events, every balance, every allowance and totalSupply. Run it with: npx hardhat test test/differential.test.js");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
