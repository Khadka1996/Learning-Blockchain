// Exercise 2 (medium) — why do exchanges wait for ~6 confirmations?
// Satoshi's formula (Bitcoin whitepaper, section 11): the probability that an attacker with a share
// q of the hash power ever catches up from z blocks behind.
"use strict";

/** P(attacker catches up from z blocks behind), attacker share q (0 ≤ q < 1). */
function attackerSuccessProbability(q, z) {
  if (typeof q !== "number" || !(q >= 0 && q < 1)) throw new RangeError("q must be a number in [0, 1)");
  if (!Number.isInteger(z) || z < 0 || z > 1000) throw new RangeError("z must be a whole number from 0 to 1000");
  const p = 1 - q;
  if (q >= p) return 1; // a majority attacker always catches up eventually
  const lambda = z * (q / p);
  let sum = 1;
  let poisson = Math.exp(-lambda); // P(attacker found k blocks while honest found z), k = 0
  for (let k = 0; k <= z; k++) {
    if (k > 0) poisson *= lambda / k;
    sum -= poisson * (1 - (q / p) ** (z - k));
  }
  return Math.max(0, sum);
}

/** Smallest z with P < limit (the whitepaper's "solving for P less than 0.1%" table). */
function confirmationsNeeded(q, limit = 0.001) {
  for (let z = 0; z <= 1000; z++) if (attackerSuccessProbability(q, z) < limit) return z;
  return Infinity;
}

function demo() {
  console.log("Attacker share q = 10%:");
  for (const z of [0, 1, 2, 3, 4, 5, 6, 10]) console.log(`  z=${String(z).padStart(2)}  P=${attackerSuccessProbability(0.1, z).toFixed(7)}`);
  console.log("\nConfirmations needed for P < 0.1%:");
  for (const q of [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45]) console.log(`  q=${q.toFixed(2)}  z=${confirmationsNeeded(q)}`);
}

if (require.main === module) demo();

module.exports = { attackerSuccessProbability, confirmationsNeeded };
