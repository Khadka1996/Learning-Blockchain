const { expect } = require("chai");
const { ethers } = require("hardhat");

// Gas is deterministic on the in-process Hardhat chain, so these are real assertions,
// not just console output. Bounds are loose enough to survive small compiler changes.
describe("LearningVault: gas (Day 05's storage prices, seen from Solidity)", function () {
  let vault, alice;

  beforeEach(async function () {
    [, alice] = await ethers.getSigners();
    vault = await (await ethers.getContractFactory("LearningVault")).deploy();
    await vault.waitForDeployment();
  });

  it("the first deposit creates a storage value; the second only changes it", async function () {
    const first = await (await vault.connect(alice).deposit({ value: 1n })).wait();
    const second = await (await vault.connect(alice).deposit({ value: 1n })).wait();
    console.log(`      first deposit  ${first.gasUsed} gas\n      second deposit ${second.gasUsed} gas`);
    // A new non-zero slot costs 20,000 more than rewriting one (SSTORE 0 -> x vs x -> y).
    expect(first.gasUsed - second.gasUsed).to.be.greaterThan(17_000n);
  });

  it("deploys for well under 500,000 gas and a deposit costs under 100,000", async function () {
    const deployed = await vault.deploymentTransaction().wait();
    const deposit = await (await vault.connect(alice).deposit({ value: 1n })).wait();
    console.log(`      deployment ${deployed.gasUsed} gas, deposit ${deposit.gasUsed} gas`);
    expect(deployed.gasUsed).to.be.lessThan(500_000n);
    expect(deposit.gasUsed).to.be.lessThan(100_000n);
  });

  it("withdraw costs the same every time (the guard does not re-create its slot)", async function () {
    await vault.connect(alice).deposit({ value: 10n });
    const a = await (await vault.connect(alice).withdraw(1n)).wait();
    const b = await (await vault.connect(alice).withdraw(1n)).wait();
    expect(a.gasUsed).to.equal(b.gasUsed);
  });
});
