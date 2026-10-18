// Day 04 demo — one Merkle root for 1,000 signed payments, and a short proof for one of them.
"use strict";

const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { txLeaf } = require("./block");
const { merkleRoot, merkleProof, verifyProof } = require("./merkle");

const CHAIN = "lb-devnet";
const COUNT = 1000;

function run({ count = COUNT, pick = 737, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const [sita, ram] = ["sita", "ram"].map(demoWallet);
  // 1,000 real signed payments from Day 03 (Sita → Ram, 1 coin each, nonces 0…999).
  const txs = Array.from({ length: count }, (_, nonce) => createTransfer(sita, { to: ram.address, amount: 1, nonce, chainId: CHAIN }));
  const leaves = txs.map(txLeaf); // id + signature, exactly what a block commits to (QA E1)

  const root = merkleRoot(leaves);
  log(`1. ${count.toLocaleString("en-US")} signed payments → one Merkle root`);
  log(`   root ${root}`);

  const proof = merkleProof(leaves, pick);
  const proofBytes = proof.siblings.length * 32;
  log(`\n2. Proof that payment #${pick} is inside`);
  log(`   ${proof.siblings.length} sibling hashes = ${proofBytes} bytes`);
  log(`   (all ${count.toLocaleString("en-US")} ids would be ${(count * 32).toLocaleString("en-US")} bytes, ${Math.round((count * 32) / proofBytes)}× more)`);
  const ok = verifyProof(leaves[pick], proof, root);
  log(`   verify(payment #${pick}) → ${ok}`);

  const edited = createTransfer(sita, { to: ram.address, amount: 2, nonce: pick, chainId: CHAIN });
  const editedOk = verifyProof(txLeaf(edited), proof, root);
  log(`\n3. Same proof, but the payment says 2 coins instead of 1 → ${editedOk}`);
  const wrongPlace = verifyProof(leaves[pick], { ...proof, index: pick + 1 }, root);
  log(`   Same payment, claimed at position #${pick + 1} → ${wrongPlace}`);

  log("\n4. Proof size grows by ONE hash each time the block doubles");
  const sizes = [];
  for (const n of [1, 2, 10, 100, 1000, 1_000_000]) {
    const steps = n === 1 ? 0 : Math.ceil(Math.log2(n));
    sizes.push({ n, steps });
    log(`   ${n.toLocaleString("en-US").padStart(9)} payments → ${String(steps).padStart(2)} hashes (${steps * 32} bytes)`);
  }
  return { root, proof, ok, editedOk, wrongPlace, proofBytes, sizes };
}

if (require.main === module) run();
module.exports = { run };
