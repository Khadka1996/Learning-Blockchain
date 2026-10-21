const { expect } = require("chai");
const { ethers } = require("hardhat");

const MAX = ethers.MaxUint256;

/**
 * The ERC-20 behaviour every token in this repo must have. `deploy()` returns
 * { token, holder, supply }: a token whose whole initial supply belongs to `holder`.
 * The same checks run against MiniToken, plain OpenZeppelin and LearningToken.
 */
function shouldBehaveLikeERC20(deploy) {
  let token, holder, alice, bob, carol, supply;

  beforeEach(async function () {
    [, alice, bob, carol] = await ethers.getSigners();
    ({ token, holder, supply } = await deploy());
  });

  describe("metadata and supply", function () {
    it("has 18 decimals and the whole supply on the holder", async function () {
      expect(await token.decimals()).to.equal(18n);
      expect(await token.totalSupply()).to.equal(supply);
      expect(await token.balanceOf(holder.address)).to.equal(supply);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("the initial mint is announced as Transfer(0x0 -> holder)", async function () {
      const receipt = await token.deploymentTransaction().wait();
      const events = receipt.logs.map((l) => token.interface.parseLog(l)).filter((e) => e && e.name === "Transfer");
      expect(events[0].args[0]).to.equal(ethers.ZeroAddress);
      expect(events[0].args[1]).to.equal(holder.address);
      expect(events[0].args[2]).to.equal(supply);
    });
  });

  describe("transfer", function () {
    it("moves tokens, keeps the supply, and emits Transfer(from, to, value)", async function () {
      await expect(token.connect(holder).transfer(alice.address, 300n))
        .to.emit(token, "Transfer")
        .withArgs(holder.address, alice.address, 300n);
      expect(await token.balanceOf(holder.address)).to.equal(supply - 300n);
      expect(await token.balanceOf(alice.address)).to.equal(300n);
      expect(await token.totalSupply()).to.equal(supply);
    });

    it("returns true", async function () {
      expect(await token.connect(holder).transfer.staticCall(alice.address, 1n)).to.equal(true);
    });

    it("a zero-value transfer is legal and still emits Transfer", async function () {
      await expect(token.connect(holder).transfer(alice.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(holder.address, alice.address, 0n);
    });

    it("can send the ENTIRE balance (boundary: value == balance)", async function () {
      await token.connect(holder).transfer(alice.address, supply);
      expect(await token.balanceOf(holder.address)).to.equal(0n);
      expect(await token.balanceOf(alice.address)).to.equal(supply);
    });

    it("rejects 1 more than the balance, reporting who, how much they have and how much was needed", async function () {
      await expect(token.connect(holder).transfer(alice.address, supply + 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(holder.address, supply, supply + 1n);
    });

    it("rejects a sender with no tokens", async function () {
      await expect(token.connect(alice).transfer(bob.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(alice.address, 0n, 1n);
    });

    it("rejects sending to the zero address (that would burn by accident)", async function () {
      await expect(token.connect(holder).transfer(ethers.ZeroAddress, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });

    it("sending to yourself changes nothing", async function () {
      await token.connect(holder).transfer(holder.address, 500n);
      expect(await token.balanceOf(holder.address)).to.equal(supply);
    });

    it("a failed transfer changes nothing", async function () {
      await expect(token.connect(holder).transfer(alice.address, supply + 1n)).to.be.reverted;
      expect(await token.balanceOf(holder.address)).to.equal(supply);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });
  });

  describe("approve and allowance", function () {
    it("sets the allowance and emits Approval(owner, spender, value)", async function () {
      await expect(token.connect(holder).approve(alice.address, 100n))
        .to.emit(token, "Approval")
        .withArgs(holder.address, alice.address, 100n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(100n);
    });

    it("returns true and moves no tokens", async function () {
      expect(await token.connect(holder).approve.staticCall(alice.address, 100n)).to.equal(true);
      await token.connect(holder).approve(alice.address, 100n);
      expect(await token.balanceOf(holder.address)).to.equal(supply);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("OVERWRITES the previous allowance (it does not add)", async function () {
      await token.connect(holder).approve(alice.address, 100n);
      await token.connect(holder).approve(alice.address, 40n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(40n);
    });

    it("can be set to 0 to revoke", async function () {
      await token.connect(holder).approve(alice.address, 100n);
      await token.connect(holder).approve(alice.address, 0n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(0n);
    });

    it("is per spender: approving Alice does not approve Bob", async function () {
      await token.connect(holder).approve(alice.address, 100n);
      expect(await token.allowance(holder.address, bob.address)).to.equal(0n);
    });

    it("can approve more than the owner currently holds (it is a permission, not a lock)", async function () {
      await token.connect(holder).approve(alice.address, supply * 10n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(supply * 10n);
    });

    it("rejects approving the zero address", async function () {
      await expect(token.connect(holder).approve(ethers.ZeroAddress, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InvalidSpender")
        .withArgs(ethers.ZeroAddress);
    });
  });

  describe("transferFrom", function () {
    beforeEach(async function () {
      await token.connect(holder).approve(alice.address, 1000n);
    });

    it("lets the spender move tokens to anyone and emits Transfer(from, to, value)", async function () {
      await expect(token.connect(alice).transferFrom(holder.address, bob.address, 400n))
        .to.emit(token, "Transfer")
        .withArgs(holder.address, bob.address, 400n);
      expect(await token.balanceOf(bob.address)).to.equal(400n);
      expect(await token.balanceOf(holder.address)).to.equal(supply - 400n);
    });

    it("returns true", async function () {
      expect(await token.connect(alice).transferFrom.staticCall(holder.address, bob.address, 1n)).to.equal(true);
    });

    it("uses up the allowance as it is spent", async function () {
      await token.connect(alice).transferFrom(holder.address, bob.address, 400n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(600n);
      await token.connect(alice).transferFrom(holder.address, bob.address, 600n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(0n);
    });

    it("spending an allowance does not emit Approval (that event is for explicit approvals)", async function () {
      const receipt = await (await token.connect(alice).transferFrom(holder.address, bob.address, 1n)).wait();
      const names = receipt.logs.map((l) => token.interface.parseLog(l).name);
      expect(names).to.deep.equal(["Transfer"]);
    });

    it("rejects 1 more than the allowance, reporting spender, allowance and amount", async function () {
      await expect(token.connect(alice).transferFrom(holder.address, bob.address, 1001n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(alice.address, 1000n, 1001n);
    });

    it("an allowance does not help if the owner's BALANCE is too small", async function () {
      await token.connect(holder).transfer(carol.address, supply); // empty the holder
      await expect(token.connect(alice).transferFrom(holder.address, bob.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
        .withArgs(holder.address, 0n, 1n);
    });

    it("someone WITHOUT an allowance cannot move other people's tokens", async function () {
      await expect(token.connect(bob).transferFrom(holder.address, bob.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(bob.address, 0n, 1n);
    });

    it("even the owner needs an allowance to use transferFrom on themselves", async function () {
      await expect(token.connect(holder).transferFrom(holder.address, bob.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(holder.address, 0n, 1n);
    });

    it("rejects sending to the zero address", async function () {
      await expect(token.connect(alice).transferFrom(holder.address, ethers.ZeroAddress, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    });

    it("a failed transferFrom keeps the allowance intact", async function () {
      await expect(token.connect(alice).transferFrom(holder.address, bob.address, 1001n)).to.be.reverted;
      expect(await token.allowance(holder.address, alice.address)).to.equal(1000n);
    });

    it("an UNLIMITED allowance (2^256 - 1) is never reduced", async function () {
      await token.connect(holder).approve(alice.address, MAX);
      await token.connect(alice).transferFrom(holder.address, bob.address, 123n);
      expect(await token.allowance(holder.address, alice.address)).to.equal(MAX);
    });
  });

  describe("burn", function () {
    it("destroys the caller's tokens: balance and totalSupply both go down, Transfer(holder -> 0x0)", async function () {
      await expect(token.connect(holder).burn(400n))
        .to.emit(token, "Transfer")
        .withArgs(holder.address, ethers.ZeroAddress, 400n);
      expect(await token.balanceOf(holder.address)).to.equal(supply - 400n);
      expect(await token.totalSupply()).to.equal(supply - 400n);
    });

    it("cannot burn more than you hold", async function () {
      await expect(token.connect(alice).burn(1n)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });
}

module.exports = { shouldBehaveLikeERC20, MAX };
