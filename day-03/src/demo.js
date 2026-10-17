// Day 03 demo — wallets, signed payments, a ledger, and what a forger can and cannot do.
"use strict";

const { demoWallet } = require("./keys");
const { createTransfer, txId } = require("./transaction");
const { Ledger } = require("./ledger");

const CHAIN = "lb-devnet";

function run() {
  const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
  const short = (h) => h.slice(0, 12) + "…";

  console.log("1. Three wallets (private key → public key → address)");
  for (const [name, w] of [["Sita", sita], ["Ram", ram], ["Hari", hari]]) {
    console.log(`   ${name.padEnd(5)} public key ${short(w.publicKey)}  address ${w.address}`);
  }

  const ledger = new Ledger(CHAIN, { [sita.address]: 100 });
  console.log(`\n2. Genesis: Sita starts with ${ledger.balanceOf(sita.address)} coins on chain "${CHAIN}"`);

  const tx1 = createTransfer(sita, { to: ram.address, amount: 30, nonce: 0, chainId: CHAIN });
  const tx2 = createTransfer(ram, { to: hari.address, amount: 10, nonce: 0, chainId: CHAIN });
  console.log("\n3. Signed payments");
  for (const [label, tx] of [["Sita → Ram  30", tx1], ["Ram  → Hari 10", tx2]]) {
    console.log(`   ${label}  id ${short(txId(tx))}  signature ${short(tx.signature)} (${tx.signature.length / 2} bytes)`);
  }
  ledger.applyAll([tx1, tx2]);

  console.log("\n4. Balances after both payments");
  for (const [name, w] of [["Sita", sita], ["Ram", ram], ["Hari", hari]]) {
    console.log(`   ${name.padEnd(5)} ${String(ledger.balanceOf(w.address)).padStart(3)} coins   next nonce ${ledger.nonceOf(w.address)}`);
  }
  console.log(`   total ${ledger.sumOfBalances()} (supply ${ledger.totalSupply}: no coins created or destroyed)`);
  return { ledger, sita, ram, hari, tx1, tx2 };
}

module.exports = { run, CHAIN };

if (require.main === module) {
  try {
    run();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
