"use strict";
// Checks the evening exercise solutions (pure JavaScript, no chain except ex1's Poseidon).
const { expect } = require("chai");
const fc = require("fast-check");
const { crackPin, secondsToTryAll } = require("../exercises/solutions/ex1-crack-pin");
const { maxInWindow, calendarDayLimit, DAY } = require("../exercises/solutions/window");
const { RollingLimit } = require("../exercises/solutions/ex3-rolling-limit");

const E = (n) => BigInt(n) * 10n ** 18n;

describe("Exercise 1 — cracking a weak lock", function () {
  this.timeout(60_000);
  it("finds a 3-digit and a 4-digit PIN from the public lock", async function () {
    expect((await crackPin(3)).found).to.equal(999n);
    const r = await crackPin(4);
    expect(r.found).to.equal(9999n);
    expect(r.guesses).to.equal(10_000);
  });
  it("248 random bits are out of reach even at a million guesses per second", function () {
    expect(secondsToTryAll(248, 1e6) / (3600 * 24 * 365)).to.be.greaterThan(1e60);
  });
});

describe("Exercise 2 — sliding window", function () {
  it("empty list and single send", function () {
    expect(maxInWindow([], 60)).to.equal(0n);
    expect(maxInWindow([{ t: 5, amount: 7n }], 60)).to.equal(7n);
  });
  it("two sends 35 s apart around midnight give 2 ETH in a 60 s window (K7)", function () {
    const m = 20_000 * DAY;
    const accepted = calendarDayLimit([{ t: m - 30, amount: E(1) }, { t: m + 5, amount: E(1) }], E(1));
    expect(accepted).to.have.length(2);
    expect(maxInWindow(accepted, 60)).to.equal(E(2));
  });
  it("sends exactly one window apart are not in the same window", function () {
    expect(maxInWindow([{ t: 0, amount: 1n }, { t: 60, amount: 1n }], 60)).to.equal(1n);
  });
  it("matches a brute-force check on random data", function () {
    fc.assert(fc.property(
      fc.array(fc.record({ t: fc.integer({ min: 0, max: 500 }), amount: fc.bigInt({ min: 0n, max: 100n }) }), { maxLength: 20 }),
      fc.integer({ min: 1, max: 100 }),
      (sends, w) => {
        let best = 0n;
        for (const a of sends) {
          const sum = sends.filter((s) => s.t >= a.t && s.t < a.t + w).reduce((x, s) => x + s.amount, 0n);
          if (sum > best) best = sum;
        }
        expect(maxInWindow(sends, w)).to.equal(best);
      }), { numRuns: 200 });
  });
});

describe("Exercise 3 — RollingLimit", function () {
  it("refuses the second send at 'midnight + 5 s' that the calendar rule would allow", function () {
    const m = 20_000 * DAY, r = new RollingLimit(E(1));
    expect(r.trySend(m - 30, E(1))).to.equal(true);
    expect(r.trySend(m + 5, E(1))).to.equal(false);
    expect(r.trySend(m - 30 + DAY, E(1))).to.equal(true); // exactly 24 h later it is free again
  });
  it("PROPERTY: never more than the limit in any 24 h; the calendar rule sometimes is", function () {
    let calendarBroke = false;
    fc.assert(fc.property(
      fc.array(fc.record({ t: fc.integer({ min: 0, max: 4 * DAY }), amount: fc.bigInt({ min: 0n, max: E(1) }) }), { maxLength: 15 }),
      (reqs) => {
        const sorted = [...reqs].sort((a, b) => a.t - b.t), r = new RollingLimit(E(1));
        const ok = sorted.filter((q) => r.trySend(q.t, q.amount));
        expect(maxInWindow(ok, DAY) <= E(1)).to.equal(true);
        if (maxInWindow(calendarDayLimit(sorted, E(1)), DAY) > E(1)) calendarBroke = true;
      }), { numRuns: 300 });
    expect(calendarBroke, "fast-check should find a calendar-rule counter-example").to.equal(true);
  });
  it("rejects time going backwards", function () {
    const r = new RollingLimit(E(1)); r.trySend(100, 1n);
    expect(() => r.trySend(50, 1n)).to.throw("backwards");
  });
});
