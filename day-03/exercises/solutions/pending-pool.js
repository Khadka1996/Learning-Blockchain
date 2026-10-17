// Exercise 2 (medium) — pick the pending payments that can go into the next block, in a valid order.
"use strict";

const { demoWallet } = require("../../src/keys");
const { createTransfer, verifyTransfer } = require("../../src/transaction");
const { Ledger } = require("../../src/ledger");

/**
 * Payments arrive in any order. Return { selected, dropped, waiting }:
 *  - selected: payments `ledger.applyAll(selected)` will accept, each sender's nonces in order 0, 1, 2…
 *  - dropped:  can never be valid (bad signature, wrong chain, nonce already used, duplicate)
 *  - waiting:  might become valid later (a nonce gap, or not enough coins yet)
 * Like a node's mempool: Ethereum calls these "pending" and "queued".
 */
function selectForBlock(ledger, pending) {
  if (!Array.isArray(pending)) throw new TypeError("pending must be an array");
  const balance = new Map();
  const nonce = new Map();
  const bal = (a) => (balance.has(a) ? balance.get(a) : ledger.balanceOf(a));
  const non = (a) => (nonce.has(a) ? nonce.get(a) : ledger.nonceOf(a));

  const dropped = [];
  let queue = [];
  const seen = new Set();
  pending.forEach((input, index) => {
    const v = verifyTransfer(input);
    if (!v.ok) return dropped.push({ index, reason: v.reason });
    if (v.tx.chainId !== ledger.chainId) return dropped.push({ index, reason: "wrong chain" });
    const key = `${v.sender}:${v.tx.nonce}`;
    if (seen.has(key)) return dropped.push({ index, reason: "duplicate nonce from the same sender" });
    seen.add(key);
    queue.push({ index, v });
  });

  // Greedy passes: take every payment whose nonce is next and whose sender can afford it,
  // until a full pass makes no progress (a payment can fund a later one: Sita → Ram → Hari).
  const selected = [];
  for (let progress = true; progress; ) {
    progress = false;
    const rest = [];
    for (const item of queue) {
      const { sender, tx } = item.v;
      if (tx.nonce === non(sender) && bal(sender) >= tx.amount) {
        selected.push(tx);
        balance.set(sender, bal(sender) - tx.amount);
        balance.set(tx.to, bal(tx.to) + tx.amount);
        nonce.set(sender, non(sender) + 1);
        progress = true;
      } else rest.push(item);
    }
    queue = rest;
  }
  const waiting = [];
  for (const { index, v } of queue) {
    if (v.tx.nonce < non(v.sender)) dropped.push({ index, reason: `nonce ${v.tx.nonce} already used` });
    else waiting.push({ index, reason: v.tx.nonce > non(v.sender) ? `waiting for nonce ${non(v.sender)}` : "not enough coins yet" });
  }
  dropped.sort((a, b) => a.index - b.index);
  return { selected, dropped, waiting };
}

function run() {
  const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
  const CHAIN = "lb-devnet";
  const ledger = new Ledger(CHAIN, { [sita.address]: 100 });
  const pay = (w, to, amount, n) => createTransfer(w, { to: to.address, amount, nonce: n, chainId: CHAIN });
  const s0 = pay(sita, ram, 30, 0);
  const pending = [
    pay(ram, hari, 10, 0), // arrives BEFORE Ram has any coins
    pay(sita, hari, 5, 1), // arrives before Sita's nonce 0
    s0,
    s0, // the same payment again (replay / gossip duplicate)
    pay(sita, ram, 1, 5), // gap: nonces 2–4 never arrived
  ];
  const r = selectForBlock(ledger, pending);
  ledger.applyAll(r.selected);
  console.log(`Arrived: ${pending.length} payments, in the "wrong" order`);
  console.log(`Selected for the block: ${r.selected.length}  (applied: Sita ${ledger.balanceOf(sita.address)}, Ram ${ledger.balanceOf(ram.address)}, Hari ${ledger.balanceOf(hari.address)})`);
  for (const d of r.dropped) console.log(`Dropped  #${d.index}: ${d.reason}`);
  for (const w of r.waiting) console.log(`Waiting  #${w.index}: ${w.reason}`);
  return { ...r, ledger };
}

module.exports = { selectForBlock, run };

if (require.main === module) run();
