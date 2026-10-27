"use strict";
/**
 * Day 13 tour (in-process Hardhat chain): deploy the TipJar, send 3 tips from
 * 3 people, read them back the way the frontend does, show the gas each step
 * costs and what the 3 most common mistakes look like, then withdraw.
 *   npm start
 */
const { ethers } = require("hardhat");

const fmt = (wei) => ethers.formatEther(wei) + " ETH";

async function main() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const jar = await ethers.deployContract("TipJar");
  const deployRx = await jar.deploymentTransaction().wait();
  console.log("=== 1. Deploy (what scripts/deploy.js does) ===");
  console.log(`  TipJar at ${await jar.getAddress()}  gas ${deployRx.gasUsed}`);

  console.log("\n=== 2. Three people send tips (what the Send button does) ===");
  const tips = [
    [alice, "0.001", "Thanks for the Day 12 notes!"],
    [bob, "0.005", "Great series 🔗"],
    [carol, "0.002", "नमस्ते from Kathmandu"],
  ];
  const gas = [];
  for (const [who, amount, msg] of tips) {
    const rx = await (await jar.connect(who).tip(msg, { value: ethers.parseEther(amount) })).wait();
    gas.push(rx.gasUsed);
    const bytes = Buffer.byteLength(msg, "utf8");
    console.log(`  ${who.address.slice(0, 8)}… tipped ${amount} ETH  "${msg}"  (${[...msg].length} characters = ${bytes} bytes)  gas ${rx.gasUsed}`);
  }

  console.log("\n=== 3. Read it back (free: view calls cost no gas) ===");
  const page = await jar.getTips(0, 10);
  page.forEach((t, i) => console.log(`  #${i + 1} newest: ${fmt(t.amount)} "${t.message}"`));
  console.log(`  tipCount ${await jar.tipCount()} · in the jar ${fmt(await ethers.provider.getBalance(jar))}`);

  console.log("\n=== 4. Mistakes the frontend must explain in plain words ===");
  const tries = [
    ["tip of 0.00001 ETH", () => jar.connect(alice).tip.staticCall("hi", { value: ethers.parseEther("0.00001") })],
    ["empty message", () => jar.connect(alice).tip.staticCall("", { value: ethers.parseEther("0.001") })],
    ["141-byte message", () => jar.connect(alice).tip.staticCall("x".repeat(141), { value: ethers.parseEther("0.001") })],
    ["Alice tries to withdraw", () => jar.connect(alice).withdraw.staticCall(alice.address)],
    ["plain ETH send, no tip()", () => alice.call({ to: jar, value: ethers.parseEther("0.001") })],
  ];
  for (const [label, fn] of tries) {
    try {
      await fn();
      console.log(`  ${label.padEnd(26)} → accepted?!`);
    } catch (e) {
      const parsed = jar.interface.parseError(e.data);
      console.log(`  ${label.padEnd(26)} → ${parsed.name}(${parsed.args.join(", ")})`);
    }
  }

  console.log("\n=== 5. Owner withdraws ===");
  const before = await ethers.provider.getBalance(owner);
  const rx = await (await jar.withdraw(owner.address)).wait();
  const after = await ethers.provider.getBalance(owner);
  console.log(`  owner +${fmt(after - before + rx.gasUsed * rx.gasPrice)} (gas ${rx.gasUsed}) · jar now ${fmt(await ethers.provider.getBalance(jar))}`);
  const avg = gas.reduce((a, b) => a + b, 0n) / BigInt(gas.length);
  console.log(`\nAverage tip costs ${avg} gas. At 1 gwei that is ${ethers.formatUnits(avg * 1_000_000_000n, "ether")} ETH.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
