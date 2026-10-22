// Day 08 guided tour: NFTs (ERC-721 and ERC-1155) on a local Hardhat chain.
//   npm start                    (in-process chain)
//   npm run demo:localhost       (against `npm run node`)
const { ethers } = require("hardhat");

const fmt = (n) => Number(n).toLocaleString("en-US");
const gasOf = async (txPromise) => (await (await txPromise).wait()).gasUsed;
const line = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

async function main() {
  const [, ram, sita, hari, artist] = await ethers.getSigners();

  // ------------------------------------------------------------------ 1
  line("1. An NFT is a table: tokenId -> owner");
  const mini = await ethers.deployContract("MiniNFT", ["Mini NFT", "MINI", "ipfs://bafy.../"]);
  await mini.mint(ram.address, 1n);
  await mini.mint(ram.address, 2n);
  await mini.mint(sita.address, 3n);
  console.log(`   ownerOf(1) = Ram   ownerOf(3) = Sita   balanceOf(Ram) = ${await mini.balanceOf(ram.address)}`);
  console.log(`   tokenURI(1) = ${await mini.tokenURI(1n)}   (the picture lives OFF-chain; the chain stores the link)`);
  try {
    await mini.ownerOf(99n);
  } catch {
    console.log("   ownerOf(99) -> reverts with ERC721NonexistentToken (never 'nobody')");
  }

  // ------------------------------------------------------------------ 2
  line("2. Two kinds of permission");
  await mini.connect(ram).approve(hari.address, 1n);
  console.log(`   Ram approves Hari for token 1 only. getApproved(1) = Hari: ${(await mini.getApproved(1n)) === hari.address}`);
  await mini.connect(hari).transferFrom(ram.address, sita.address, 1n);
  console.log(`   Hari moves token 1 to Sita. The approval is wiped: getApproved(1) = ${await mini.getApproved(1n)}`);
  await mini.connect(ram).setApprovalForAll(hari.address, true);
  console.log("   setApprovalForAll(Hari): Hari may now move EVERY token Ram has, today and in the future.");

  // ------------------------------------------------------------------ 3
  line("3. safeTransferFrom: do not send an NFT into a black hole");
  const noHook = await ethers.deployContract("NoHookContract");
  const good = await ethers.deployContract("GoodReceiver");
  try {
    await mini.connect(ram)["safeTransferFrom(address,address,uint256)"](ram.address, await noHook.getAddress(), 2n);
  } catch {
    console.log("   safe transfer to a contract WITHOUT the receiver hook -> refused (ERC721InvalidReceiver)");
  }
  await mini.connect(ram)["safeTransferFrom(address,address,uint256)"](ram.address, await good.getAddress(), 2n);
  console.log(`   safe transfer to a contract that answers the hook -> works (it received ${await good.received721()})`);
  await mini.connect(sita).transferFrom(sita.address, await noHook.getAddress(), 3n);
  console.log("   PLAIN transferFrom into the hook-less contract -> 'works', and token 3 is stuck there forever.");

  // ------------------------------------------------------------------ 4
  line("4. Hand-written vs OpenZeppelin: gas");
  const ref = await ethers.deployContract("ReferenceERC721");
  const miniMint = await gasOf(mini.mint(hari.address, 10n));
  const refMint = await gasOf(ref.mint(hari.address, 10n));
  const miniMove = await gasOf(mini.connect(hari).transferFrom(hari.address, ram.address, 10n));
  const refMove = await gasOf(ref.connect(hari).transferFrom(hari.address, ram.address, 10n));
  console.log(`   mint:          MiniNFT ${fmt(miniMint)}   OpenZeppelin ${fmt(refMint)}`);
  console.log(`   transferFrom:  MiniNFT ${fmt(miniMove)}   OpenZeppelin ${fmt(refMove)}`);

  // ------------------------------------------------------------------ 5
  line("5. A real collection: price, limits, metadata, royalties");
  const price = ethers.parseEther("0.01");
  const nft = await ethers.deployContract("LearningNFT", ["ipfs://collection/", artist.address, 500]);
  await nft.connect(ram).mint(3n, { value: price * 3n });
  console.log(`   Ram pays 0.03 ETH and mints 3. tokenURI(1) = ${await nft.tokenURI(1n)}`);
  try {
    await nft.connect(ram).mint(1n, { value: price });
  } catch {
    console.log("   A 4th mint -> WalletLimit (3 per wallet)");
  }
  const [who, cut] = await nft.royaltyInfo(1n, ethers.parseEther("2"));
  console.log(`   royaltyInfo(token 1, sale 2 ETH) -> ${ethers.formatEther(cut)} ETH to the artist (${who === artist.address ? "artist" : who})`);
  console.log("   ...but ERC-2981 only ANSWERS the question. Nothing forces a marketplace to pay.");

  // ------------------------------------------------------------------ 6
  line("6. The re-entrant mint: a buyer contract that mints again from inside the receiver hook");
  const naive = await ethers.deployContract("NaiveNFT");
  const thief = await ethers.deployContract("ReentrantMinter", [await naive.getAddress()]);
  await thief.attack(3n, 0n, 3n);
  console.log(`   NaiveNFT (limit 3, recorded AFTER minting):   attacker holds ${await naive.balanceOf(await thief.getAddress())}`);
  const thief2 = await ethers.deployContract("ReentrantMinter", [await nft.getAddress()]);
  await thief2.attack(3n, price, 3n, { value: price * 6n });
  console.log(
    `   LearningNFT (limit recorded BEFORE minting):  attacker holds ${await nft.balanceOf(await thief2.getAddress())}` +
      `, re-entries tried ${await thief2.reentries()}, all refused: ${await thief2.lastReentryFailed()}`,
  );

  // ------------------------------------------------------------------ 7
  line("7. ERC-1155: many item types in ONE contract");
  const items = await ethers.deployContract("GameItems", ["ipfs://items/{id}.json"]);
  const batch = await gasOf(items.mintBatch(ram.address, [0n, 1n, 2n], [1000n, 5n, 1n]));
  const items2 = await ethers.deployContract("GameItems", ["ipfs://items/{id}.json"]);
  let single = 0n;
  for (const [id, n] of [[0n, 1000n], [1n, 5n], [2n, 1n]]) single += await gasOf(items2.mint(ram.address, id, n));
  console.log("   Ram now holds 1000 GOLD (like a coin), 5 SWORD (limited edition), 1 CROWN (one of one).");
  console.log(`   3 item types in ONE batch: ${fmt(batch)} gas   vs 3 separate mints: ${fmt(single)} gas` + `   (saves ${Math.round(Number(single - batch) * 100 / Number(single))}%)`);
  try {
    await items.mint(sita.address, 2n, 1n);
  } catch {
    console.log("   A second CROWN -> ExceedsMaxSupply. There can only be one.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
