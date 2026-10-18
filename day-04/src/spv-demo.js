// Day 04 (evening) — a phone wallet (light client) checks Ram's payment with headers only.
"use strict";

const { demoWallet } = require("../../day-03/src/keys");
const { createTransfer } = require("../../day-03/src/transaction");
const { makeParams, Node } = require("./node");
const { mineBlock } = require("./block");
const { LightClient, proveTx } = require("./spv");

const CHAIN = "lb-devnet";

function run({ blocks = 30, perBlock = 20, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const [sita, ram, hari] = ["sita", "ram", "hari"].map(demoWallet);
  const params = makeParams({ chainId: CHAIN, bits: 10, genesis: { [sita.address]: 100_000 } });
  const clock = () => 1_000_000;
  const full = new Node("full", params, { clock });

  // A full node mines `blocks` blocks of `perBlock` payments each. Ram's payment is in block 5.
  let nonce = 0;
  let ramTx, ramBlock;
  for (let b = 1; b <= blocks; b++) {
    const txs = [];
    for (let k = 0; k < perBlock; k++) {
      const toRam = b === 5 && k === 7;
      const tx = createTransfer(sita, { to: (toRam ? ram : hari).address, amount: toRam ? 25 : 1, nonce: nonce++, chainId: CHAIN });
      if (toRam) ramTx = tx;
      txs.push(tx);
    }
    const block = full.mine(txs, b * 1000);
    if (b === 5) ramBlock = block;
  }

  // The phone downloads headers only.
  const phone = new LightClient(params, { clock });
  for (const h of full.chain().slice(1)) phone.addHeader(full.getBlock(h).header);
  const fullBytes = full.chain().slice(1).reduce((n, h) => n + Buffer.byteLength(JSON.stringify(full.getBlock(h))), 0);
  log(`1. A full node has ${blocks} blocks with ${(blocks * perBlock).toLocaleString("en-US")} payments: ${fullBytes.toLocaleString("en-US")} bytes`);
  log(`   The phone keeps only the ${blocks} headers:            ${phone.storedBytes.toLocaleString("en-US")} bytes (${Math.round(fullBytes / phone.storedBytes)}× less)`);

  // Ram asks a full node for a proof, then checks it on the phone.
  const proof = proveTx(ramBlock, 7);
  const ok = phone.verifyPayment(ramTx, proof, ramBlock.hash);
  log(`\n2. "Sita paid Ram 25 coins in block 5" + a ${proof.siblings.length}-hash proof (${proof.siblings.length * 32} bytes)`);
  log(`   phone says: ${ok.ok ? `paid, ${ok.confirmations} confirmations deep` : ok.reason}`);

  // A dishonest server lies about the amount.
  const lie = createTransfer(sita, { to: ram.address, amount: 250, nonce: ramTx.nonce, chainId: CHAIN });
  const lieR = phone.verifyPayment(lie, proof, ramBlock.hash);
  log(`\n3. Server claims it was 250 coins → ${lieR.ok ? "accepted (BUG)" : `refused: ${lieR.reason}`}`);

  // A payment in a block that lost a fork does not count.
  const parent = full.getBlock(full.chain()[blocks - 1]);
  const staleTx = createTransfer(sita, { to: ram.address, amount: 99, nonce, chainId: CHAIN });
  const stale = mineBlock({ chainId: CHAIN, height: blocks, prevHash: parent.hash, timestamp: parent.header.timestamp + 1, bits: params.bits }, [staleTx]);
  phone.addHeader(stale.header);
  const staleR = phone.verifyPayment(staleTx, proveTx(stale, 0), stale.hash);
  log(`4. Payment in a block that lost a fork → ${staleR.ok ? "accepted (BUG)" : `refused: ${staleR.reason}`}`);

  // A forged header without Proof of Work is refused.
  const fake = { ...ramBlock.header, height: blocks + 1, prevHash: phone.tip.hash, timestamp: blocks * 1000 + 1, nonce: 0 };
  const fakeR = phone.addHeader(fake);
  log(`5. Header without real Proof of Work → ${fakeR.status}${fakeR.reason ? `: ${fakeR.reason}` : ""}`);

  return { fullBytes, headerBytes: phone.storedBytes, proofHashes: proof.siblings.length, confirmations: ok.confirmations, ok: ok.ok, lie: lieR.ok, stale: staleR.ok, fake: fakeR.status };
}

if (require.main === module) run();
module.exports = { run };
