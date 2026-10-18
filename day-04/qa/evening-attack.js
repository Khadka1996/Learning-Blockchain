// Day 04 — evening audit attacks (QA E1, E2). Before the fixes this printed
// "real block 2 → duplicate", a victim stuck at height 1, and ~2,000 ms for 20 resends.
"use strict";

const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { Node, makeParams } = require("../src/node");
const { mineBlock } = require("../src/block");

const C = "lb-devnet";
const [sita, ram] = ["sita", "ram"].map(demoWallet);
const P = makeParams({ chainId: C, bits: 8, genesis: { [sita.address]: 1000 } });
const clock = () => 1e9;

// E1 — a copy of block 2 with a broken signature, sent before the victim has block 1.
const honest = new Node("A", P, { clock });
const victim = new Node("V", P, { clock });
const b1 = honest.mine([], 1);
const tx = createTransfer(sita, { to: ram.address, amount: 30, nonce: 0, chainId: C });
const b2 = honest.mine([tx], 2);
victim.receive({ header: b2.header, txs: [{ ...tx, signature: "00".repeat(64) }], hash: b2.hash });
console.log("E1 Mallory sends block 2 with one broken signature, before the victim has block 1");
console.log(`   real block 2 → ${victim.receive(b2).status}`);
victim.receive(b1);
console.log(`   victim tip height ${victim.tip.height}, honest height ${honest.tip.height}, Ram ${victim.ledgerAt().balanceOf(ram.address)} coins (should be 30)`);

// E2 — the same invalid block, sent 20 times, on top of a 100-block chain.
const n = new Node("N", P, { clock });
for (let i = 0; i < 100; i++) n.mine([createTransfer(sita, { to: ram.address, amount: 1, nonce: i, chainId: C })], 10 + i);
const bad = mineBlock({ chainId: C, height: 101, prevHash: n.tip.hash, timestamp: 1e6, bits: 8 }, [createTransfer(sita, { to: ram.address, amount: 5000, nonce: 100, chainId: C })]);
const t = process.hrtime.bigint();
for (let i = 0; i < 20; i++) n.receive(bad);
console.log(`\nE2 20 resends of one invalid block at height 100: ${Math.round(Number(process.hrtime.bigint() - t) / 1e6).toLocaleString("en-US")} ms`);
