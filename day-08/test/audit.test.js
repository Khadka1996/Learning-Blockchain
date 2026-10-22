const { expect } = require("chai");
const { ethers } = require("hardhat");

// Evening audit: attacks tried AFTER the morning code was finished. See QA.md "Evening audit".
const PRICE = ethers.parseEther("0.01");

describe("Evening audit", function () {
  let nft, owner, alice, bob, artist;

  beforeEach(async function () {
    [owner, alice, bob, artist] = await ethers.getSigners();
    nft = await ethers.deployContract("LearningNFT", ["ipfs://c/", artist.address, 500]);
  });

  it("E1: the owner cannot renounce ownership while mint income is still inside (it would be locked forever)", async function () {
    await nft.connect(alice).mint(2n, { value: PRICE * 2n });
    await expect(nft.renounceOwnership()).to.be.revertedWithCustomError(nft, "FundsStillHeld").withArgs(PRICE * 2n);
    await nft.withdraw();
    await nft.renounceOwnership(); // allowed once the money is out
    expect(await nft.owner()).to.equal(ethers.ZeroAddress);
  });

  it("a buyer minting from inside the owner's giveaway gets fresh ids (no collision, cap respected)", async function () {
    const buyer = await ethers.deployContract("BuyDuringGiveaway", [await nft.getAddress()], { value: PRICE });
    const b = await buyer.getAddress();
    await nft.ownerMint(b, 2n); // ids 1-2; inside id 1's hook the buyer mints id 3
    expect(await nft.balanceOf(b)).to.equal(3n);
    for (const id of [1n, 2n, 3n]) expect(await nft.ownerOf(id)).to.equal(b);
    expect(await nft.totalMinted()).to.equal(3n);
  });

  it("read-only re-entrancy: inside the hook, MiniNFT already shows the new owner and no old approval", async function () {
    const mini = await ethers.deployContract("MiniNFT", ["M", "M", "x/"]);
    const probe = await ethers.deployContract("ProbeReceiver");
    await mini.mint(alice.address, 1n);
    await mini.connect(alice).approve(bob.address, 1n);
    await mini.connect(alice)["safeTransferFrom(address,address,uint256)"](alice.address, await probe.getAddress(), 1n);
    expect(await probe.seenOwner()).to.equal(await probe.getAddress());
    expect(await probe.seenApproved()).to.equal(ethers.ZeroAddress);
    expect(await probe.seenBalance()).to.equal(1n);
  });

  it("two buyers race for the last token: the loser is refused and keeps their ETH", async function () {
    await nft.ownerMint(owner.address, 99n);
    await nft.connect(alice).mint(1n, { value: PRICE });
    const before = await ethers.provider.getBalance(bob.address);
    const tx = nft.connect(bob).mint(1n, { value: PRICE });
    await expect(tx).to.be.revertedWithCustomError(nft, "SoldOut").withArgs(1n, 0n);
    const spentOnGasOnly = before - (await ethers.provider.getBalance(bob.address));
    expect(spentOnGasOnly < PRICE).to.equal(true);
  });

  it("a royalty receiver of 0x0 is refused at deploy time", async function () {
    const F = await ethers.getContractFactory("LearningNFT");
    await expect(F.deploy("x", ethers.ZeroAddress, 500)).to.be.revertedWithCustomError(F, "ERC2981InvalidDefaultRoyaltyReceiver");
  });

  it("ownerMint to 0x0 reverts and leaves the counter untouched", async function () {
    await expect(nft.ownerMint(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver");
    expect(await nft.totalMinted()).to.equal(0n);
  });

  it("ERC-1155: an empty batch mints nothing and changes no supply", async function () {
    const items = await ethers.deployContract("GameItems", ["u/{id}"]);
    await items.mintBatch(alice.address, [], []);
    expect(await items["totalSupply()"]()).to.equal(0n);
  });
});

describe("Evening improvement: frozen metadata + EIP-4906", function () {
  let nft, alice;

  beforeEach(async function () {
    let artist;
    [, alice, artist] = await ethers.getSigners();
    nft = await ethers.deployContract("LearningNFT", ["ipfs://draft/", artist.address, 500]);
    await nft.connect(alice).mint(1n, { value: PRICE });
  });

  it("moving the metadata tells marketplaces to refresh every token (EIP-4906)", async function () {
    await expect(nft.setBaseURI("ipfs://final/"))
      .to.emit(nft, "BatchMetadataUpdate")
      .withArgs(1n, ethers.MaxUint256);
    expect(await nft.supportsInterface("0x49064906")).to.equal(true);
  });

  it("after freezeMetadata nobody can change what the NFT shows, not even the owner", async function () {
    await nft.setBaseURI("ipfs://final/");
    await expect(nft.freezeMetadata()).to.emit(nft, "MetadataFrozen").withArgs("ipfs://final/");
    expect(await nft.metadataFrozen()).to.equal(true);
    await expect(nft.setBaseURI("ipfs://rug/")).to.be.revertedWithCustomError(nft, "MetadataIsFrozen");
    await expect(nft.freezeMetadata()).to.be.revertedWithCustomError(nft, "MetadataIsFrozen");
    expect(await nft.tokenURI(1n)).to.equal("ipfs://final/1.json");
  });

  it("only the owner can freeze", async function () {
    await expect(nft.connect(alice).freezeMetadata()).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
  });
});
