"use strict";
/** npm run gas — side-by-side gas report: ClubNaive vs ClubOptimized */
const { measureClub } = require("./gas");

function fmt(n) {
  return n.toLocaleString("en-US");
}

async function report() {
  const naive = await measureClub("ClubNaive");
  const opt = await measureClub("ClubOptimized");
  const rows = Object.keys(naive).map((k) => {
    const saved = naive[k] - opt[k];
    return { k, a: naive[k], b: opt[k], saved, pct: (saved / naive[k]) * 100 };
  });
  console.log("Gas report — same actions, same results, two ways of writing the contract\n");
  console.log("action".padEnd(30) + "naive".padStart(11) + "optimized".padStart(11) + "saved".padStart(11) + "   %");
  for (const r of rows) {
    console.log(
      r.k.padEnd(30) + fmt(r.a).padStart(11) + fmt(r.b).padStart(11) + fmt(r.saved).padStart(11) + `  ${r.pct.toFixed(1).padStart(5)}%`
    );
  }
  return rows;
}

module.exports = { report };

if (require.main === module) {
  report().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
