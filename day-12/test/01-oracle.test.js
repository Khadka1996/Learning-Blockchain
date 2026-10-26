"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const fc = require("fast-check");
const { HOUR, ETH_USD_8, deployOracles } = require("../src/deploy");

const now = async () => BigInt(await time.latest());

describe("Oracles — SafePriceReader vs NaivePriceReader", function () {
  let o;
  beforeEach(async () => {
    o = await deployOracles({ price: 2000 });
  });

  it("fresh price: both agree, scaled from 8 to 18 decimals", async () => {
    expect(await o.safe.price()).to.equal(ethers.parseEther("2000"));
    expect(await o.naive.price()).to.equal(ethers.parseEther("2000"));
    expect(await o.safe.usdValue(ethers.parseEther("2.5"))).to.equal(ethers.parseEther("5000"));
  });

  it("stale price: naive keeps using it, safe refuses after the heartbeat", async () => {
    await time.increase(HOUR + 1);
    expect(await o.naive.price()).to.equal(ethers.parseEther("2000"));
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "StalePrice");
  });

  it("heartbeat boundary: age == heartbeat is accepted, heartbeat + 1 is not", async () => {
    const t = await now();
    await o.feed.updateRoundData(ETH_USD_8(2000), t - BigInt(HOUR) + 1n, t - BigInt(HOUR) + 1n);
    // next view runs at block time t+1 (after the update tx was mined at t+1) → age == HOUR
    expect(await o.safe.price()).to.equal(ethers.parseEther("2000"));
    await time.increase(1);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "StalePrice").withArgs(HOUR + 1, HOUR);
  });

  it("zero and negative answers are refused; naive returns 0 or crashes", async () => {
    await o.feed.updateAnswer(0);
    expect(await o.naive.price()).to.equal(0n);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "InvalidPrice").withArgs(0);
    await o.feed.updateAnswer(-5);
    await expect(o.naive.price()).to.be.revertedWithPanic(0x11);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "InvalidPrice").withArgs(-5);
  });

  it("missing or future timestamp is refused", async () => {
    await o.feed.updateRoundData(ETH_USD_8(2000), 0, 0);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "InvalidTimestamp").withArgs(0);
    const future = (await now()) + 1000n;
    await o.feed.updateRoundData(ETH_USD_8(2000), future, future);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "InvalidTimestamp").withArgs(future);
  });

  it("circuit breaker: answers outside [min, max] are refused", async () => {
    await o.feed.updateAnswer(ETH_USD_8(1_000_000));
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "PriceOutOfBounds");
    await o.feed.updateAnswer(ETH_USD_8(99));
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "PriceOutOfBounds");
    await o.feed.updateAnswer(ETH_USD_8(100));
    expect(await o.safe.price()).to.equal(ethers.parseEther("100"));
  });

  it("L2 sequencer down → refused; back up → refused during the grace period, then accepted", async () => {
    const t = await now();
    await o.seq.updateRoundData(1, t, t);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "SequencerDown");
    expect(await o.naive.price()).to.equal(ethers.parseEther("2000")); // naive has no idea

    const up = (await now()) + 1n;
    await o.seq.updateRoundData(0, up, up);
    await o.feed.updateAnswer(ETH_USD_8(2100));
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "GracePeriodNotOver");
    await time.increase(HOUR + 1);
    await o.feed.updateAnswer(ETH_USD_8(2100));
    expect(await o.safe.price()).to.equal(ethers.parseEther("2100"));
  });

  it("a sequencer status that starts in the future or at 0 is refused", async () => {
    await o.seq.updateRoundData(0, 0, 0);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "InvalidTimestamp").withArgs(0);
    const future = (await now()) + 1000n;
    await o.seq.updateRoundData(0, future, future);
    await expect(o.safe.price()).to.be.revertedWithCustomError(o.safe, "InvalidTimestamp").withArgs(future);
  });

  it("on L1 (no sequencer feed) the sequencer check is skipped", async () => {
    const l1 = await o.Safe.deploy(o.feed, ethers.ZeroAddress, HOUR, 0, ETH_USD_8(100), ETH_USD_8(100_000));
    expect(await l1.price()).to.equal(ethers.parseEther("2000"));
  });

  it("rejects bad configuration", async () => {
    const z = ethers.ZeroAddress;
    await expect(o.Safe.deploy(o.feed, z, 0, 0, 1, 2)).to.be.revertedWithCustomError(o.Safe, "BadConfig");
    await expect(o.Safe.deploy(o.feed, z, HOUR, 0, 0, 2)).to.be.revertedWithCustomError(o.Safe, "BadConfig");
    await expect(o.Safe.deploy(o.feed, z, HOUR, 0, 5, 4)).to.be.revertedWithCustomError(o.Safe, "BadConfig");
    const Feed = await ethers.getContractFactory("MockV3Aggregator");
    const f19 = await Feed.deploy(19, "too many decimals", 1);
    await expect(o.Safe.deploy(f19, z, HOUR, 0, 1, 2)).to.be.revertedWithCustomError(o.Safe, "BadConfig");
  });

  it("handles feeds with other decimals (18 and 0)", async () => {
    const Feed = await ethers.getContractFactory("MockV3Aggregator");
    const f18 = await Feed.deploy(18, "18 dec", ethers.parseEther("3000"));
    const r18 = await o.Safe.deploy(f18, ethers.ZeroAddress, HOUR, 0, 1, ethers.parseEther("1000000"));
    expect(await r18.price()).to.equal(ethers.parseEther("3000"));
    const f0 = await Feed.deploy(0, "0 dec", 3000);
    const r0 = await o.Safe.deploy(f0, ethers.ZeroAddress, HOUR, 0, 1, 1_000_000);
    expect(await r0.price()).to.equal(ethers.parseEther("3000"));
  });

  it("only the reporter can update the mock feed", async () => {
    const [, stranger] = await ethers.getSigners();
    await expect(o.feed.connect(stranger).updateAnswer(1)).to.be.revertedWithCustomError(o.feed, "NotReporter");
  });

  it("fuzz: safe returns a price ONLY when every check passes, and then it equals answer × 1e10", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 14n }), // answer (8 decimals)
        fc.integer({ min: 0, max: 3 * HOUR }), // age in seconds
        async (answer, age) => {
          const t = await now();
          const updatedAt = t + 1n - BigInt(age); // the update tx mines at t+1
          await o.feed.updateRoundData(answer, updatedAt, updatedAt);
          const shouldPass =
            answer > 0n && age <= HOUR && answer >= ETH_USD_8(100) && answer <= ETH_USD_8(100_000);
          if (shouldPass) expect(await o.safe.price()).to.equal(answer * 10n ** 10n);
          else await expect(o.safe.price()).to.be.reverted;
        },
      ),
      { numRuns: Number(process.env.FUZZ_RUNS || 60) },
    );
  });
});
