// Day 04 — Exercise 2 (medium): find the leaves that differ, comparing top-down.
"use strict";

const { leafHash, nodeHash } = require("../../src/merkle");

function levels(leaves) {
  const out = [leaves.map(leafHash)];
  while (out.at(-1).length > 1) {
    const cur = out.at(-1);
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

/** Returns { indexes, compared }: differing leaf indexes and the number of hash comparisons made. */
function findDifferences(leavesA, leavesB) {
  if (!Array.isArray(leavesA) || !Array.isArray(leavesB)) throw new TypeError("expected two arrays");
  if (leavesA.length !== leavesB.length) throw new RangeError("both lists must have the same length");
  if (leavesA.length === 0) return { indexes: [], compared: 0 };
  const A = levels(leavesA);
  const B = levels(leavesB);
  const top = A.length - 1;
  let compared = 0;
  const indexes = [];
  const visit = (d, i) => {
    compared++;
    if (A[d][i].equals(B[d][i])) return; // identical subtree: skip it entirely
    if (d === 0) return void indexes.push(i);
    const left = 2 * i;
    visit(d - 1, left);
    if (left + 1 < A[d - 1].length) visit(d - 1, left + 1);
  };
  visit(top, 0);
  return { indexes, compared };
}

function run({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const a = Array.from({ length: 1024 }, (_, i) => `Sita → Ram 1 coin, nonce ${i}`);
  const rows = [];
  for (const changed of [[], [700], [3, 700], [3, 512, 700, 1001]]) {
    const b = a.slice();
    for (const i of changed) b[i] = b[i].replace("1 coin", "9 coins");
    const r = findDifferences(a, b);
    rows.push({ changed, ...r });
    log(`${String(changed.length).padStart(1)} changed → found [${r.indexes.join(", ")}] with ${String(r.compared).padStart(3)} comparisons (checking every leaf: 1,024)`);
  }
  return rows;
}

if (require.main === module) run();
module.exports = { findDifferences, run };
