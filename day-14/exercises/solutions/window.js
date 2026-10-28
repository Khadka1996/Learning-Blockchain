"use strict";
// Shared helpers for exercises 2 and 3 (pure JavaScript, no blockchain needed).
const DAY = 86400;

/** Biggest total sent inside ANY window of `windowSeconds`. Sends: [{ t (seconds), amount (BigInt) }]. */
function maxInWindow(sends, windowSeconds) {
  const s = [...sends].sort((a, b) => a.t - b.t);
  let best = 0n, sum = 0n, lo = 0;
  for (let hi = 0; hi < s.length; hi++) {
    sum += s[hi].amount;
    while (s[hi].t - s[lo].t >= windowSeconds) sum -= s[lo++].amount; // window is [t, t + windowSeconds)
    if (sum > best) best = sum;
  }
  return best;
}

/** The rule SmartWallet uses today: at most `limit` per UTC calendar day. Returns the accepted sends. */
function calendarDayLimit(requests, limit) {
  const perDay = new Map(), accepted = [];
  for (const r of [...requests].sort((a, b) => a.t - b.t)) {
    const day = Math.floor(r.t / DAY), used = perDay.get(day) ?? 0n;
    if (used + r.amount <= limit) { perDay.set(day, used + r.amount); accepted.push(r); }
  }
  return accepted;
}

module.exports = { DAY, maxInWindow, calendarDayLimit };
