"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { pauseMining, resumeMining, mineBlock, spyOnMempool, tip, statusOf } = require("./helpers");

const PRIZE = ethers.parseEther("2");
const ANSWER = "satoshi";
const answerHash = ethers.keccak256(ethers.toUtf8Bytes(ANSWER));

describe("4. Front-running", function () {
  async function deploy() {
    const [deployer, alice, bot] = await ethers.getSigners();
    const vulnerable = await ethers.deployContract("HashPuzzle", [answerHash], { value: PRIZE });
    const safe = await ethers.deployContract("CommitRevealPuzzle", [answerHash], { value: PRIZE });
    return { deployer, alice, bot, vulnerable, safe };
  }

  afterEach(resumeMining); // never leave automine off for the next test

  it("EXPLOIT: a bot copies Alice's pending answer with a higher tip and takes the prize", async function () {
    const { alice, bot, vulnerable } = await loadFixture(deploy);
    await pauseMining();
    const aliceTx = await vulnerable.connect(alice).solve(ANSWER, tip(2));

    const seen = await spyOnMempool(vulnerable, "solve");
    expect(seen.args[0]).to.equal(ANSWER); // the answer is in plain sight
    const botTx = await vulnerable.connect(bot).solve(seen.args[0], tip(50));
    await mineBlock();

    const [a, b] = [await statusOf(aliceTx), await statusOf(botTx)];
    expect(b.blockNumber).to.equal(a.blockNumber);
    expect(b.index).to.be.lessThan(a.index); // bot sent second, but runs first
    expect(b.ok).to.equal(true);
    expect(a.ok).to.equal(false); // AlreadySolved
    expect(await vulnerable.winner()).to.equal(bot.address);
  });

  it("FIX: copying Alice's reveal is useless; Alice wins with commit–reveal", async function () {
    const { alice, bot, safe } = await loadFixture(deploy);
    const salt = ethers.hexlify(ethers.randomBytes(32));
    await safe.connect(alice).commit(await safe.makeCommitment(alice.address, ANSWER, salt)); // block N

    await pauseMining();
    const aliceTx = await safe.connect(alice).reveal(ANSWER, salt, tip(2));
    const seen = await spyOnMempool(safe, "reveal");
    const botCopy = await safe.connect(bot).reveal(seen.args[0], seen.args[1], tip(50));
    // A smarter bot also tries to commit + reveal in the SAME block. Too late:
    const botCommit = await safe.connect(bot).commit(await safe.makeCommitment(bot.address, ANSWER, salt), tip(60));
    const botReveal = await safe.connect(bot).reveal(ANSWER, salt, tip(40));
    await mineBlock();

    expect((await statusOf(botCopy)).ok).to.equal(false); // NoCommitment
    expect((await statusOf(botCommit)).ok).to.equal(true);
    expect((await statusOf(botReveal)).ok).to.equal(false); // RevealTooEarly
    expect((await statusOf(aliceTx)).ok).to.equal(true);
    expect(await safe.winner()).to.equal(alice.address);
  });

  it("the commitment reveals nothing and is bound to one address", async function () {
    const { alice, bot, safe } = await loadFixture(deploy);
    const salt = ethers.id("alice-secret-salt");
    const c = await safe.makeCommitment(alice.address, ANSWER, salt);
    expect(c).to.not.equal(answerHash);
    expect(c).to.equal(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "string", "bytes32"], [alice.address, ANSWER, salt])));
    // Bot copies Alice's COMMIT (the envelope) — it still opens only for Alice's address.
    await safe.connect(bot).commit(c);
    await safe.connect(alice).commit(c);
    await mineBlock();
    await expect(safe.connect(bot).reveal(ANSWER, salt)).to.be.revertedWithCustomError(safe, "CommitmentMismatch");
    await expect(safe.connect(alice).reveal(ANSWER, salt)).to.changeEtherBalance(alice, PRIZE);
  });

  it("FIX edge cases: empty, missing, same-block, wrong salt, wrong answer, already solved", async function () {
    const { alice, bot, safe } = await loadFixture(deploy);
    const salt = ethers.id("s");
    await expect(safe.connect(alice).commit(ethers.ZeroHash)).to.be.revertedWithCustomError(safe, "EmptyCommitment");
    await expect(safe.connect(alice).reveal(ANSWER, salt)).to.be.revertedWithCustomError(safe, "NoCommitment");

    await pauseMining();
    await safe.connect(alice).commit(await safe.makeCommitment(alice.address, ANSWER, salt), tip(5));
    const sameBlock = await safe.connect(alice).reveal(ANSWER, salt, tip(1));
    await mineBlock();
    await resumeMining();
    expect((await statusOf(sameBlock)).ok).to.equal(false);
    await expect(safe.connect(alice).reveal(ANSWER, ethers.id("other"))).to.be.revertedWithCustomError(safe, "CommitmentMismatch");

    await safe.connect(bot).commit(await safe.makeCommitment(bot.address, "wrong", salt));
    await expect(safe.connect(bot).reveal("wrong", salt)).to.be.revertedWithCustomError(safe, "WrongAnswer");

    await safe.connect(alice).reveal(ANSWER, salt);
    await expect(safe.connect(bot).commit(ethers.id("x"))).to.be.revertedWithCustomError(safe, "AlreadySolved");
    await expect(safe.connect(bot).reveal(ANSWER, salt)).to.be.revertedWithCustomError(safe, "AlreadySolved");
    expect(await ethers.provider.getBalance(await safe.getAddress())).to.equal(0n);
  });

  it("HashPuzzle: wrong answer and second solve revert", async function () {
    const { alice, vulnerable } = await loadFixture(deploy);
    await expect(vulnerable.connect(alice).solve("nakamoto")).to.be.revertedWithCustomError(vulnerable, "WrongAnswer");
    await vulnerable.connect(alice).solve(ANSWER);
    await expect(vulnerable.connect(alice).solve(ANSWER)).to.be.revertedWithCustomError(vulnerable, "AlreadySolved");
  });
});
