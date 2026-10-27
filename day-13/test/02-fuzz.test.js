"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

/**
 * Property tests: the contract against a tiny JS model of itself.
 * fast-check generates random tip sequences and pages; every answer must match.
 */
describe("TipJar — fuzz / property tests", function () {
  this.timeout(120000);

  it("P1: for random tips + random pages, getTips == model (newest first, capped at 50), totals add up", async function () {
    const signers = await ethers.getSigners();
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ who: fc.integer({ min: 1, max: 5 }), extra: fc.bigInt({ min: 0n, max: 10n ** 18n }), msg: fc.string({ minLength: 1, maxLength: 30 }) }), { minLength: 0, maxLength: 12 }),
        fc.array(fc.tuple(fc.bigInt({ min: 0n, max: 20n }), fc.bigInt({ min: 0n, max: 80n })), { minLength: 1, maxLength: 4 }),
        async (tips, pages) => {
          const jar = await ethers.deployContract("TipJar");
          const min = await jar.MIN_TIP();
          const model = [];
          let total = 0n;
          for (const t of tips) {
            const value = min + t.extra;
            await jar.connect(signers[t.who]).tip(t.msg, { value });
            model.push({ from: signers[t.who].address, amount: value, message: t.msg });
            total += value;
          }
          expect(await jar.totalTipped()).to.equal(total);
          expect(await ethers.provider.getBalance(jar)).to.equal(total);
          for (const [offset, limit] of pages) {
            const got = await jar.getTips(offset, limit);
            const newestFirst = [...model].reverse();
            const want = limit === 0n ? [] : newestFirst.slice(Number(offset), Number(offset) + Math.min(Number(limit), 50));
            expect(got.map((g) => [g.from, g.amount, g.message])).to.deep.equal(want.map((w) => [w.from, w.amount, w.message]));
          }
        }
      ),
      { numRuns: 25 }
    );
  });

  it("P2: any string is accepted iff 1 ≤ UTF-8 bytes ≤ 140, and is stored byte-for-byte", async function () {
    const [, alice] = await ethers.getSigners();
    const jar = await ethers.deployContract("TipJar");
    const value = await jar.MIN_TIP();
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string({ maxLength: 160 }), fc.fullUnicodeString({ maxLength: 60 })), async (msg) => {
        const bytes = Buffer.byteLength(msg, "utf8");
        const before = await jar.tipCount();
        let ok = true;
        try {
          await jar.connect(alice).tip(msg, { value });
        } catch {
          ok = false;
        }
        expect(ok).to.equal(bytes >= 1 && bytes <= 140);
        if (ok) {
          const [t] = await jar.getTips(0, 1);
          expect(t.message).to.equal(msg);
          expect(await jar.tipCount()).to.equal(before + 1n);
        }
      }),
      { numRuns: 120 }
    );
  });
});
