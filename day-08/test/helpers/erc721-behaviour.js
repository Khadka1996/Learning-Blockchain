const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * The ERC-721 behaviour every NFT in this repo must have. `deploy()` returns
 * { nft, minter }: an empty collection where `nft.connect(minter).mint(to, id)` works.
 * The same checks run against MiniNFT (hand-written) and plain OpenZeppelin.
 */
function shouldBehaveLikeERC721(deploy) {
  let nft, minter, alice, bob, carol;

  beforeEach(async function () {
    [, alice, bob, carol] = await ethers.getSigners();
    ({ nft, minter } = await deploy());
    await nft.connect(minter).mint(alice.address, 1n);
    await nft.connect(minter).mint(alice.address, 2n);
  });

  describe("ERC-165: which standards it speaks", function () {
    it("says yes to ERC-165, ERC-721 and ERC-721 Metadata, no to others", async function () {
      expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
      expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
      expect(await nft.supportsInterface("0x5b5e139f")).to.equal(true);
      expect(await nft.supportsInterface("0x36372b07")).to.equal(false); // ERC-20
      expect(await nft.supportsInterface("0xffffffff")).to.equal(false); // must be false by EIP-165
    });
  });

  describe("ownership table", function () {
    it("ownerOf and balanceOf reflect mints", async function () {
      expect(await nft.ownerOf(1n)).to.equal(alice.address);
      expect(await nft.balanceOf(alice.address)).to.equal(2n);
      expect(await nft.balanceOf(bob.address)).to.equal(0n);
    });

    it("ownerOf a token that does not exist reverts (it never returns 0x0)", async function () {
      await expect(nft.ownerOf(99n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken").withArgs(99n);
    });

    it("balanceOf(0x0) reverts", async function () {
      await expect(nft.balanceOf(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidOwner")
        .withArgs(ethers.ZeroAddress);
    });

    it("the same id cannot be minted twice", async function () {
      await expect(nft.connect(minter).mint(bob.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidSender")
        .withArgs(ethers.ZeroAddress);
    });

    it("minting to 0x0 reverts", async function () {
      await expect(nft.connect(minter).mint(ethers.ZeroAddress, 9n))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });

    it("mint emits Transfer(0x0 -> to, id)", async function () {
      await expect(nft.connect(minter).mint(bob.address, 7n))
        .to.emit(nft, "Transfer")
        .withArgs(ethers.ZeroAddress, bob.address, 7n);
    });
  });

  describe("transferFrom", function () {
    it("the owner can move a token; balances and the event follow", async function () {
      await expect(nft.connect(alice).transferFrom(alice.address, bob.address, 1n))
        .to.emit(nft, "Transfer")
        .withArgs(alice.address, bob.address, 1n);
      expect(await nft.ownerOf(1n)).to.equal(bob.address);
      expect(await nft.balanceOf(alice.address)).to.equal(1n);
      expect(await nft.balanceOf(bob.address)).to.equal(1n);
    });

    it("a stranger cannot move someone else's token", async function () {
      await expect(nft.connect(bob).transferFrom(alice.address, bob.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval")
        .withArgs(bob.address, 1n);
    });

    it("the owner passing the wrong `from` is refused", async function () {
      await expect(nft.connect(alice).transferFrom(bob.address, carol.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721IncorrectOwner")
        .withArgs(bob.address, 1n, alice.address);
    });

    it("a STRANGER passing the wrong `from` gets the approval error first (same order as OpenZeppelin)", async function () {
      await expect(nft.connect(carol).transferFrom(bob.address, carol.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval")
        .withArgs(carol.address, 1n);
    });

    it("sending to 0x0 is refused (that would be a burn by mistake)", async function () {
      await expect(nft.connect(alice).transferFrom(alice.address, ethers.ZeroAddress, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });

    it("moving a token that does not exist reverts", async function () {
      await expect(nft.connect(alice).transferFrom(alice.address, bob.address, 42n))
        .to.be.revertedWithCustomError(nft, "ERC721NonexistentToken")
        .withArgs(42n);
    });

    it("sending to yourself is allowed and changes nothing", async function () {
      await nft.connect(alice).transferFrom(alice.address, alice.address, 1n);
      expect(await nft.ownerOf(1n)).to.equal(alice.address);
      expect(await nft.balanceOf(alice.address)).to.equal(2n);
    });
  });

  describe("approve: one address, one token", function () {
    it("an approved address can move that token, and only that one", async function () {
      await expect(nft.connect(alice).approve(bob.address, 1n))
        .to.emit(nft, "Approval")
        .withArgs(alice.address, bob.address, 1n);
      expect(await nft.getApproved(1n)).to.equal(bob.address);
      await nft.connect(bob).transferFrom(alice.address, carol.address, 1n);
      expect(await nft.ownerOf(1n)).to.equal(carol.address);
      await expect(nft.connect(bob).transferFrom(alice.address, carol.address, 2n))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval");
    });

    it("the approval is wiped when the token moves (the old buyer cannot take it back)", async function () {
      await nft.connect(alice).approve(bob.address, 1n);
      await nft.connect(alice).transferFrom(alice.address, carol.address, 1n);
      expect(await nft.getApproved(1n)).to.equal(ethers.ZeroAddress);
      await expect(nft.connect(bob).transferFrom(carol.address, bob.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval");
    });

    it("only the owner or an operator may approve", async function () {
      await expect(nft.connect(bob).approve(bob.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidApprover")
        .withArgs(bob.address);
    });

    it("getApproved of a missing token reverts", async function () {
      await expect(nft.getApproved(77n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });
  });

  describe("setApprovalForAll: an operator for everything", function () {
    it("an operator can move every token of the owner, and approve others", async function () {
      await expect(nft.connect(alice).setApprovalForAll(bob.address, true))
        .to.emit(nft, "ApprovalForAll")
        .withArgs(alice.address, bob.address, true);
      await nft.connect(bob).transferFrom(alice.address, carol.address, 1n);
      await nft.connect(bob).approve(carol.address, 2n);
      await nft.connect(carol).transferFrom(alice.address, carol.address, 2n);
      expect(await nft.balanceOf(carol.address)).to.equal(2n);
    });

    it("revoking works immediately", async function () {
      await nft.connect(alice).setApprovalForAll(bob.address, true);
      await nft.connect(alice).setApprovalForAll(bob.address, false);
      await expect(nft.connect(bob).transferFrom(alice.address, bob.address, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval");
    });

    it("0x0 cannot be an operator", async function () {
      await expect(nft.connect(alice).setApprovalForAll(ethers.ZeroAddress, true))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidOperator")
        .withArgs(ethers.ZeroAddress);
    });

    it("operator approval survives transfers (it belongs to the owner, not the token)", async function () {
      await nft.connect(alice).setApprovalForAll(bob.address, true);
      await nft.connect(alice).transferFrom(alice.address, carol.address, 1n);
      expect(await nft.isApprovedForAll(alice.address, bob.address)).to.equal(true);
      await nft.connect(bob).transferFrom(alice.address, bob.address, 2n);
    });
  });

  describe("safeTransferFrom: do not send NFTs into a black hole", function () {
    let good, noHook, wrong, refusing;

    beforeEach(async function () {
      good = await ethers.deployContract("GoodReceiver");
      noHook = await ethers.deployContract("NoHookContract");
      wrong = await ethers.deployContract("WrongAnswerReceiver");
      refusing = await ethers.deployContract("RefusingReceiver");
    });

    const safe = (n, ...a) => n["safeTransferFrom(address,address,uint256)"](...a);
    const safeData = (n, ...a) => n["safeTransferFrom(address,address,uint256,bytes)"](...a);

    it("to a normal wallet: works", async function () {
      await safe(nft.connect(alice), alice.address, bob.address, 1n);
      expect(await nft.ownerOf(1n)).to.equal(bob.address);
    });

    it("to a contract that answers correctly: works, and the data arrives", async function () {
      await safeData(nft.connect(alice), alice.address, await good.getAddress(), 1n, "0x1234");
      expect(await nft.ownerOf(1n)).to.equal(await good.getAddress());
      expect(await good.received721()).to.equal(1n);
      expect(await good.lastData()).to.equal("0x1234");
    });

    it("to a contract with no hook: refused (the token would be stuck forever)", async function () {
      const to = await noHook.getAddress();
      await expect(safe(nft.connect(alice), alice.address, to, 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver")
        .withArgs(to);
      expect(await nft.ownerOf(1n)).to.equal(alice.address);
    });

    it("plain transferFrom does NOT check, and the token is stuck (why `safe` exists)", async function () {
      await nft.connect(alice).transferFrom(alice.address, await noHook.getAddress(), 1n);
      expect(await nft.ownerOf(1n)).to.equal(await noHook.getAddress());
    });

    it("to a contract answering the wrong 4 bytes: refused", async function () {
      await expect(safe(nft.connect(alice), alice.address, await wrong.getAddress(), 1n))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver");
    });

    it("to a contract that refuses: its own error is passed on", async function () {
      await expect(safe(nft.connect(alice), alice.address, await refusing.getAddress(), 1n))
        .to.be.revertedWithCustomError(refusing, "NoThanks");
    });
  });

  describe("burn", function () {
    it("the owner can burn; the token no longer exists", async function () {
      await expect(nft.connect(alice).burn(1n))
        .to.emit(nft, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 1n);
      await expect(nft.ownerOf(1n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
      expect(await nft.balanceOf(alice.address)).to.equal(1n);
    });

    it("a stranger cannot burn", async function () {
      await expect(nft.connect(bob).burn(1n))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval")
        .withArgs(bob.address, 1n);
    });

    it("burning clears the approval, and a burned id can be minted again", async function () {
      await nft.connect(alice).approve(bob.address, 1n);
      await nft.connect(bob).burn(1n);
      await nft.connect(minter).mint(carol.address, 1n);
      expect(await nft.getApproved(1n)).to.equal(ethers.ZeroAddress);
      expect(await nft.ownerOf(1n)).to.equal(carol.address);
    });
  });
}

module.exports = { shouldBehaveLikeERC721 };
