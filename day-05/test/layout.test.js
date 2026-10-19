"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mappingSlot, arraySlot, unpack } = require("../src/storage");

describe("Layout.sol: where Solidity puts each variable", () => {
  let layout, owner, alice, addr;
  const slot = (i) => ethers.provider.getStorage(addr, i);

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();
    layout = await (await ethers.getContractFactory("Layout")).deploy();
    addr = await layout.getAddress();
  });

  it("slot 0 holds counter as a full 32-byte number", async () => {
    await layout.increment();
    expect(BigInt(await slot(0))).to.equal(1n);
  });

  it("slot 1 packs two uint128s: small in the low 16 bytes, big in the high 16 bytes", async () => {
    const word = await slot(1);
    expect(unpack(word, 0, 16)).to.equal(7n);
    expect(unpack(word, 16, 16)).to.equal(9n);
    expect(word).to.equal("0x" + "9".padStart(32, "0") + "7".padStart(32, "0"));
  });

  it("slot 2 packs owner (20 bytes) and paused (1 byte)", async () => {
    await layout.setPaused(true);
    const word = await slot(2);
    expect(ethers.getAddress(ethers.toBeHex(unpack(word, 0, 20), 20))).to.equal(owner.address);
    expect(unpack(word, 20, 1)).to.equal(1n);
  });

  it("mapping value lives at keccak256(key, 3); slot 3 itself stays 0", async () => {
    await layout.connect(alice).deposit({ value: 1234n });
    expect(BigInt(await slot(3))).to.equal(0n);
    expect(BigInt(await slot(mappingSlot("address", alice.address, 3)))).to.equal(1234n);
  });

  it("array length is in slot 4, element i at keccak256(4) + i", async () => {
    await layout.push(11);
    await layout.push(22);
    expect(BigInt(await slot(4))).to.equal(2n);
    expect(BigInt(await slot(arraySlot(4, 1)))).to.equal(22n);
  });

  it("unpack refuses a field that does not fit in one slot", () => {
    expect(() => unpack("0x00", 30, 4)).to.throw(RangeError);
  });
});

describe("Layout.sol: access control, deposits and withdrawals", () => {
  let layout, alice;
  beforeEach(async () => {
    [, alice] = await ethers.getSigners();
    layout = await (await ethers.getContractFactory("Layout")).deploy();
  });

  it("only the owner can push or pause", async () => {
    await expect(layout.connect(alice).push(1)).to.be.revertedWithCustomError(layout, "NotOwner").withArgs(alice.address);
    await expect(layout.connect(alice).setPaused(true)).to.be.revertedWithCustomError(layout, "NotOwner");
  });

  it("deposit emits an event; paused contract refuses deposits", async () => {
    await expect(layout.connect(alice).deposit({ value: 5n })).to.emit(layout, "Deposited").withArgs(alice.address, 5n, 5n);
    await layout.setPaused(true);
    await expect(layout.connect(alice).deposit({ value: 5n })).to.be.revertedWithCustomError(layout, "Paused");
  });

  it("withdraw returns exactly your own ETH and never more", async () => {
    await layout.connect(alice).deposit({ value: 100n });
    await expect(layout.connect(alice).withdraw(101n)).to.be.revertedWithCustomError(layout, "InsufficientBalance").withArgs(101n, 100n);
    await expect(layout.connect(alice).withdraw(60n)).to.changeEtherBalances([alice, layout], [60n, -60n]);
    expect(await layout.balances(alice.address)).to.equal(40n);
  });

  it("a re-entering contract cannot withdraw twice (balance is cut before the ETH is sent)", async () => {
    const attacker = await (await ethers.getContractFactory("ReentrantWithdrawer")).deploy(await layout.getAddress());
    await layout.connect(alice).deposit({ value: 1000n });               // other users' money in the pot
    await attacker.attack({ value: 100n });
    expect(await ethers.provider.getBalance(await layout.getAddress())).to.equal(1000n);
    expect(await attacker.reentered()).to.equal(true);                  // it tried…
    expect(await attacker.extraWithdrawn()).to.equal(0n);               // …and got nothing extra
  });
});
