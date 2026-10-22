const { expect } = require("chai");
const { ethers } = require("hardhat");

const GOLD = 0n;
const SWORD = 1n;
const CROWN = 2n;

describe("GameItems (ERC-1155: many item types in one contract)", function () {
  let items, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    items = await ethers.deployContract("GameItems", ["ipfs://items/{id}.json"]);
  });

  it("one id behaves like a coin, another like a unique NFT", async function () {
    await items.mint(alice.address, GOLD, 1000n);
    await items.mint(alice.address, CROWN, 1n);
    expect(await items.balanceOf(alice.address, GOLD)).to.equal(1000n);
    expect(await items.balanceOf(alice.address, CROWN)).to.equal(1n);
    expect(await items["totalSupply(uint256)"](GOLD)).to.equal(1000n);
    expect(await items["totalSupply()"]()).to.equal(1001n);
  });

  it("the uri is one template for every id; the client fills in {id}", async function () {
    expect(await items.uri(SWORD)).to.equal("ipfs://items/{id}.json");
  });

  it("mintBatch creates several item types in ONE transaction (one TransferBatch event)", async function () {
    await expect(items.mintBatch(alice.address, [GOLD, SWORD, CROWN], [500n, 3n, 1n]))
      .to.emit(items, "TransferBatch")
      .withArgs(owner.address, ethers.ZeroAddress, alice.address, [GOLD, SWORD, CROWN], [500n, 3n, 1n]);
    const balances = await items.balanceOfBatch([alice.address, alice.address, alice.address], [GOLD, SWORD, CROWN]);
    expect(balances).to.deep.equal([500n, 3n, 1n]);
  });

  it("there can only ever be ONE crown", async function () {
    await items.mint(alice.address, CROWN, 1n);
    await expect(items.mint(bob.address, CROWN, 1n))
      .to.be.revertedWithCustomError(items, "ExceedsMaxSupply")
      .withArgs(CROWN, 1n, 0n);
  });

  it("the same id twice in one batch cannot sneak past its cap", async function () {
    await expect(items.mintBatch(alice.address, [CROWN, CROWN], [1n, 1n]))
      .to.be.revertedWithCustomError(items, "ExceedsMaxSupply")
      .withArgs(CROWN, 2n, 1n);
    await expect(items.mintBatch(alice.address, [SWORD, GOLD, SWORD], [60n, 1n, 41n]))
      .to.be.revertedWithCustomError(items, "ExceedsMaxSupply")
      .withArgs(SWORD, 101n, 100n);
    await items.mintBatch(alice.address, [SWORD, SWORD], [60n, 40n]); // exactly the cap is fine
    expect(await items["totalSupply(uint256)"](SWORD)).to.equal(100n);
  });

  it("ids that were never defined cannot be minted", async function () {
    await expect(items.mint(alice.address, 99n, 1n)).to.be.revertedWithCustomError(items, "UnknownItem").withArgs(99n);
  });

  it("mismatched batch arrays are refused", async function () {
    await expect(items.mintBatch(alice.address, [GOLD, SWORD], [1n]))
      .to.be.revertedWithCustomError(items, "ERC1155InvalidArrayLength")
      .withArgs(2n, 1n);
  });

  it("only the owner can mint", async function () {
    await expect(items.connect(alice).mint(alice.address, GOLD, 1n))
      .to.be.revertedWithCustomError(items, "OwnableUnauthorizedAccount")
      .withArgs(alice.address);
    await expect(items.connect(alice).mintBatch(alice.address, [GOLD], [1n])).to.be.revertedWithCustomError(
      items,
      "OwnableUnauthorizedAccount",
    );
  });

  it("transfers: the owner moves part of a stack; a stranger cannot", async function () {
    await items.mint(alice.address, GOLD, 100n);
    await items.connect(alice).safeTransferFrom(alice.address, bob.address, GOLD, 30n, "0x");
    expect(await items.balanceOf(alice.address, GOLD)).to.equal(70n);
    expect(await items.balanceOf(bob.address, GOLD)).to.equal(30n);
    await expect(items.connect(bob).safeTransferFrom(alice.address, bob.address, GOLD, 1n, "0x"))
      .to.be.revertedWithCustomError(items, "ERC1155MissingApprovalForAll")
      .withArgs(bob.address, alice.address);
  });

  it("sending more than you have is refused", async function () {
    await items.mint(alice.address, GOLD, 10n);
    await expect(items.connect(alice).safeTransferFrom(alice.address, bob.address, GOLD, 11n, "0x"))
      .to.be.revertedWithCustomError(items, "ERC1155InsufficientBalance")
      .withArgs(alice.address, 10n, 11n, GOLD);
  });

  it("ERC-1155 has ONLY operator approval (no per-id allowance)", async function () {
    await items.mint(alice.address, GOLD, 100n);
    await items.mint(alice.address, CROWN, 1n);
    await items.connect(alice).setApprovalForAll(bob.address, true);
    // Approving a marketplace for GOLD also lets it take the CROWN:
    await items.connect(bob).safeTransferFrom(alice.address, bob.address, CROWN, 1n, "0x");
    expect(await items.balanceOf(bob.address, CROWN)).to.equal(1n);
  });

  it("there is NO unsafe transfer: a contract without the hook can never receive", async function () {
    await items.mint(alice.address, GOLD, 5n);
    const noHook = await ethers.deployContract("NoHookContract");
    const to = await noHook.getAddress();
    await expect(items.connect(alice).safeTransferFrom(alice.address, to, GOLD, 1n, "0x"))
      .to.be.revertedWithCustomError(items, "ERC1155InvalidReceiver")
      .withArgs(to);
    await expect(items.mint(to, GOLD, 1n)).to.be.revertedWithCustomError(items, "ERC1155InvalidReceiver");
    const good = await ethers.deployContract("GoodReceiver");
    await items.mintBatch(await good.getAddress(), [GOLD, SWORD], [1n, 1n]);
    expect(await items.balanceOf(await good.getAddress(), SWORD)).to.equal(1n);
  });

  it("supports ERC-1155 and its metadata extension, not ERC-721", async function () {
    expect(await items.supportsInterface("0xd9b67a26")).to.equal(true);
    expect(await items.supportsInterface("0x0e89341c")).to.equal(true);
    expect(await items.supportsInterface("0x80ac58cd")).to.equal(false);
  });
});
