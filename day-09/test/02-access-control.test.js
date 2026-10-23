"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const FIVE = ethers.parseEther("5");

describe("2. Access control", function () {
  async function deploy() {
    const [deployer, owner, attacker, newOwner] = await ethers.getSigners();
    const vulnerable = await ethers.deployContract("VulnerableWallet");
    await vulnerable.initialize(owner.address);
    await owner.sendTransaction({ to: await vulnerable.getAddress(), value: FIVE });
    const safe = await ethers.deployContract("SafeWallet", [owner.address]);
    await owner.sendTransaction({ to: await safe.getAddress(), value: FIVE });
    return { deployer, owner, attacker, newOwner, vulnerable, safe };
  }

  it("EXPLOIT: anyone can call initialize() again, become owner and empty the wallet", async function () {
    const { vulnerable, attacker } = await loadFixture(deploy);
    await vulnerable.connect(attacker).initialize(attacker.address);
    expect(await vulnerable.owner()).to.equal(attacker.address);
    await expect(vulnerable.connect(attacker).withdrawAll(attacker.address)).to.changeEtherBalance(attacker, FIVE);
  });

  it("FIX: SafeWallet has no initialize(); strangers get OwnableUnauthorizedAccount", async function () {
    const { safe, attacker, owner } = await loadFixture(deploy);
    expect(safe.interface.getFunction("initialize")).to.equal(null);
    await expect(safe.connect(attacker).withdrawAll(attacker.address))
      .to.be.revertedWithCustomError(safe, "OwnableUnauthorizedAccount")
      .withArgs(attacker.address);
    await expect(safe.connect(attacker).transferOwnership(attacker.address)).to.be.revertedWithCustomError(
      safe,
      "OwnableUnauthorizedAccount",
    );
    await expect(safe.connect(owner).withdrawAll(owner.address)).to.changeEtherBalance(owner, FIVE);
  });

  it("FIX: ownership moves in two steps, so a wrong address cannot take over or lock it", async function () {
    const { safe, owner, attacker, newOwner } = await loadFixture(deploy);
    await safe.connect(owner).transferOwnership(newOwner.address);
    expect(await safe.owner()).to.equal(owner.address); // nothing changes yet
    await expect(safe.connect(attacker).acceptOwnership()).to.be.revertedWithCustomError(safe, "OwnableUnauthorizedAccount");
    await safe.connect(newOwner).acceptOwnership();
    expect(await safe.owner()).to.equal(newOwner.address);
    await expect(safe.connect(owner).withdrawAll(owner.address)).to.be.revertedWithCustomError(safe, "OwnableUnauthorizedAccount");
  });

  it("FIX: rejects the zero address as owner and as withdraw target", async function () {
    const { safe, owner } = await loadFixture(deploy);
    const Safe = await ethers.getContractFactory("SafeWallet");
    await expect(Safe.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Safe, "OwnableInvalidOwner");
    await expect(safe.connect(owner).withdrawAll(ethers.ZeroAddress)).to.be.revertedWithCustomError(safe, "ZeroAddress");
  });
});

describe("3. tx.origin phishing", function () {
  async function deploy() {
    const [owner, attacker] = await ethers.getSigners();
    const vulnerable = await ethers.deployContract("TxOriginWallet", [], owner);
    const safe = await ethers.deployContract("MsgSenderWallet", [], owner);
    for (const w of [vulnerable, safe]) await owner.sendTransaction({ to: await w.getAddress(), value: FIVE });
    const trapV = await ethers.deployContract("PhishingAirdrop", [await vulnerable.getAddress()], attacker);
    const trapS = await ethers.deployContract("PhishingAirdrop", [await safe.getAddress()], attacker);
    return { owner, attacker, vulnerable, safe, trapV, trapS };
  }

  it("EXPLOIT: the owner clicks a fake 'claim airdrop' and the wallet sends everything to the attacker", async function () {
    const { owner, attacker, vulnerable, trapV } = await loadFixture(deploy);
    await expect(trapV.connect(owner).claim()).to.changeEtherBalances([attacker, vulnerable], [FIVE, -FIVE]);
  });

  it("the attacker cannot call TxOriginWallet directly (it only works through the victim)", async function () {
    const { attacker, vulnerable } = await loadFixture(deploy);
    await expect(vulnerable.connect(attacker).pay(attacker.address, 1n)).to.be.revertedWithCustomError(vulnerable, "NotOwner");
  });

  it("FIX: MsgSenderWallet sees the trap contract as the caller and refuses", async function () {
    const { owner, safe, trapS } = await loadFixture(deploy);
    await expect(trapS.connect(owner).claim()).to.be.revertedWithCustomError(safe, "NotOwner");
    expect(await ethers.provider.getBalance(await safe.getAddress())).to.equal(FIVE);
    await expect(safe.connect(owner).pay(owner.address, FIVE)).to.changeEtherBalance(owner, FIVE);
    await expect(safe.connect(owner).pay(ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(safe, "ZeroAddress");
  });
});
