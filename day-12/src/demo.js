"use strict";
/* Day 12 — guided tour on a local Hardhat chain: oracles (naive vs safe) and a bridge (naive vs safe). */
const { ethers, network } = require("hardhat");
const { HOUR, ETH_USD_8, deployOracles, makeValidators, deployBridges, signMint, signNaive, readDeposits } = require("./deploy");

const usd = (x) => "$" + Number(ethers.formatUnits(x, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const wait = async (s) => {
  await network.provider.send("evm_increaseTime", [s]);
  await network.provider.send("evm_mine");
};
async function show(label, naive, safe, amount = ethers.parseEther("1")) {
  let n;
  try {
    n = usd(await naive.usdValue(amount));
  } catch (e) {
    n = /overflow|0x11/i.test(e.message) ? "CRASH: overflow (uint256(-1) is huge)" : "revert";
  }
  let s;
  try {
    s = usd(await safe.usdValue(amount));
  } catch (e) {
    const err = safe.interface.parseError(e.data);
    s = `REFUSED: ${err.name}(${err.args.map(String).join(", ")})`;
  }
  console.log(`  ${label.padEnd(38)} naive: ${n.padEnd(38)} safe: ${s}`);
}

async function main() {
  console.log("\n=== Part A — Oracles: what is 1 ETH worth? ===\n");
  const { feed, seq, naive, safe } = await deployOracles({ price: 2000 });
  await show("1. fresh price $2,000", naive, safe);

  await wait(2 * HOUR); // the feed stops updating (nodes down / chain congested)
  await show("2. feed silent for 2 hours", naive, safe);

  await feed.updateAnswer(0);
  await show("3. feed reports 0", naive, safe);

  await feed.updateAnswer(-1);
  await show("4. feed reports -1", naive, safe);

  await feed.updateAnswer(ETH_USD_8(1_000_000));
  await show("5. feed reports $1,000,000 (glitch)", naive, safe);

  await feed.updateAnswer(ETH_USD_8(1800));
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await seq.updateRoundData(1, now, now); // L2 sequencer goes down
  await show("6. L2 sequencer down", naive, safe);

  await seq.updateRoundData(0, now + 60, now + 60); // back up a minute later
  await wait(120);
  await feed.updateAnswer(ETH_USD_8(1800));
  await show("7. sequencer back 1 min ago", naive, safe);

  await wait(HOUR);
  await feed.updateAnswer(ETH_USD_8(1800));
  await show("8. grace period over, fresh $1,800", naive, safe);

  console.log("\n=== Part B — A lock-and-mint bridge with 2-of-3 validators ===\n");
  const [, alice, attacker] = await ethers.getSigners();
  const validators = makeValidators(3);
  const b = await deployBridges({ validators, threshold: 2 });
  await b.token.transfer(alice, ethers.parseEther("1000"));
  await b.token.connect(alice).approve(b.lockbox, ethers.MaxUint256);
  await b.lockbox.connect(alice).deposit(alice, ethers.parseEther("100"));

  const [d] = await readDeposits(b.lockbox);
  console.log(`  Alice locks ${ethers.formatEther(d.amount)} tUSD on "L1" → deposit #${d.depositId}`);
  const sigs = await signMint(b.bridge, validators.slice(0, 2), { srcChainId: b.srcChainId, ...d });
  await b.bridge.connect(alice).mint(b.srcChainId, d.depositId, d.to, d.amount, sigs);
  console.log(`  2 of 3 validators sign → SafeBridge mints ${ethers.formatEther(await b.wrapped.balanceOf(alice))} wtUSD`);
  try {
    await b.bridge.connect(attacker).mint(b.srcChainId, d.depositId, d.to, d.amount, sigs);
  } catch (e) {
    console.log(`  Replay the same signatures       → SafeBridge: ${b.bridge.interface.parseError(e.data).name}`);
  }

  // NaiveBridge: validators sign only (to, amount)
  const nSigs = await signNaive(validators.slice(0, 2), alice.address, ethers.parseEther("100"));
  for (let i = 0; i < 5; i++) await b.naive.connect(attacker).mint(alice, ethers.parseEther("100"), nSigs);
  console.log(`  NaiveBridge, same 2 sigs sent 5x → ${ethers.formatEther(await b.naiveWrapped.totalSupply())} nwtUSD minted for a 100 tUSD lock`);
  const one = await signNaive([validators[0]], attacker.address, ethers.parseEther("1000000"));
  await b.naive.connect(attacker).mint(attacker, ethers.parseEther("1000000"), [one[0], one[0]]);
  console.log(`  NaiveBridge, ONE validator signs twice → attacker mints ${ethers.formatEther(await b.naiveWrapped.balanceOf(attacker))} nwtUSD`);
  console.log(`\n  Locked on L1: ${ethers.formatEther(await b.token.balanceOf(b.lockbox))} tUSD · backed wtUSD: ${ethers.formatEther(await b.wrapped.totalSupply())} · unbacked nwtUSD: ${ethers.formatEther(await b.naiveWrapped.totalSupply())}\n`);
  console.log("Rollup batching + fraud proof demo: npm run rollup\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
