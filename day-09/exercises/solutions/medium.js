"use strict";
// Day 09 — Medium exercise: a pull-payment auction that a stubborn bidder cannot block.
const { ethers, network } = require("hardhat");

const eth = (n) => ethers.parseEther(String(n));

async function main() {
  const [, alice, bob] = await ethers.getSigners();
  const auction = await ethers.deployContract("PullAuction", [24 * 3600]);
  const stubborn = await ethers.deployContract("StubbornBidder");

  await stubborn.bidOn(await auction.getAddress(), { value: eth(1) });
  console.log("StubbornBidder (cannot receive ETH) bids 1 ETH");
  await auction.connect(alice).bid({ value: eth(2) });
  console.log("Alice bids 2 ETH -> accepted (a push refund to the stubborn bidder would have reverted)");
  await auction.connect(bob).bid({ value: eth(3) });
  console.log("Bob bids 3 ETH -> accepted. Highest bidder:", (await auction.highestBidder()) === bob.address ? "Bob" : "?");
  console.log("Waiting for the stubborn bidder in pendingReturns:", ethers.formatEther(await auction.pendingReturns(await stubborn.getAddress())), "ETH");

  const before = await ethers.provider.getBalance(alice.address);
  const r = await (await auction.connect(alice).withdraw()).wait();
  const got = (await ethers.provider.getBalance(alice.address)) - before + r.gasUsed * r.gasPrice;
  console.log("Alice withdraws her refund:", ethers.formatEther(got), "ETH");

  await network.provider.send("evm_increaseTime", [24 * 3600 + 1]);
  await network.provider.send("evm_mine", []);
  const sellerBefore = await ethers.provider.getBalance(await auction.seller());
  await auction.settle();
  console.log("After the end, the seller collects:", ethers.formatEther((await ethers.provider.getBalance(await auction.seller())) - sellerBefore), "ETH (minus gas)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
