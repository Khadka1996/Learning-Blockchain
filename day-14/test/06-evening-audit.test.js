"use strict";
// Evening audit — a second, independent review. Findings L1, L2 (fixed) and K7 (documented).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { poseidonHash, randomSecret, proveSecret, toSolidity } = require("../src/zk");

const E = ethers.parseEther;
const DAY = 24 * 3600;

async function deploy() {
  const [bundler, owner, guardian, bob, thief] = await ethers.getSigners();
  const entryPoint = await ethers.deployContract("EntryPoint");
  const wallet = await ethers.deployContract("SmartWallet", [entryPoint, owner, guardian, E("1")]);
  await bundler.sendTransaction({ to: wallet, value: E("5") });
  return { bundler, owner, guardian, bob, thief, entryPoint, wallet };
}

describe("Evening audit — SmartWallet", function () {
  it("L1a: owner and guardian must be different addresses (else the 'owner can only lower' rule means nothing)", async function () {
    const [, owner] = await ethers.getSigners();
    const entryPoint = await ethers.deployContract("EntryPoint");
    await expect(ethers.deployContract("SmartWallet", [entryPoint, owner, owner, E("1")]))
      .to.be.revertedWithCustomError(await ethers.getContractFactory("SmartWallet"), "OwnerIsGuardian");
  });

  it("L1b: the guardian cannot recover the wallet INTO itself (it would then raise the limit freely)", async function () {
    const { guardian, wallet } = await loadFixture(deploy);
    await expect(wallet.connect(guardian).startRecovery(guardian.address))
      .to.be.revertedWithCustomError(wallet, "OwnerIsGuardian");
  });

  it("L1c: recovering to the current owner is refused (it would only confuse the owner's alerts)", async function () {
    const { owner, guardian, wallet } = await loadFixture(deploy);
    await expect(wallet.connect(guardian).startRecovery(owner.address))
      .to.be.revertedWithCustomError(wallet, "AlreadyOwner");
  });

  it("K7 (known issue): the limit is per UTC calendar day, so 2x the limit can leave around midnight", async function () {
    const { owner, bob, wallet } = await loadFixture(deploy);
    const midnight = (Math.floor((await time.latest()) / DAY) + 2) * DAY; // a future UTC midnight
    await time.increaseTo(midnight - 30);
    await wallet.connect(owner).execute(bob.address, E("1"), "0x"); // last seconds of day N
    await time.increaseTo(midnight + 5);
    await wallet.connect(owner).execute(bob.address, E("1"), "0x"); // first seconds of day N+1
    // 2 ETH left in about 35 seconds, with a "1 ETH per day" limit. Accepted: see QA.md K7.
    expect(await ethers.provider.getBalance(wallet)).to.be.lessThan(E("3.1"));
  });
});

describe("Evening audit — ZkPrize", function () {
  async function setup() {
    const [deployer, alice] = await ethers.getSigners();
    const secret = randomSecret();
    const lock = await poseidonHash(secret);
    const verifier = await ethers.deployContract("SecretVerifier");
    const prize = await ethers.deployContract("ZkPrize", [verifier, lock], { value: E("1") });
    return { deployer, alice, secret, prize };
  }

  it("L2: a proof that names the prize contract itself as recipient is refused (it would lock the ETH forever)", async function () {
    const { secret, prize } = await setup();
    const { proof } = await proveSecret(secret, await prize.getAddress());
    const { a, b, c } = toSolidity(proof);
    await expect(prize.claim(a, b, c, await prize.getAddress()))
      .to.be.revertedWithCustomError(prize, "RecipientIsPrize");
    expect(await ethers.provider.getBalance(prize)).to.equal(E("1"));
    expect(await prize.claimed()).to.equal(false);
  });
});
