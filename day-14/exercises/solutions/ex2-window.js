"use strict";
// Exercise 2 — how much really leaves in a short time when the limit is "per calendar day"?
const { DAY, maxInWindow, calendarDayLimit } = require("./window");
const E = (n) => BigInt(n) * 10n ** 18n;

module.exports = { maxInWindow };

if (require.main === module) {
  const midnight = 20_000 * DAY;
  const asked = [{ t: midnight - 30, amount: E(1) }, { t: midnight + 5, amount: E(1) }];
  const accepted = calendarDayLimit(asked, E(1));
  console.log(`accepted ${accepted.length} of ${asked.length} sends (limit: 1 per day)`);
  console.log(`most in any 60 s window: ${Number(maxInWindow(accepted, 60) / 10n ** 18n)} ETH  <- the K7 loophole`);
}
