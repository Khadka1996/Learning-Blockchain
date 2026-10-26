"use strict";
/* Checks the evening exercise solutions (npm run ex). */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");
const R = require("../src/rollup");
const ex1 = require("../exercises/solutions/ex1-bisection");
const ex2 = require("../exercises/solutions/ex2-breakeven");
const ex3 = require("../exercises/solutions/ex3-price-model");
const { deployOracles, ETH_USD_8 } = require("../src/deploy");

describe("Evening exercises", function () {
  this.timeout(120_000);

  it("ex1: ⌈log2 n⌉ matches the measured bisection rounds, for every lie position", () => {
    expect([1, 2, 3, 4, 5, 1000].map(ex1.roundsFor)).to.deep.equal([0, 1, 2, 2, 3, 10]);
    expect(() => ex1.roundsFor(0)).to.throw();
    for (const n of [2, 3, 7, 16, 100]) {
      for (const k of [0, Math.floor(n / 2), n - 1]) {
        const r = ex1.measuredRounds(n, k);
        expect(r.fraud).to.equal(true);
        expect(r.index).to.equal(k);
        expect(r.rounds).to.be.at.most(ex1.roundsFor(n));
      }
    }
  });

  it("ex2: the closed-form break-even matches the measured one (±1) and is small", () => {
    const measured = R.breakEvenBatchSize();
    const est = ex2.estimateBreakEven(ex2.avgGasPerTx());
    expect(measured).to.be.within(2, 5);
    expect(Math.abs(measured - est)).to.be.at.most(1);
    expect(R.batchCost(R.randomTxs(measured - 1, 50)).gasPerTx).to.be.gte(R.L1_TRANSFER_GAS);
  });

  it("ex3: the JavaScript model agrees with the Solidity SafePriceReader on random inputs (differential fuzz)", async () => {
    const { feed, Safe } = await deployOracles({ heartbeat: 3600, min: 100, max: 100_000 });
    const l1 = await Safe.deploy(feed, ethers.ZeroAddress, 3600, 0, ETH_USD_8(100), ETH_USD_8(100_000)); // L1 mode
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: -5n, max: ETH_USD_8(200_000) }),
        fc.integer({ min: -3, max: 7200 }), // seconds in the past (negative = future)
        async (answer, ageBack) => {
          const now = (await ethers.provider.getBlock("latest")).timestamp + 1;
          await ethers.provider.send("evm_setNextBlockTimestamp", [now]);
          const updatedAt = now - ageBack;
          await feed.updateRoundData(answer, updatedAt, updatedAt);
          await ethers.provider.send("evm_setNextBlockTimestamp", [now + 1]);
          await ethers.provider.send("evm_mine", []);
          // Hardhat runs eth_call at the timestamp of the latest block, so the model must use that same "now".
          const callTime = (await ethers.provider.getBlock("latest")).timestamp;
          const m = ex3.modelPrice({ answer, updatedAt, now: callTime, heartbeat: 3600, min: ETH_USD_8(100), max: ETH_USD_8(100_000) });
          if (m.ok) expect(await l1.price()).to.equal(m.price);
          else await expect(l1.price()).to.be.revertedWithCustomError(l1, m.error);
        },
      ),
      { numRuns: 25 },
    );
  });
});
