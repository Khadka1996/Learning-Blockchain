"use strict";
// Exercise 3 — a model of a limit with no midnight loophole: at most `limit` in ANY 24 hours.
const { DAY } = require("./window");

class RollingLimit {
  constructor(limit, windowSeconds = DAY) { this.limit = limit; this.windowSeconds = windowSeconds; this.sent = []; }
  /** Used in the window that ends now: sends with t in (now - window, now]. */
  used(now) { return this.sent.filter((s) => now - s.t < this.windowSeconds).reduce((a, s) => a + s.amount, 0n); }
  remaining(now) { return this.limit - this.used(now); }
  /** Try to send. Time must not go backwards (like block.timestamp). Returns true if accepted. */
  trySend(now, amount) {
    if (this.sent.length && now < this.sent[this.sent.length - 1].t) throw new Error("time went backwards");
    if (amount > this.remaining(now)) return false;
    this.sent.push({ t: now, amount });
    return true;
  }
}

module.exports = { RollingLimit };

if (require.main === module) {
  const { calendarDayLimit, maxInWindow } = require("./window");
  const E = (n) => BigInt(n) * 10n ** 18n;
  const midnight = 20_000 * DAY;
  const asked = [{ t: midnight - 30, amount: E(1) }, { t: midnight + 5, amount: E(1) }];
  const r = new RollingLimit(E(1));
  const rolling = asked.filter((a) => r.trySend(a.t, a.amount));
  console.log(`calendar-day rule accepted ${calendarDayLimit(asked, E(1)).length}, rolling rule accepted ${rolling.length}`);
  console.log(`rolling: most in any 24 h = ${Number(maxInWindow(rolling, DAY) / 10n ** 18n)} ETH`);
}
