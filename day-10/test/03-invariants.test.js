"use strict";
// Property / invariant tests: fast-check generates random programs of
// add / remove / swap by 3 users, and after EVERY step we check rules that must always hold.
const { expect } = require("chai");
const fc = require("fast-check");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const amm = require("../src/amm");
const { E, DEADLINE, deployPool, addLiquidityEthUsd } = require("./helpers");

const RUNS = Number(process.env.FUZZ_RUNS || 150);
const EXPECTED_REVERTS = new Set(["ZeroAmount", "InsufficientOutput", "InsufficientAmounts", "InsufficientLiquidityMinted", "ERC20InsufficientBalance"]);

/** Decode a revert into its custom-error name using the pool's ABI (which includes the ERC-20 errors). */
function errorName(pair, e) {
  const candidates = [e.data, e.error?.data, (String(e.message).match(/return data: (0x[0-9a-f]+)/i) || [])[1]];
  const data = candidates.find((d) => typeof d === "string" && d.startsWith("0x") && d.length >= 10);
  try { return pair.interface.parseError(data)?.name ?? "unknown"; } catch { return "unknown"; }
}

const stats = { programs: 0, steps: 0, reverted: 0 };

async function seededPool() {
  const ctx = await deployPool();
  await addLiquidityEthUsd(ctx, ctx.alice, E(100), E(200_000));
  return ctx;
}

// Amounts from 1 wei up to 10,000 tokens, skewed so tiny "rounding attack" sizes appear often.
const amount = fc.oneof(fc.bigInt({ min: 1n, max: 10_000n }), fc.bigInt({ min: 1n, max: E(10_000) }));
const step = fc.record({
  kind: fc.constantFrom("swap0", "swap1", "add", "remove"),
  user: fc.integer({ min: 0, max: 2 }),
  a: amount,
  b: amount,
  pct: fc.integer({ min: 1, max: 100 }),
});

describe("Invariants (fast-check)", function () {
  this.timeout(600_000);

  after(function () {
    console.log(`      fuzz: ${stats.programs} programs, ${stats.steps} steps, ${stats.reverted} reverted as expected`);
  });

  it("books match reality, k never shrinks on a swap and a share never loses value", async function () {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (program) => {
        const ctx = await loadFixture(seededPool);
        const { pair, t0, t1 } = ctx;
        const users = [ctx.alice, ctx.bob, ctx.carol];
        stats.programs++;

        for (const s of program) {
          stats.steps++;
          const u = users[s.user];
          const [r0, r1, supply] = [await pair.reserve0(), await pair.reserve1(), await pair.totalSupply()];
          let expectedOut = null;
          try {
            if (s.kind === "swap0" || s.kind === "swap1") {
              const [tIn, rIn, rOut] = s.kind === "swap0" ? [t0, r0, r1] : [t1, r1, r0];
              expectedOut = amm.getAmountOut(s.a, rIn, rOut);
              const tx = await pair.connect(u).swap(tIn, s.a, 0n, u.address, DEADLINE);
              await tx.wait();
            } else if (s.kind === "add") {
              await (await pair.connect(u).addLiquidity(s.a, s.b, 0n, u.address, DEADLINE)).wait();
            } else {
              const bal = await pair.balanceOf(u.address);
              await (await pair.connect(u).removeLiquidity((bal * BigInt(s.pct)) / 100n, 0n, 0n, u.address, DEADLINE)).wait();
            }
          } catch (e) {
            // Reverts are fine (zero output, zero shares…) as long as they are OUR custom errors.
            const name = errorName(pair, e);
            if (!EXPECTED_REVERTS.has(name)) throw e;
            stats.reverted++;
            continue;
          }
          const [n0, n1, nSupply] = [await pair.reserve0(), await pair.reserve1(), await pair.totalSupply()];

          // 1. The pool's books equal the tokens it really holds.
          expect(await t0.balanceOf(pair)).to.equal(n0);
          expect(await t1.balanceOf(pair)).to.equal(n1);
          // 2. Neither side can ever be emptied.
          expect(n0 > 0n && n1 > 0n).to.equal(true);
          // 3. Value per share never goes down: sqrt(k)/supply is non-decreasing  ⇔  k'·S² ≥ k·S'².
          expect(n0 * n1 * supply * supply >= r0 * r1 * nSupply * nSupply).to.equal(true);
          if (expectedOut !== null) {
            // 4. A swap never shrinks k, and pays exactly what the model predicts.
            expect(n0 * n1 >= r0 * r1).to.equal(true);
            const paidOut = s.kind === "swap0" ? r1 - n1 : r0 - n0;
            expect(paidOut).to.equal(expectedOut);
          }
        }
        return true;
      }),
      { numRuns: RUNS }
    );
  });

  it("buying and immediately selling back always loses (no free money from rounding)", async function () {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1000n, max: E(1e9) }),
        fc.bigInt({ min: 1000n, max: E(1e9) }),
        fc.bigInt({ min: 1n, max: E(1e9) }),
        (x, y, dx) => {
          let out;
          try { out = amm.getAmountOut(dx, x, y); } catch { return true; }
          if (out === 0n) return true;
          const back = amm.getAmountOut(out, y - out, x + dx);
          return back < dx;
        }
      ),
      { numRuns: 2_000 }
    );
  });
});
