// Challenge 6-7: a Merkle allowlist presale, and what it saves compared with storing the list.
const { ethers } = require("hardhat");
const { buildTree } = require("./merkle");

const errName = (e) => /custom error '(\w+)/.exec(e.message)?.[1] ?? "reverted";
const fmt = (n) => Number(n).toLocaleString("en-US");

async function main() {
  const signers = await ethers.getSigners();
  const [, ram, sita, hari, stranger] = signers;

  console.log("6. Allowlist presale with ONE 32-byte root (Merkle tree from Day 04)");
  const listed = [ram, sita, hari].map((s) => s.address);
  for (let i = 0; i < 997; i++) listed.push(ethers.Wallet.createRandom().address); // 1,000 addresses in total
  const tree = buildTree(listed);
  const nft = await ethers.deployContract("AllowlistNFT", [tree.root]);
  console.log(`   1,000 allowed addresses -> root ${tree.root.slice(0, 18)}…  (proof length ${tree.proofFor(ram.address).length} hashes)`);

  const r = await (await nft.connect(ram).claim(tree.proofFor(ram.address))).wait();
  console.log(`   Ram claims with his proof -> token 1, gas ${fmt(r.gasUsed)}`);
  for (const [label, fn] of [
    ["Ram claims again", () => nft.connect(ram).claim(tree.proofFor(ram.address))],
    ["a stranger uses Sita's proof", () => nft.connect(stranger).claim(tree.proofFor(sita.address))],
    ["a stranger sends an empty proof", () => nft.connect(stranger).claim([])],
  ]) {
    try {
      await fn();
      console.log(`   ${label} -> allowed ✕`);
    } catch (e) {
      console.log(`   ${label} -> ${errName(e)}`);
    }
  }

  console.log("\n7. Why a root: the cost of writing the list on-chain instead");
  const deployTx = (await (await ethers.getContractFactory("AllowlistNFT")).deploy(tree.root)).deploymentTransaction();
  const merkleGas = (await deployTx.wait()).gasUsed;
  const list = await ethers.deployContract("MappingAllowlist");
  const listGas = (await (await list.addMany(listed)).wait()).gasUsed;
  console.log(`   Merkle version:  the whole NFT contract deploys for ${fmt(merkleGas)} gas, whatever the list size`);
  console.log(`   Mapping version: just WRITING the 1,000 addresses costs ${fmt(listGas)} gas (${fmt(listGas / 1000n)} per address)`);
  console.log(`   The list alone costs ${(Number(listGas) / Number(merkleGas)).toFixed(1)}× the entire Merkle contract.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
