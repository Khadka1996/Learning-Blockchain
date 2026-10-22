// Medium 4-5: a soulbound certificate, and fixing the re-entrant mint.
const { ethers } = require("hardhat");

const errName = (e) => /custom error '(\w+)/.exec(e.message)?.[1] ?? "reverted";

async function main() {
  const [, ram, sita] = await ethers.getSigners();

  console.log("4. SoulboundCertificate: earned, not traded");
  const cert = await ethers.deployContract("SoulboundCertificate");
  await (await cert.award(ram.address)).wait();
  console.log(`   issuer awards certificate #1 to Ram -> ownerOf(1) is Ram: ${(await cert.ownerOf(1n)) === ram.address}`);
  for (const [label, fn] of [
    ["Ram tries to sell it (transferFrom)", () => cert.connect(ram).transferFrom(ram.address, sita.address, 1n)],
    ["Ram tries to approve a marketplace", () => cert.connect(ram).setApprovalForAll(sita.address, true)],
    ["Sita tries to burn Ram's certificate", () => cert.connect(sita).burn(1n)],
  ]) {
    try {
      await fn();
      console.log(`   ${label} -> allowed ✕`);
    } catch (e) {
      console.log(`   ${label} -> ${errName(e)}`);
    }
  }
  await (await cert.burn(1n)).wait();
  console.log("   the issuer revokes it -> burned (revocation still works)");

  console.log("\n5. The re-entrant mint, fixed by moving two lines");
  const naive = await ethers.deployContract("NaiveNFT");
  const nft = await ethers.deployContract("LearningNFT", ["x/", ram.address, 500]);
  const price = await nft.MINT_PRICE();
  const t1 = await ethers.deployContract("ReentrantMinter", [await naive.getAddress()]);
  const t2 = await ethers.deployContract("ReentrantMinter", [await nft.getAddress()]);
  await (await t1.attack(3n, 0n, 3n)).wait();
  await (await t2.attack(3n, price, 3n, { value: price * 6n })).wait();
  console.log(`   limit recorded AFTER  _safeMint (NaiveNFT):    attacker holds ${await naive.balanceOf(await t1.getAddress())}`);
  console.log(`   limit recorded BEFORE _safeMint (LearningNFT): attacker holds ${await nft.balanceOf(await t2.getAddress())}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
