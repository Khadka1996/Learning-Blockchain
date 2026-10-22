const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseEther("0.01");

describe("LearningNFT (OpenZeppelin + royalties)", function () {
  let nft, owner, alice, bob, artist;

  beforeEach(async function () {
    [owner, alice, bob, artist] = await ethers.getSigners();
    nft = await ethers.deployContract("LearningNFT", ["ipfs://collection/", artist.address, 500]);
  });

  describe("minting rules", function () {
    it("pay the exact price, get consecutive ids starting at 1", async function () {
      await expect(nft.connect(alice).mint(2n, { value: PRICE * 2n }))
        .to.emit(nft, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, 1n);
      expect(await nft.ownerOf(2n)).to.equal(alice.address);
      expect(await nft.totalMinted()).to.equal(2n);
      expect(await nft.mintedBy(alice.address)).to.equal(2n);
      expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(PRICE * 2n);
    });

    it("too little OR too much ETH is refused (no silent overpayment)", async function () {
      await expect(nft.connect(alice).mint(1n, { value: PRICE - 1n }))
        .to.be.revertedWithCustomError(nft, "WrongPayment")
        .withArgs(PRICE - 1n, PRICE);
      await expect(nft.connect(alice).mint(1n, { value: PRICE + 1n }))
        .to.be.revertedWithCustomError(nft, "WrongPayment")
        .withArgs(PRICE + 1n, PRICE);
    });

    it("quantity 0 and quantity above the wallet limit are refused", async function () {
      await expect(nft.connect(alice).mint(0n)).to.be.revertedWithCustomError(nft, "InvalidQuantity").withArgs(0n);
      await expect(nft.connect(alice).mint(4n, { value: PRICE * 4n }))
        .to.be.revertedWithCustomError(nft, "InvalidQuantity")
        .withArgs(4n);
    });

    it("the per-wallet limit counts across several calls (3 max)", async function () {
      await nft.connect(alice).mint(2n, { value: PRICE * 2n });
      await nft.connect(alice).mint(1n, { value: PRICE });
      await expect(nft.connect(alice).mint(1n, { value: PRICE }))
        .to.be.revertedWithCustomError(nft, "WalletLimit")
        .withArgs(alice.address, 3n, 1n);
    });

    it("a huge quantity cannot overflow the price check", async function () {
      await expect(nft.connect(alice).mint(ethers.MaxUint256)).to.be.revertedWithCustomError(nft, "InvalidQuantity");
    });

    it("the supply can never pass 100, even by the owner", async function () {
      await nft.ownerMint(bob.address, 99n);
      await expect(nft.connect(alice).mint(2n, { value: PRICE * 2n }))
        .to.be.revertedWithCustomError(nft, "SoldOut")
        .withArgs(2n, 1n);
      await nft.connect(alice).mint(1n, { value: PRICE }); // exactly the last one
      expect(await nft.totalMinted()).to.equal(100n);
      await expect(nft.ownerMint(bob.address, 1n)).to.be.revertedWithCustomError(nft, "SoldOut").withArgs(1n, 0n);
    });

    it("only the owner can ownerMint, setBaseURI or withdraw", async function () {
      await expect(nft.connect(alice).ownerMint(alice.address, 1n))
        .to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
      await expect(nft.connect(alice).setBaseURI("x")).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
      await expect(nft.connect(alice).withdraw()).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
      await expect(nft.ownerMint(alice.address, 0n)).to.be.revertedWithCustomError(nft, "InvalidQuantity");
    });
  });

  describe("metadata", function () {
    it("tokenURI = base + id + .json, and the owner can move the base", async function () {
      await nft.connect(alice).mint(1n, { value: PRICE });
      expect(await nft.tokenURI(1n)).to.equal("ipfs://collection/1.json");
      await expect(nft.setBaseURI("ipfs://v2/")).to.emit(nft, "BaseURIChanged").withArgs("ipfs://v2/");
      expect(await nft.tokenURI(1n)).to.equal("ipfs://v2/1.json");
    });

    it("tokenURI of a token not minted yet reverts", async function () {
      await expect(nft.tokenURI(1n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken").withArgs(1n);
    });
  });

  describe("royalties (ERC-2981)", function () {
    it("says 5% of any sale price goes to the artist", async function () {
      await nft.connect(alice).mint(1n, { value: PRICE });
      const [receiver, amount] = await nft.royaltyInfo(1n, ethers.parseEther("2"));
      expect(receiver).to.equal(artist.address);
      expect(amount).to.equal(ethers.parseEther("0.1"));
    });

    it("rounds DOWN on tiny prices (19 wei × 5% = 0)", async function () {
      const [, amount] = await nft.royaltyInfo(1n, 19n);
      expect(amount).to.equal(0n);
      const [, amount20] = await nft.royaltyInfo(1n, 20n);
      expect(amount20).to.equal(1n);
    });

    it("supports ERC-721, ERC-721 Metadata, ERC-2981 and ERC-165", async function () {
      for (const id of ["0x80ac58cd", "0x5b5e139f", "0x2a55205a", "0x01ffc9a7"]) {
        expect(await nft.supportsInterface(id)).to.equal(true, id);
      }
      expect(await nft.supportsInterface("0xd9b67a26")).to.equal(false); // ERC-1155
    });

    it("a royalty above 100% is refused at deploy time", async function () {
      const F = await ethers.getContractFactory("LearningNFT");
      await expect(F.deploy("x", artist.address, 10001)).to.be.revertedWithCustomError(F, "ERC2981InvalidDefaultRoyalty");
    });

    it("royalties are only a SIGNAL: a plain transfer pays the artist nothing", async function () {
      await nft.connect(alice).mint(1n, { value: PRICE });
      const before = await ethers.provider.getBalance(artist.address);
      await nft.connect(alice).transferFrom(alice.address, bob.address, 1n); // a "sale" paid off-chain
      expect(await ethers.provider.getBalance(artist.address)).to.equal(before);
    });
  });

  describe("withdraw", function () {
    it("sends all mint income to the owner", async function () {
      await nft.connect(alice).mint(3n, { value: PRICE * 3n });
      await expect(nft.withdraw()).to.changeEtherBalances([owner, nft], [PRICE * 3n, -PRICE * 3n]);
    });

    it("fails loudly if the owner cannot receive ETH (money is never lost silently)", async function () {
      const rejecting = await ethers.deployContract("EthRejectingOwner");
      await nft.connect(alice).mint(1n, { value: PRICE });
      await nft.transferOwnership(await rejecting.getAddress());
      await expect(rejecting.callWithdraw(await nft.getAddress())).to.be.revertedWithCustomError(nft, "WithdrawFailed");
      expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(PRICE);
    });
  });
});

describe("Re-entrant minting: the wallet-limit attack", function () {
  it("CONTROL: the naive contract is broken — an attacker mints 6 with a limit of 3", async function () {
    const naive = await ethers.deployContract("NaiveNFT");
    const attacker = await ethers.deployContract("ReentrantMinter", [await naive.getAddress()]);
    await attacker.attack(3n, 0n, 3n);
    expect(await naive.balanceOf(await attacker.getAddress())).to.equal(6n);
    expect(await naive.mintedBy(await attacker.getAddress())).to.equal(6n); // recorded only after the damage
  });

  it("LearningNFT records the limit first, so every re-entry is refused", async function () {
    const nft = await ethers.deployContract("LearningNFT", ["x/", (await ethers.getSigners())[0].address, 500]);
    const attacker = await ethers.deployContract("ReentrantMinter", [await nft.getAddress()]);
    await attacker.attack(3n, PRICE, 3n, { value: PRICE * 6n });
    expect(await attacker.reentries()).to.equal(3n); // it really tried
    expect(await attacker.lastReentryFailed()).to.equal(true);
    expect(await nft.balanceOf(await attacker.getAddress())).to.equal(3n);
    expect(await nft.mintedBy(await attacker.getAddress())).to.equal(3n);
  });

  it("a re-entry INSIDE the limit is fine and gets the next ids (no id collision)", async function () {
    const nft = await ethers.deployContract("LearningNFT", ["x/", (await ethers.getSigners())[0].address, 500]);
    const attacker = await ethers.deployContract("ReentrantMinter", [await nft.getAddress()]);
    await attacker.attack(1n, PRICE, 2n, { value: PRICE * 3n });
    const a = await attacker.getAddress();
    expect(await nft.balanceOf(a)).to.equal(3n);
    for (const id of [1n, 2n, 3n]) expect(await nft.ownerOf(id)).to.equal(a);
    expect(await nft.totalMinted()).to.equal(3n);
  });
});
