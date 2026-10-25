"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const fc = require("fast-check");
const { attempt, fundedWallets } = require("./helpers");
const { measureClub } = require("../src/gas");

const FEE = ethers.parseEther("0.01");

for (const name of ["ClubNaive", "ClubOptimized"]) {
  describe(`${name} — behaviour`, function () {
    async function deploy() {
      const [owner, alice, bob, eve] = await ethers.getSigners();
      const club = await (await ethers.getContractFactory(name)).deploy(FEE);
      return { club, owner, alice, bob, eve };
    }

    it("joins with the exact fee; referrer earns 10 points", async function () {
      const { club, alice, bob } = await loadFixture(deploy);
      await expect(club.connect(alice).join(ethers.ZeroAddress, { value: FEE }))
        .to.emit(club, "Joined")
        .withArgs(alice.address, ethers.ZeroAddress);
      await club.connect(bob).join(alice.address, { value: FEE });
      expect(await club.pointsOf(alice.address)).to.equal(10n);
      expect(await club.totalPoints()).to.equal(10n);
      expect(await club.memberCount()).to.equal(2n);
    });

    it("rejects wrong fee, double join, self-referral and unknown referrer", async function () {
      const { club, alice, bob } = await loadFixture(deploy);
      await expect(club.connect(alice).join(ethers.ZeroAddress, { value: FEE - 1n })).to.be.reverted;
      await club.connect(alice).join(ethers.ZeroAddress, { value: FEE });
      await expect(club.connect(alice).join(ethers.ZeroAddress, { value: FEE })).to.be.reverted;
      await expect(club.connect(bob).join(bob.address, { value: FEE })).to.be.reverted;
      const stranger = ethers.Wallet.createRandom().address;
      await expect(club.connect(bob).join(stranger, { value: FEE })).to.be.reverted;
    });

    it("only the owner can add points or withdraw; batch needs members", async function () {
      const { club, owner, alice, eve } = await loadFixture(deploy);
      await club.connect(alice).join(ethers.ZeroAddress, { value: FEE });
      await expect(club.connect(eve).addPointsBatch([alice.address], 1)).to.be.reverted;
      await expect(club.addPointsBatch([alice.address, eve.address], 1)).to.be.reverted;
      await club.addPointsBatch([alice.address, alice.address], 7);
      expect(await club.pointsOf(alice.address)).to.equal(14n);
      expect(await club.totalPoints()).to.equal(14n);
      await expect(club.connect(eve).withdraw(eve.address)).to.be.reverted;
      await expect(club.withdraw(ethers.ZeroAddress)).to.be.reverted;
      await expect(club.withdraw(owner.address)).to.changeEtherBalance(owner, FEE);
    });

    it("an empty batch changes nothing", async function () {
      const { club } = await loadFixture(deploy);
      await club.addPointsBatch([], 123);
      expect(await club.totalPoints()).to.equal(0n);
    });
  });
}

describe("ClubOptimized — custom errors and limits", function () {
  it("reverts with typed custom errors that carry data", async function () {
    const [, alice, eve] = await ethers.getSigners();
    const club = await (await ethers.getContractFactory("ClubOptimized")).deploy(FEE);
    await expect(club.connect(alice).join(ethers.ZeroAddress, { value: 1n }))
      .to.be.revertedWithCustomError(club, "WrongFee")
      .withArgs(1n, FEE);
    await expect(club.connect(eve).addPointsBatch([], 1)).to.be.revertedWithCustomError(club, "NotOwner");
    await expect(club.addPointsBatch([eve.address], 1))
      .to.be.revertedWithCustomError(club, "NotMember")
      .withArgs(eve.address);
  });

  it("caps points at uint32 instead of silently wrapping (packing must not lose data)", async function () {
    const [, alice] = await ethers.getSigners();
    const club = await (await ethers.getContractFactory("ClubOptimized")).deploy(FEE);
    await club.connect(alice).join(ethers.ZeroAddress, { value: FEE });
    const max = 2n ** 32n - 1n;
    await club.addPointsBatch([alice.address], max);
    expect(await club.pointsOf(alice.address)).to.equal(max);
    await expect(club.addPointsBatch([alice.address], 1n))
      .to.be.revertedWithCustomError(club, "PointsOverflow")
      .withArgs(alice.address);
  });
});

describe("Differential fuzz — naive and optimized must behave identically", function () {
  this.timeout(120_000);
  const RUNS = Number(process.env.FUZZ_RUNS || 40);

  it(`${RUNS} random programs of join / batch / withdraw give the same results`, async function () {
    const [owner] = await ethers.getSigners();
    const users = await fundedWallets(6, owner);
    const N = users.length;

    const opArb = fc.oneof(
      fc.record({ kind: fc.constant("join"), who: fc.nat(N - 1), ref: fc.integer({ min: -1, max: N - 1 }), badFee: fc.boolean() }),
      fc.record({ kind: fc.constant("batch"), list: fc.array(fc.nat(N - 1), { maxLength: 5 }), amount: fc.nat(1000), byOwner: fc.boolean() }),
      fc.record({ kind: fc.constant("withdraw") })
    );

    let steps = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), async (ops) => {
        const a = await (await ethers.getContractFactory("ClubNaive", owner)).deploy(FEE);
        const b = await (await ethers.getContractFactory("ClubOptimized", owner)).deploy(FEE);
        for (const op of ops) {
          steps++;
          const run = (c) => {
            if (op.kind === "join") {
              const ref = op.ref < 0 ? ethers.ZeroAddress : users[op.ref].address;
              return c.connect(users[op.who]).join(ref, { value: op.badFee ? FEE + 1n : FEE });
            }
            if (op.kind === "batch") {
              const sender = op.byOwner ? owner : users[0];
              return c.connect(sender).addPointsBatch(op.list.map((i) => users[i].address), op.amount);
            }
            return c.connect(owner).withdraw(owner.address);
          };
          const ra = await attempt(run(a));
          const rb = await attempt(run(b));
          expect(rb.ok, `step ${JSON.stringify(op)}`).to.equal(ra.ok);
        }
        expect(await b.totalPoints()).to.equal(await a.totalPoints());
        expect(await b.memberCount()).to.equal(await a.memberCount());
        expect(await ethers.provider.getBalance(b)).to.equal(await ethers.provider.getBalance(a));
        for (const u of users) expect(await b.pointsOf(u.address)).to.equal(await a.pointsOf(u.address));
      }),
      { numRuns: RUNS }
    );
    console.log(`      (${RUNS} programs, ${steps} steps, identical results)`);
  });
});

describe("Gas report — the optimized version is cheaper for every action", function () {
  this.timeout(120_000);
  it("every measured row is strictly lower for ClubOptimized", async function () {
    const naive = await measureClub("ClubNaive", [10]);
    const opt = await measureClub("ClubOptimized", [10]);
    for (const k of Object.keys(naive)) expect(opt[k], k).to.be.lessThan(naive[k]);
    // The headline number: a 10-member batch costs at least 50% less.
    expect(opt["addPointsBatch (10 members)"]).to.be.lessThan(naive["addPointsBatch (10 members)"] / 2);
  });
});
