"use strict";
/* Exercise 3 (challenge): a JavaScript model of SafePriceReader, checked against the real contract. */

/**
 * @param {{answer:bigint, updatedAt:number, now:number, heartbeat:number, min:bigint, max:bigint}} i
 * @returns {{ok:true, price:bigint}|{ok:false, error:string}} — same checks, same ORDER as the contract (L1 mode)
 */
function modelPrice({ answer, updatedAt, now, heartbeat, min, max }, decimals = 8) {
  if (answer <= 0n) return { ok: false, error: "InvalidPrice" };
  if (updatedAt === 0 || updatedAt > now) return { ok: false, error: "InvalidTimestamp" };
  if (now - updatedAt > heartbeat) return { ok: false, error: "StalePrice" };
  if (answer < min || answer > max) return { ok: false, error: "PriceOutOfBounds" };
  return { ok: true, price: answer * 10n ** BigInt(18 - decimals) };
}

module.exports = { modelPrice };

if (require.main === module) {
  const base = { answer: 200_000_000_000n, updatedAt: 1000, now: 1100, heartbeat: 3600, min: 10_000_000_000n, max: 10_000_000_000_000n };
  console.log("fresh        ", modelPrice(base));
  console.log("stale        ", modelPrice({ ...base, now: 1000 + 3601 }));
  console.log("negative     ", modelPrice({ ...base, answer: -1n }));
  console.log("out of band  ", modelPrice({ ...base, answer: 10n ** 15n }));
}
