// Day 04 — a fork, step by step. Four nodes; A and C find a block at the same moment.
// Each block spends the SAME 30 coins of Sita's, once to Ram, once to Hari (a double spend).
// The network splits 2–2, then the next block decides which payment survives.
"use strict";

const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { makeParams } = require("./node");
const { Network } = require("./network");

const CHAIN = "lb-devnet";

function run({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
  const params = makeParams({ chainId: CHAIN, bits: 12, genesis: { [sita.address]: 100 } });
  // A–B and C–D are close neighbours (50 ms); every other link is slow (300 ms).
  const near = new Set(["A-B", "B-A", "C-D", "D-C"]);
  const net = new Network(params, ["A", "B", "C", "D"], (f, t) => (near.has(`${f}-${t}`) ? 50 : 300));
  const short = (h) => h.slice(0, 8);
  const tips = () => [...net.nodes.values()].map((n) => `${n.id}:${short(n.tip.hash)}@${n.tip.height}`).join("  ");
  const bal = (n) => {
    const L = n.ledgerAt();
    return `Ram ${L.balanceOf(ram.address)}, Hari ${L.balanceOf(hari.address)}`;
  };

  const toRam = createTransfer(sita, { to: ram.address, amount: 30, nonce: 0, chainId: CHAIN });
  const toHari = createTransfer(sita, { to: hari.address, amount: 30, nonce: 0, chainId: CHAIN });

  net.mineAt(500, "B");
  net.run(999);
  log(`t=0.5 s  B mines block 1. Everyone has it.\n         ${tips()}`);

  net.mineAt(1000, "A", [toRam]);
  net.mineAt(1000, "C", [toHari]);
  net.run(1100);
  log(`\nt=1.0 s  A mines block 2 with "Sita → Ram 30". C mines a different block 2 with "Sita → Hari 30".`);
  log(`t=1.1 s  The network is split:\n         ${tips()}`);
  log(`         A sees: ${bal(net.node("A"))}   |   D sees: ${bal(net.node("D"))}`);
  net.run(1999);
  const split = { A: net.node("A").ledgerAt().balanceOf(ram.address), D: net.node("D").ledgerAt().balanceOf(hari.address) };
  log(`t=2.0 s  Both blocks reached everyone. Equal work, so each node keeps the one it saw FIRST:\n         ${tips()}`);

  net.mineAt(2000, "D");
  net.run();
  const reorgs = net.log.filter((e) => e.event === "reorg");
  log(`\nt=2.0 s  D mines block 3 on top of C's block. That branch now has more work.`);
  for (const r of reorgs) log(`t=${(r.t / 1000).toFixed(2)} s  ${r.node} switches branch: throws away ${r.depth} block`);
  log(`\nEnd:     ${tips()}`);
  log(`         All nodes agree: ${net.agreed()}.  Balances everywhere: ${bal(net.node("A"))}`);
  log(`         Ram's payment was "confirmed" for about 1 second, then disappeared.`);
  return { net, reorgs, split, agreed: net.agreed(), final: { ram: net.node("A").ledgerAt().balanceOf(ram.address), hari: net.node("A").ledgerAt().balanceOf(hari.address) } };
}

if (require.main === module) run();
module.exports = { run };
