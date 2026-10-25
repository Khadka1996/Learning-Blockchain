"use strict";
/** Exercise 2 — predict the storage cost of rewarding N brand-new members. */
const NEW_BOX = 20000; // empty -> non-zero
const CHANGE_BOX = 2900; // non-zero -> different non-zero
const COLD = 2100; // first touch of a box in a transaction

function naiveStorageGas(n) {
  // per member: `points` box starts empty (fill it) and is touched cold; plus one totalPoints write per member
  const perMember = NEW_BOX + COLD;
  const totalPoints = NEW_BOX + COLD + (n - 1) * 100; // first write fills the box, later writes hit a warm box (100 each, simplified)
  return n * perMember + totalPoints;
}

function packedStorageGas(n) {
  // per member: the packed box was filled at join(), so it is a cold update; ONE totalPoints write for the whole batch
  return n * (CHANGE_BOX + COLD) + (NEW_BOX + COLD);
}

module.exports = { naiveStorageGas, packedStorageGas };

if (require.main === module) {
  for (const n of [10, 50]) {
    const a = naiveStorageGas(n);
    const b = packedStorageGas(n);
    console.log(`N=${n}: naive ${a.toLocaleString()}  packed ${b.toLocaleString()}  predicted saving ${(((a - b) / a) * 100).toFixed(1)}%`);
  }
  console.log("measured (real receipts): N=10 saves 64.7%, N=50 saves 69.7%");
}
