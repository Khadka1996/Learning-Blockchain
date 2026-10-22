const { expect } = require("chai");
const { ethers } = require("hardhat");
const { shouldBehaveLikeERC721 } = require("./helpers/erc721-behaviour");

describe("ERC-721 behaviour suite", function () {
  describe("MiniNFT (written from scratch)", function () {
    shouldBehaveLikeERC721(async () => {
      const [minter] = await ethers.getSigners();
      const nft = await ethers.deployContract("MiniNFT", ["Mini NFT", "MINI", "ipfs://cid/"]);
      return { nft, minter };
    });
  });

  describe("OpenZeppelin ERC721 (the reference)", function () {
    shouldBehaveLikeERC721(async () => {
      const [minter] = await ethers.getSigners();
      const nft = await ethers.deployContract("ReferenceERC721");
      return { nft, minter };
    });
  });
});

describe("MiniNFT specifics", function () {
  let nft, minter, alice;

  beforeEach(async function () {
    [minter, alice] = await ethers.getSigners();
    nft = await ethers.deployContract("MiniNFT", ["Mini NFT", "MINI", "ipfs://cid/"]);
  });

  it("has a name, a symbol and a minter", async function () {
    expect(await nft.name()).to.equal("Mini NFT");
    expect(await nft.symbol()).to.equal("MINI");
    expect(await nft.minter()).to.equal(minter.address);
  });

  it("only the minter can mint", async function () {
    await expect(nft.connect(alice).mint(alice.address, 1n))
      .to.be.revertedWithCustomError(nft, "NotMinter")
      .withArgs(alice.address);
  });

  it("tokenURI = base + id, including 0 and a huge id", async function () {
    await nft.mint(alice.address, 0n);
    await nft.mint(alice.address, 42n);
    await nft.mint(alice.address, ethers.MaxUint256);
    expect(await nft.tokenURI(0n)).to.equal("ipfs://cid/0");
    expect(await nft.tokenURI(42n)).to.equal("ipfs://cid/42");
    expect(await nft.tokenURI(ethers.MaxUint256)).to.equal(`ipfs://cid/${ethers.MaxUint256}`);
  });

  it("tokenURI of a missing token reverts", async function () {
    await expect(nft.tokenURI(5n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken").withArgs(5n);
  });
});
