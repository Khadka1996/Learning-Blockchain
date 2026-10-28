"use strict";
// Exercise 1 — a weak secret is not protected by zero-knowledge: the lock Poseidon(secret) is public.
const { poseidonHash } = require("../../src/zk");

/** Brute-force an n-digit PIN from its public lock. */
async function crackPin(digits) {
  const pin = BigInt(10 ** digits - 1); // worst case: the last PIN
  const lock = await poseidonHash(pin);
  const start = process.hrtime.bigint();
  let guesses = 0;
  for (let g = 0n; ; g++) {
    guesses++;
    if ((await poseidonHash(g)) === lock) {
      return { digits, guesses, ms: Number(process.hrtime.bigint() - start) / 1e6, found: g };
    }
  }
}

/** Seconds to try every one of 2**bits secrets at `perSecond` guesses per second (as a float). */
const secondsToTryAll = (bits, perSecond) => 2 ** bits / perSecond;

module.exports = { crackPin, secondsToTryAll };

if (require.main === module) {
  (async () => {
    let rate = 0;
    for (const d of [3, 4, 5]) {
      const r = await crackPin(d);
      rate = r.guesses / (r.ms / 1000);
      console.log(`${d}-digit PIN: found ${r.found} after ${r.guesses} guesses in ${r.ms.toFixed(0)} ms`);
    }
    const years = secondsToTryAll(248, rate) / (3600 * 24 * 365);
    console.log(`at ~${Math.round(rate)} guesses/s, 248 random bits would take ~${years.toExponential(1)} years`);
    console.log("lesson: ZK hides the secret, it cannot make a guessable secret strong.");
  })();
}
