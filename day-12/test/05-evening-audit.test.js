"use strict";
/* Evening audit (independent second pass) — one test per finding in QA.md "Evening audit". */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const R = require("../src/rollup");
const { HOUR, ETH_USD_8, deployOracles, makeValidators, deployBridges, readDeposits } = require("../src/deploy");

describe("Evening audit (see QA.md)", function () {
  it("E1: a sequencer bond must be a positive whole number (no negative, NaN, fractional or string bonds)", () => {
    const l1 = new R.RollupL1([100, 100]);
    for (const bad of [-5, 0, NaN, Infinity, 1.5, "5", null, undefined, 2 ** 53]) {
      expect(() => l1.depositBond("seq", bad), String(bad)).to.throw("BadBond");
    }
    l1.depositBond("seq", 10);
    expect(l1.bonds.get("seq")).to.equal(10);
    // a bond that would overflow exact arithmetic is refused too
    expect(() => l1.depositBond("seq", Number.MAX_SAFE_INTEGER)).to.throw("BadBond");
  });

  it("E2: only canonical 65-byte signatures are accepted — a 64-byte (EIP-2098) re-encoding of a signature is refused, so one validator cannot be counted twice", async () => {
    const v = makeValidators(3);
    const [, alice] = await ethers.getSigners();
    const b = await deployBridges({ validators: v, threshold: 2 });
    await b.token.transfer(alice, ethers.parseEther("10"));
    await b.token.connect(alice).approve(b.lockbox, ethers.MaxUint256);
    await b.lockbox.connect(alice).deposit(alice, ethers.parseEther("10"));
    const [d] = await readDeposits(b.lockbox);
    const digest = await b.bridge.mintDigest(b.srcChainId, d.depositId, d.to, d.amount);
    const full = v.map((w) => w.signingKey.sign(digest));
    await expect(
      b.bridge.mint(b.srcChainId, d.depositId, d.to, d.amount, [full[0].serialized, full[0].compactSerialized]),
    ).to.be.revertedWithCustomError(b.bridge, "ECDSAInvalidSignatureLength");
    await expect(
      b.bridge.mint(b.srcChainId, d.depositId, d.to, d.amount, [full[0].serialized, full[0].serialized]),
    ).to.be.revertedWithCustomError(b.bridge, "NotValidatorOrUnsorted");
    await b.bridge.mint(b.srcChainId, d.depositId, d.to, d.amount, [full[0].serialized, full[1].serialized]);
    expect(await b.wrapped.balanceOf(alice)).to.equal(d.amount);
  });

  it("E3: oracle band edges — min and max themselves are accepted, one unit outside is refused", async () => {
    const { feed, safe } = await deployOracles({ min: 100, max: 100_000 });
    await feed.updateAnswer(ETH_USD_8(100));
    expect(await safe.price()).to.equal(ethers.parseEther("100"));
    await feed.updateAnswer(ETH_USD_8(100_000));
    expect(await safe.price()).to.equal(ethers.parseEther("100000"));
    await feed.updateAnswer(ETH_USD_8(100_000) + 1n);
    await expect(safe.price()).to.be.revertedWithCustomError(safe, "PriceOutOfBounds");
    await feed.updateAnswer(ETH_USD_8(100) - 1n);
    await expect(safe.price()).to.be.revertedWithCustomError(safe, "PriceOutOfBounds");
  });

  it("E4: sequencer grace period — refused while the restart is younger than gracePeriod, accepted just after", async () => {
    const { feed, seq, safe } = await deployOracles({ grace: HOUR });
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const restart = now + 100;
    await seq.updateRoundData(0, restart, restart);
    const warp = async (t) => {
      await ethers.provider.send("evm_setNextBlockTimestamp", [t]);
      await feed.updateAnswer(ETH_USD_8(2000)); // keeps the price itself fresh: only the grace rule is tested
    };
    await warp(restart + HOUR - 60);
    await expect(safe.price()).to.be.revertedWithCustomError(safe, "GracePeriodNotOver");
    await warp(restart + HOUR + 60);
    expect(await safe.price()).to.equal(ethers.parseEther("2000"));
  });

  it("E5: the rollup state root cannot be confused by the odd-leaf duplication trick (Bitcoin CVE-2012-2459 style)", () => {
    expect(R.stateRoot([1, 2, 3])).to.not.equal(R.stateRoot([1, 2, 3, 3]));
    expect(R.stateRoot([1, 2, 3])).to.not.equal(R.stateRoot([1, 2, 3, 0]));
    expect(R.stateRoot([])).to.not.equal(R.stateRoot([0]));
  });

  it("E6: a challenge exactly at the window edge is refused, one second earlier is accepted", () => {
    const g = [100, 100, 100];
    const l1 = new R.RollupL1(g);
    l1.depositBond("seq", 10);
    const txs = [{ from: 0, to: 1, amount: 5 }];
    const honest = R.executeBatch(g, txs);
    const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: honest.roots.at(-1), now: 0 });
    const ch = { rootAt: (i) => honest.roots[i], stateAt: (i) => honest.states[i] };
    expect(() => l1.challenge(id, R.CHALLENGE_WINDOW, (i) => honest.roots[i], ch, "w")).to.throw("ChallengeWindowClosed");
    expect(l1.challenge(id, R.CHALLENGE_WINDOW - 1, (i) => honest.roots[i], ch, "w").fraud).to.equal(false);
  });
});
