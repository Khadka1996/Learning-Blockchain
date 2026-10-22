// Easy 1-3: rebuild the ownership table from events, compute the ERC-721 interface id, metadata links.
const { ethers } = require("hardhat");

async function main() {
  const [minter, ram, sita, hari] = await ethers.getSigners();
  const name = { [ram.address]: "Ram", [sita.address]: "Sita", [hari.address]: "Hari" };

  console.log("1. Rebuild 'who owns what' from Transfer events only (what every marketplace indexer does)");
  const nft = await ethers.deployContract("MiniNFT", ["Mini", "MINI", "ipfs://cid/"]);
  for (const [to, id] of [[ram, 1n], [ram, 2n], [sita, 3n]]) await (await nft.connect(minter).mint(to.address, id)).wait();
  await (await nft.connect(ram).transferFrom(ram.address, hari.address, 2n)).wait();
  await (await nft.connect(sita).burn(3n)).wait();

  const owners = new Map();
  for (const log of await nft.queryFilter(nft.filters.Transfer(), 0)) {
    const [, to, id] = log.args;
    if (to === ethers.ZeroAddress) owners.delete(id);
    else owners.set(id, to);
  }
  for (const [id, owner] of owners) {
    const onChain = await nft.ownerOf(id);
    console.log(`   token ${id}: events say ${name[owner]}, ownerOf says ${name[onChain]}  ${owner === onChain ? "✓" : "✕"}`);
  }
  console.log(`   token 3 was burned, so it is not in the table (${owners.has(3n) ? "✕" : "✓"})`);

  console.log("\n2. The ERC-721 interface id is the XOR of its 9 function selectors");
  const fns = [
    "balanceOf(address)", "ownerOf(uint256)", "safeTransferFrom(address,address,uint256,bytes)",
    "safeTransferFrom(address,address,uint256)", "transferFrom(address,address,uint256)",
    "approve(address,uint256)", "setApprovalForAll(address,bool)", "getApproved(uint256)",
    "isApprovedForAll(address,address)",
  ];
  const id = fns.reduce((acc, f) => acc ^ Number(BigInt(ethers.id(f).slice(0, 10))), 0) >>> 0;
  const hex = "0x" + id.toString(16).padStart(8, "0");
  console.log(`   computed ${hex}   supportsInterface(${hex}) = ${await nft.supportsInterface(hex)}`);

  console.log("\n3. tokenURI is a LINK. The chain proves ownership; the picture lives wherever the link points.");
  console.log(`   tokenURI(1) = ${await nft.tokenURI(1n)}   (an ipfs:// link is a content hash: change the file, the link changes)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
