// Day 04 — random network runs: the slower messages travel, the more forks appear.
"use strict";

const { demoWallet } = require("../../day-03/src/keys");
const { makeParams } = require("./node");
const { simulate } = require("./network");

function run({ blocks = 300, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const params = makeParams({ chainId: "lb-devnet", bits: 8, genesis: { [demoWallet("sita").address]: 100 } });
  const rows = [];
  log(`5 nodes, ${blocks} blocks each run, one block every 1 s on average\n`);
  log("message delay   wasted blocks   branch switches   deepest   all agree");
  for (const latency of [10, 100, 300, 1000]) {
    const r = simulate({ params, nodes: 5, blocks, blockTime: 1000, latency, seed: 4 });
    rows.push({ latency, ...r, net: undefined });
    log(`${String(latency).padStart(7)} ms     ${String(r.stale).padStart(5)} (${(r.staleRate * 100).toFixed(1).padStart(4)} %)   ${String(r.reorgs).padStart(10)}       ${String(r.deepestReorg).padStart(5)}      ${r.agreed}`);
  }
  return rows;
}

if (require.main === module) run();
module.exports = { run };
