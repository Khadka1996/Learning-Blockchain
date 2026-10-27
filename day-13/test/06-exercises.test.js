"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");
const { fits, truncateToFit, byteLength } = require("../exercises/solutions/ex1-bytes");
const { fetchAllTips, pagesNeeded } = require("../exercises/solutions/ex2-fetch-all");
const { leaderboard } = require("../exercises/solutions/ex3-leaderboard");

const MIN = 10n ** 14n;
async function deploy() {
  return (await ethers.getContractFactory("TipJar")).deploy();
}

describe("Evening exercises (solutions)", function () {
  it("ex1: fits() agrees with the real contract; truncateToFit() always fits and keeps whole characters", async function () {
    const jar = await deploy();
    await fc.assert(
      fc.asyncProperty(fc.fullUnicodeString({ maxLength: 160 }), async (s) => {
        let accepted = true;
        try { await jar.tip.staticCall(s, { value: MIN }); } catch { accepted = false; }
        expect(fits(s)).to.equal(accepted);
        const t = truncateToFit(s);
        expect(byteLength(t)).to.be.at.most(140);
        expect(s.startsWith(t)).to.equal(true);
        expect(t).to.equal(t.toWellFormed());
      }),
      { numRuns: 60 }
    );
    expect(fits("")).to.equal(false);
    expect(fits("🔗".repeat(35))).to.equal(true); // 140 bytes
    expect(fits("🔗".repeat(36))).to.equal(false); // 144 bytes
    expect(byteLength(truncateToFit("🔗".repeat(36)))).to.equal(140);
  });

  it("ex2: fetchAllTips returns every tip once, newest first (0, 1, 50, 51, 120 tips)", async function () {
    this.timeout(120000);
    const [, a] = await ethers.getSigners();
    for (const n of [0, 1, 50, 51, 120]) {
      const jar = await deploy();
      for (let i = 0; i < n; i++) await jar.connect(a).tip(`m${i}`, { value: MIN });
      const all = await fetchAllTips(jar);
      expect(all.map((t) => t.message)).to.deep.equal(Array.from({ length: n }, (_, i) => `m${n - 1 - i}`));
    }
    expect(pagesNeeded(120, 50)).to.equal(3);
    expect(pagesNeeded(120, 500)).to.equal(3); // page size is capped at 50 by the contract
    expect(pagesNeeded(0, 50)).to.equal(0);
  });

  it("ex3: the event leaderboard sums to totalTipped and breaks ties by address", async function () {
    const jar = await deploy();
    const [, a, b, c] = await ethers.getSigners();
    await jar.connect(a).tip("1", { value: 2n * MIN });
    await jar.connect(b).tip("2", { value: 5n * MIN });
    await jar.connect(a).tip("3", { value: 3n * MIN });
    await jar.connect(c).tip("4", { value: 5n * MIN });
    const board = await leaderboard(jar);
    expect(board).to.have.length(3);
    expect(board.reduce((s, r) => s + r.total, 0n)).to.equal(await jar.totalTipped());
    expect(board[0].total).to.equal(5n * MIN);
    expect(board[1].total).to.equal(5n * MIN); // a, b and c all total 5 units: a tie, broken by address
    expect(board.map((r) => r.address)).to.deep.equal([a.address, b.address, c.address].sort((x, y) => (x < y ? -1 : 1)));
    expect(await leaderboard(await deploy())).to.deep.equal([]);
  });
});
