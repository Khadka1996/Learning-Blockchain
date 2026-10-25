"use strict";
/** Checks the evening exercise solutions (npm run ex) */
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { slotsUsed } = require("../exercises/solutions/ex1-slots");
const { naiveStorageGas, packedStorageGas } = require("../exercises/solutions/ex2-gas-model");
const { checkUpgrade, V1, V2, V2_BROKEN } = require("../exercises/solutions/ex3-upgrade-check");

describe("Exercises — Day 11", function () {
  it("ex1: naive member = 4 slots, packed member = 1 slot, order matters", function () {
    expect(slotsUsed(["bool", "uint256", "uint256", "address"])).to.equal(4);
    expect(slotsUsed(["address", "uint64", "uint32"])).to.equal(1);
    expect(slotsUsed(["uint8", "uint256", "uint8"])).to.equal(3);
    expect(slotsUsed(["uint8", "uint8", "uint256"])).to.equal(2);
    expect(slotsUsed([])).to.equal(0);
    expect(() => slotsUsed(["string"])).to.throw();
  });

  it("ex2: the model lands in the right range of the measured saving (69.7% for 50 members)", function () {
    const saving = (n) => (naiveStorageGas(n) - packedStorageGas(n)) / naiveStorageGas(n);
    expect(saving(50)).to.be.within(0.65, 0.8); // model ignores calldata, events, loop overhead
    expect(saving(10)).to.be.within(0.5, 0.75);
    expect(saving(50)).to.be.greaterThan(saving(1));
  });

  it("ex3: V1 -> V2 safe, V1 -> reordered unsafe, and the real proxy agrees on where totalDeposits lives", async function () {
    expect(checkUpgrade(V1, V2)).to.deep.equal({ safe: true, problems: [] });
    const bad = checkUpgrade(V1, V2_BROKEN);
    expect(bad.safe).to.equal(false);
    expect(bad.problems.join(" ")).to.include("balanceOf");
    expect(checkUpgrade(V1, [V1[0]]).safe).to.equal(false); // removal
    expect(checkUpgrade(V1, [V1[0], { name: "totalDeposits", type: "uint128" }]).safe).to.equal(false); // retype

    const [owner, alice] = await ethers.getSigners();
    const bank = await upgrades.deployProxy(await ethers.getContractFactory("PiggyBankV1"), [owner.address], { kind: "uups" });
    await bank.connect(alice).deposit({ value: ethers.parseEther("3") });
    const slot1 = await ethers.provider.getStorage(await bank.getAddress(), 1);
    expect(BigInt(slot1)).to.equal(ethers.parseEther("3"));
  });
});
