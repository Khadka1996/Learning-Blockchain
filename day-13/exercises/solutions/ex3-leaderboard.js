"use strict";
// Exercise 3 (challenge): rebuild a leaderboard from the TipSent EVENTS, then prove
// it matches the contract: the sum of everyone's tips must equal totalTipped.
async function leaderboard(jar) {
  const events = await jar.queryFilter(jar.filters.TipSent());
  const totals = new Map();
  for (const e of events) {
    const who = e.args.from;
    totals.set(who, (totals.get(who) ?? 0n) + e.args.amount);
  }
  // biggest first; ties broken by address so the order is always the same
  return [...totals.entries()]
    .sort((x, y) => (x[1] === y[1] ? (x[0] < y[0] ? -1 : 1) : x[1] > y[1] ? -1 : 1))
    .map(([address, total]) => ({ address, total }));
}
module.exports = { leaderboard };
if (require.main === module) {
  const hre = require("hardhat");
  (async () => {
    const { ethers } = hre;
    const jar = await (await ethers.getContractFactory("TipJar")).deploy();
    const [, a, b, c] = await ethers.getSigners();
    await jar.connect(a).tip("one", { value: ethers.parseEther("0.002") });
    await jar.connect(b).tip("two", { value: ethers.parseEther("0.005") });
    await jar.connect(a).tip("three", { value: ethers.parseEther("0.004") });
    await jar.connect(c).tip("four", { value: ethers.parseEther("0.001") });
    const board = await leaderboard(jar);
    board.forEach((r, i) => console.log(`#${i + 1} ${r.address.slice(0, 8)}… ${ethers.formatEther(r.total)} ETH`));
    const sum = board.reduce((s, r) => s + r.total, 0n);
    console.log("sum of leaderboard == totalTipped:", sum === (await jar.totalTipped()));
  })();
}
