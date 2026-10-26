"use strict";
/* Tests written during the QA / pentest rounds — one per finding in QA.md. */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const R = require("../src/rollup");
const { HOUR, ETH_USD_8, makeValidators, deployBridges, signMint, readDeposits } = require("../src/deploy");

describe("QA findings (see QA.md)", function () {
  it("L1: rollup refuses a genesis whose balances cannot be represented exactly; transfers never lose precision", () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(() => new R.RollupL1([big, 10])).to.throw("BadGenesis");
    expect(() => new R.RollupL1([1.5, 10])).to.throw("BadGenesis");
    expect(() => new R.RollupL1([-1, 10])).to.throw("BadGenesis");
    // Even if handed such a state directly, applyTx treats the overflowing transfer as a no-op.
    expect(R.applyTx([big, 10], { from: 1, to: 0, amount: 10 })).to.deep.equal([big, 10]);
  });

  it("L2: SafePriceReader with feed = address(0) fails with a clear BadConfig, not an empty revert", async () => {
    const Safe = await ethers.getContractFactory("SafePriceReader");
    await expect(
      Safe.deploy(ethers.ZeroAddress, ethers.ZeroAddress, HOUR, 0, ETH_USD_8(1), ETH_USD_8(2)),
    ).to.be.revertedWithCustomError(Safe, "BadConfig");
  });

  it("L3: a WrappedToken wired to address(0) (unmintable forever) cannot be deployed", async () => {
    const W = await ethers.getContractFactory("WrappedToken");
    await expect(W.deploy("x", "x", ethers.ZeroAddress)).to.be.revertedWithCustomError(W, "NotBridge");
  });

  it("P1: fee-on-transfer token — the lockbox records what ARRIVED (99), so L2 can never mint more than is locked", async () => {
    const [owner] = await ethers.getSigners();
    const fee = await (await ethers.getContractFactory("FeeToken")).deploy(ethers.parseEther("1000"));
    const box = await (await ethers.getContractFactory("L1Lockbox")).deploy(fee);
    await fee.approve(box, ethers.MaxUint256);
    await box.deposit(owner, ethers.parseEther("100"));
    const [d] = await readDeposits(box);
    expect(d.amount).to.equal(ethers.parseEther("99"));
    expect(await fee.balanceOf(box)).to.equal(d.amount);
  });

  it("P2: front-running a relay is harmless — the tokens still go to the recipient in the signed message", async () => {
    const [, alice, mev] = await ethers.getSigners();
    const v = makeValidators(3);
    const b = await deployBridges({ validators: v, threshold: 2 });
    await b.token.transfer(alice, ethers.parseEther("10"));
    await b.token.connect(alice).approve(b.lockbox, ethers.MaxUint256);
    await b.lockbox.connect(alice).deposit(alice, ethers.parseEther("10"));
    const [d] = await readDeposits(b.lockbox);
    const sigs = await signMint(b.bridge, [v[0], v[1]], { srcChainId: b.srcChainId, ...d });
    await b.bridge.connect(mev).mint(b.srcChainId, d.depositId, d.to, d.amount, sigs); // MEV bot copies the tx
    expect(await b.wrapped.balanceOf(alice)).to.equal(ethers.parseEther("10"));
    expect(await b.wrapped.balanceOf(mev)).to.equal(0n);
  });

  it("P3: a signature for deposit #0 cannot be reused for deposit #1 with the same recipient and amount", async () => {
    const [, alice] = await ethers.getSigners();
    const v = makeValidators(3);
    const b = await deployBridges({ validators: v, threshold: 2 });
    await b.token.transfer(alice, ethers.parseEther("10"));
    await b.token.connect(alice).approve(b.lockbox, ethers.MaxUint256);
    await b.lockbox.connect(alice).deposit(alice, ethers.parseEther("5"));
    const [d0] = await readDeposits(b.lockbox);
    const sigs = await signMint(b.bridge, [v[0], v[1]], { srcChainId: b.srcChainId, ...d0 });
    await expect(b.bridge.mint(b.srcChainId, 1, d0.to, d0.amount, sigs)).to.be.revertedWithCustomError(
      b.bridge,
      "NotValidatorOrUnsorted",
    );
  });

  it("P4: a sequencer that challenges its OWN fraud still loses half its bond (no free exit)", () => {
    const g = Array(10).fill(100);
    const txs = R.randomTxs(16, 10, 4);
    const run = R.executeBatch(g, txs);
    const lies = R.cheatingRoots(g, txs, 5, 0, 50);
    const l1 = new R.RollupL1(g);
    l1.depositBond("seq", 10);
    const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: lies.at(-1), now: 0 });
    l1.challenge(id, 1, (i) => lies[i], { rootAt: (i) => run.roots[i], stateAt: (i) => run.states[i] }, "seq");
    expect(l1.bonds.get("seq")).to.equal(5);
  });
});
