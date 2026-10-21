const { expect } = require("chai");
const { ethers } = require("hardhat");

// Gas is deterministic on the in-process chain. Day 05's storage prices, seen through a token:
// writing a slot for the first time (0 -> value) costs ~20,000 more than updating it.
describe("Gas: what a token operation costs and why", function () {
  let mini, oz, alice, bob, carol;

  beforeEach(async function () {
    [, alice, bob, carol] = await ethers.getSigners();
    mini = await (await ethers.getContractFactory("MiniToken")).deploy("Mini", "MINI", 1_000_000n);
    oz = await (await ethers.getContractFactory("OZReference")).deploy("Ref", "REF", 1_000_000n);
    await Promise.all([mini.waitForDeployment(), oz.waitForDeployment()]);
  });

  const gas = async (promise) => (await (await promise).wait()).gasUsed;

  it("sending to a NEW holder costs ~17,000+ more than sending to an existing one", async function () {
    const toNew = await gas(mini.transfer(alice.address, 10n));
    const toExisting = await gas(mini.transfer(alice.address, 10n));
    console.log(`      to a new address ${toNew} gas, to an existing holder ${toExisting} gas`);
    expect(toNew - toExisting).to.be.greaterThan(17_000n);
  });

  it("the first approve creates a slot, a later one only changes it", async function () {
    const first = await gas(mini.approve(bob.address, 100n));
    const second = await gas(mini.approve(bob.address, 200n));
    console.log(`      first approve ${first} gas, second approve ${second} gas`);
    expect(first - second).to.be.greaterThan(15_000n);
  });

  it("an UNLIMITED allowance makes transferFrom cheaper: the allowance slot is not rewritten", async function () {
    await mini.transfer(alice.address, 1000n);
    await mini.transfer(carol.address, 1n); // so the receiver already holds tokens
    await mini.connect(alice).approve(bob.address, 500n);
    const finite = await gas(mini.connect(bob).transferFrom(alice.address, carol.address, 10n));
    await mini.connect(alice).approve(bob.address, ethers.MaxUint256);
    const unlimited = await gas(mini.connect(bob).transferFrom(alice.address, carol.address, 10n));
    console.log(`      transferFrom with finite allowance ${finite} gas, with unlimited allowance ${unlimited} gas`);
    expect(finite - unlimited).to.be.greaterThan(2_000n);
  });

  it("the hand-written token costs within 5% of OpenZeppelin for a transfer (same algorithm)", async function () {
    await mini.transfer(alice.address, 1n);
    await oz.transfer(alice.address, 1n); // warm both: receiver exists
    const a = await gas(mini.transfer(alice.address, 10n));
    const b = await gas(oz.transfer(alice.address, 10n));
    console.log(`      MiniToken ${a} gas, OpenZeppelin ${b} gas`);
    const diff = a > b ? a - b : b - a;
    expect(diff * 100n / b).to.be.lessThan(5n);
  });

  it("a plain transfer to an existing holder stays under 60,000 gas", async function () {
    await mini.transfer(alice.address, 1n);
    expect(await gas(mini.transfer(alice.address, 10n))).to.be.lessThan(60_000n);
  });
});
