"use strict";
// Tests for the evening exercises (see exercises/README.md).
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const eth = (n) => ethers.parseEther(String(n));

describe("8. Exercises", function () {
  it("easy: a commitment built by hand equals makeCommitment; packed strings collide, abi.encode does not", async function () {
    const [, alice] = await ethers.getSigners();
    const puzzle = await ethers.deployContract("CommitRevealPuzzle", [ethers.keccak256(ethers.toUtf8Bytes("x"))]);
    const salt = ethers.id("salt");
    const byHand = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "string", "bytes32"], [alice.address, "satoshi", salt]));
    expect(await puzzle.makeCommitment(alice.address, "satoshi", salt)).to.equal(byHand);
    const packed = (a, b) => ethers.keccak256(ethers.solidityPacked(["string", "string"], [a, b]));
    const enc = (a, b) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], [a, b]));
    expect(packed("ab", "c")).to.equal(packed("a", "bc"));
    expect(enc("ab", "c")).to.not.equal(enc("a", "bc"));
  });

  it("medium: a bidder that cannot receive ETH does not block PullAuction; refunds are pulled", async function () {
    const [, alice, bob] = await ethers.getSigners();
    const auction = await ethers.deployContract("PullAuction", [3600]);
    const stubborn = await ethers.deployContract("StubbornBidder");
    await stubborn.bidOn(await auction.getAddress(), { value: eth(1) });
    await auction.connect(alice).bid({ value: eth(2) });
    await auction.connect(bob).bid({ value: eth(3) });
    expect(await auction.highestBidder()).to.equal(bob.address);
    expect(await auction.pendingReturns(await stubborn.getAddress())).to.equal(eth(1));
    await expect(auction.connect(alice).bid({ value: eth(3) })).to.be.revertedWithCustomError(auction, "BidTooLow");
    await expect(auction.connect(alice).withdraw()).to.changeEtherBalance(alice, eth(2));
    await expect(auction.connect(alice).withdraw()).to.be.revertedWithCustomError(auction, "NothingToWithdraw");
    await expect(auction.settle()).to.be.revertedWithCustomError(auction, "AuctionNotEnded");
    await network.provider.send("evm_increaseTime", [3601]);
    await network.provider.send("evm_mine", []);
    await expect(auction.connect(alice).bid({ value: eth(9) })).to.be.revertedWithCustomError(auction, "AuctionEnded");
    await expect(auction.connect(bob).settle()).to.be.revertedWithCustomError(auction, "NotSeller");
    await expect(auction.settle()).to.changeEtherBalance(await auction.seller(), eth(3));
    await expect(auction.settle()).to.be.revertedWithCustomError(auction, "AlreadySettled");
  });

  it("challenge: LeakyBank creates ETH out of thin air; SafeBank does not", async function () {
    const [, alice, bob] = await ethers.getSigners();
    const leaky = await ethers.deployContract("LeakyBank");
    await leaky.connect(alice).deposit({ value: eth(1) });
    await leaky.connect(alice).transferBalance(bob.address, eth(1));
    const owed = (await leaky.balanceOf(alice.address)) + (await leaky.balanceOf(bob.address));
    expect(owed).to.equal(eth(2)); // bank owes 2 ETH but holds 1
    expect(await ethers.provider.getBalance(await leaky.getAddress())).to.equal(eth(1));
    const safe = await ethers.deployContract("SafeBank");
    await safe.connect(alice).deposit({ value: eth(1) });
    await safe.connect(alice).transferBalance(bob.address, eth(1));
    expect((await safe.balanceOf(alice.address)) + (await safe.balanceOf(bob.address))).to.equal(eth(1));
  });
});
