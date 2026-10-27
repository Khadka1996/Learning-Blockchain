"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const E = (x) => ethers.parseEther(x);

async function deploy() {
  const [owner, alice, bob] = await ethers.getSigners();
  const jar = await ethers.deployContract("TipJar");
  return { jar, owner, alice, bob };
}

describe("TipJar — tipping", function () {
  it("stores the tip, emits TipSent and counts the total", async function () {
    const { jar, alice } = await loadFixture(deploy);
    await expect(jar.connect(alice).tip("hello", { value: E("0.001") }))
      .to.emit(jar, "TipSent")
      .withArgs(0, alice.address, E("0.001"), "hello");
    expect(await jar.tipCount()).to.equal(1);
    expect(await jar.totalTipped()).to.equal(E("0.001"));
    expect(await ethers.provider.getBalance(jar)).to.equal(E("0.001"));
    const [t] = await jar.getTips(0, 1);
    expect(t.from).to.equal(alice.address);
    expect(t.message).to.equal("hello");
    const block = await ethers.provider.getBlock("latest");
    expect(t.timestamp).to.equal(block.timestamp);
  });

  it("accepts exactly MIN_TIP and refuses 1 wei less", async function () {
    const { jar, alice } = await loadFixture(deploy);
    const min = await jar.MIN_TIP();
    await expect(jar.connect(alice).tip("ok", { value: min })).to.not.be.reverted;
    await expect(jar.connect(alice).tip("no", { value: min - 1n }))
      .to.be.revertedWithCustomError(jar, "TipTooSmall")
      .withArgs(min - 1n, min);
  });

  it("refuses an empty message", async function () {
    const { jar, alice } = await loadFixture(deploy);
    await expect(jar.connect(alice).tip("", { value: E("0.001") })).to.be.revertedWithCustomError(jar, "EmptyMessage");
  });

  it("limits the message by BYTES: 140 ASCII ok, 141 refused, 35 emoji (140 bytes) ok, 36 refused", async function () {
    const { jar, alice } = await loadFixture(deploy);
    const v = { value: E("0.001") };
    await expect(jar.connect(alice).tip("a".repeat(140), v)).to.not.be.reverted;
    await expect(jar.connect(alice).tip("a".repeat(141), v)).to.be.revertedWithCustomError(jar, "MessageTooLong").withArgs(141, 140);
    await expect(jar.connect(alice).tip("🔗".repeat(35), v)).to.not.be.reverted;
    await expect(jar.connect(alice).tip("🔗".repeat(36), v)).to.be.revertedWithCustomError(jar, "MessageTooLong").withArgs(144, 140);
  });

  it("refuses plain ETH transfers (no message, no event)", async function () {
    const { jar, alice } = await loadFixture(deploy);
    await expect(alice.sendTransaction({ to: jar, value: E("1") })).to.be.revertedWithCustomError(jar, "UseTipFunction");
  });
});

describe("TipJar — reading pages (newest first)", function () {
  async function withFive() {
    const f = await deploy();
    for (let i = 0; i < 5; i++) await f.jar.connect(f.alice).tip(`tip ${i}`, { value: E("0.001") });
    return f;
  }

  it("returns newest first and pages correctly", async function () {
    const { jar } = await loadFixture(withFive);
    expect((await jar.getTips(0, 2)).map((t) => t.message)).to.deep.equal(["tip 4", "tip 3"]);
    expect((await jar.getTips(2, 2)).map((t) => t.message)).to.deep.equal(["tip 2", "tip 1"]);
    expect((await jar.getTips(4, 2)).map((t) => t.message)).to.deep.equal(["tip 0"]);
  });

  it("empty page when offset is past the end or limit is 0 (no revert, no underflow)", async function () {
    const { jar } = await loadFixture(withFive);
    expect(await jar.getTips(5, 10)).to.have.length(0);
    expect(await jar.getTips(ethers.MaxUint256, ethers.MaxUint256)).to.have.length(0);
    expect(await jar.getTips(0, 0)).to.have.length(0);
  });

  it("caps a page at MAX_PAGE (50) even if more is asked", async function () {
    const { jar, alice } = await loadFixture(deploy);
    for (let i = 0; i < 52; i++) await jar.connect(alice).tip(`t${i}`, { value: E("0.0001") });
    const page = await jar.getTips(0, ethers.MaxUint256);
    expect(page).to.have.length(50);
    expect(page[0].message).to.equal("t51");
  });
});

describe("TipJar — withdrawing", function () {
  it("owner withdraws the whole balance; totalTipped is history and stays", async function () {
    const { jar, owner, alice, bob } = await loadFixture(deploy);
    await jar.connect(alice).tip("a", { value: E("0.3") });
    await expect(jar.withdraw(bob.address)).to.emit(jar, "Withdrawn").withArgs(bob.address, E("0.3"));
    expect(await ethers.provider.getBalance(jar)).to.equal(0);
    expect(await jar.totalTipped()).to.equal(E("0.3"));
    expect(await jar.owner()).to.equal(owner.address);
  });

  it("anyone else is refused with NotOwner(caller)", async function () {
    const { jar, alice } = await loadFixture(deploy);
    await jar.connect(alice).tip("a", { value: E("0.1") });
    await expect(jar.connect(alice).withdraw(alice.address)).to.be.revertedWithCustomError(jar, "NotOwner").withArgs(alice.address);
  });

  it("refuses address(0) and an empty jar", async function () {
    const { jar, alice } = await loadFixture(deploy);
    await expect(jar.withdraw(alice.address)).to.be.revertedWithCustomError(jar, "NothingToWithdraw");
    await jar.connect(alice).tip("a", { value: E("0.1") });
    await expect(jar.withdraw(ethers.ZeroAddress)).to.be.revertedWithCustomError(jar, "ZeroAddress");
  });

  it("a recipient that refuses ETH makes it revert with TransferFailed (money stays safe)", async function () {
    const { jar, alice } = await loadFixture(deploy);
    const rejecter = await ethers.deployContract("RejectEther");
    await jar.connect(alice).tip("a", { value: E("0.1") });
    await expect(jar.withdraw(rejecter)).to.be.revertedWithCustomError(jar, "TransferFailed");
    expect(await ethers.provider.getBalance(jar)).to.equal(E("0.1"));
  });

  it("re-entrancy: an owner contract that calls withdraw() again while being paid gets nothing extra", async function () {
    const [, alice] = await ethers.getSigners();
    const attacker = await ethers.deployContract("ReentrantOwner");
    const jar = await ethers.getContractAt("TipJar", await attacker.jar());
    await jar.connect(alice).tip("a", { value: E("1") });
    await attacker.pull();
    expect(await attacker.reentryAttempts()).to.equal(1);
    expect(await attacker.reentrySucceeded()).to.equal(false);
    expect(await ethers.provider.getBalance(attacker)).to.equal(E("1"));
    expect(await ethers.provider.getBalance(jar)).to.equal(0);
  });
});
