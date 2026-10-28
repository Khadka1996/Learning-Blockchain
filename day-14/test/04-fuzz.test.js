"use strict";
// Property-based (fuzz) tests with fast-check: random inputs, rules that must ALWAYS hold.
const { expect } = require("chai");
const fc = require("fast-check");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { buildUserOp } = require("../src/userop");

const E = ethers.parseEther;
const DAY = 86400;

async function deploy() {
  const [funder, owner, guardian, bob] = await ethers.getSigners();
  const entryPoint = await ethers.deployContract("EntryPoint");
  const wallet = await ethers.deployContract("SmartWallet", [entryPoint, owner, guardian, E("1")]);
  await funder.sendTransaction({ to: wallet, value: E("100") });
  return { owner, bob, entryPoint, wallet };
}

describe("Fuzz — SmartWallet daily limit", function () {
  it("for ANY sequence of sends and time jumps, no calendar day ever sends more than the limit", async function () {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ milli: fc.integer({ min: 0, max: 1200 }), wait: fc.integer({ min: 0, max: 2 * DAY }) }), { minLength: 1, maxLength: 12 }),
        async (steps) => {
          const { owner, bob, wallet } = await loadFixture(deploy);
          const sentPerDay = new Map();
          for (const { milli, wait } of steps) {
            if (wait) await time.increase(wait);
            const value = E("0.001") * BigInt(milli); // 0 … 1.2 ETH
            try {
              await wallet.connect(owner).execute(bob.address, value, "0x");
              const d = Math.floor((await time.latest()) / DAY);
              sentPerDay.set(d, (sentPerDay.get(d) ?? 0n) + value);
            } catch (e) {
              expect(String(e)).to.include("DailyLimitExceeded");
            }
            expect(await wallet.spentToday()).to.be.lessThanOrEqual(await wallet.dailyLimit());
          }
          for (const total of sentPerDay.values()) expect(total).to.be.lessThanOrEqual(E("1"));
        },
      ),
      { numRuns: 25 },
    );
  });

  it("maxGasCost() matches the EntryPoint's prefund formula for any gas numbers", async function () {
    const { entryPoint, wallet, bob } = await loadFixture(deploy);
    const u = (max) => fc.bigInt({ min: 0n, max });
    await fc.assert(
      fc.asyncProperty(u(10_000_000n), u(10_000_000n), u(10_000_000n), u(10n ** 15n), async (vgl, cgl, pvg, fee) => {
        const op = await buildUserOp({ entryPoint, wallet, dest: bob.address, nonce: 0n,
          gas: { verificationGasLimit: vgl, callGasLimit: cgl, preVerificationGas: pvg, maxFeePerGas: fee, maxPriorityFeePerGas: 0n } });
        expect(await wallet.maxGasCost(op)).to.equal((vgl + cgl + pvg) * fee);
      }),
      { numRuns: 40 },
    );
  });
});
