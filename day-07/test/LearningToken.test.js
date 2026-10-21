const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { signPermit, latestTimestamp } = require("./helpers/permit");

describe("LearningToken: what OpenZeppelin adds on top of ERC-20", function () {
  const SUPPLY = ethers.parseEther("1000");
  const CAP = ethers.parseEther("1500");
  let token, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("LearningToken")).deploy(owner.address, SUPPLY, CAP);
    await token.waitForDeployment();
  });

  describe("identity", function () {
    it("is named Learning Token (LEARN), owned by the initial owner, capped", async function () {
      expect(await token.name()).to.equal("Learning Token");
      expect(await token.symbol()).to.equal("LEARN");
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.cap()).to.equal(CAP);
    });

    it("cannot be deployed with an initial supply above the cap", async function () {
      const Factory = await ethers.getContractFactory("LearningToken");
      await expect(Factory.deploy(owner.address, CAP + 1n, CAP)).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
    });

    it("cannot be deployed with a zero cap", async function () {
      const Factory = await ethers.getContractFactory("LearningToken");
      await expect(Factory.deploy(owner.address, 0n, 0n)).to.be.revertedWithCustomError(token, "ERC20InvalidCap");
    });
  });

  describe("mint (owner only, capped)", function () {
    it("the owner can mint and totalSupply grows", async function () {
      await expect(token.mint(alice.address, 100n))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, 100n);
      expect(await token.balanceOf(alice.address)).to.equal(100n);
      expect(await token.totalSupply()).to.equal(SUPPLY + 100n);
    });

    it("a stranger cannot mint", async function () {
      await expect(token.connect(alice).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
      expect(await token.totalSupply()).to.equal(SUPPLY);
    });

    it("can mint exactly up to the cap, and not one base unit more", async function () {
      await token.mint(alice.address, CAP - SUPPLY);
      expect(await token.totalSupply()).to.equal(CAP);
      await expect(token.mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20ExceededCap")
        .withArgs(CAP + 1n, CAP);
    });

    it("burning makes room under the cap again", async function () {
      await token.mint(alice.address, CAP - SUPPLY);
      await token.connect(alice).burn(10n);
      await expect(token.mint(bob.address, 10n)).not.to.be.reverted;
    });

    it("cannot mint to the zero address", async function () {
      await expect(token.mint(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    });

    it("ownership can be handed over, and the old owner loses the right to mint", async function () {
      await token.transferOwnership(alice.address);
      await expect(token.mint(owner.address, 1n)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      await expect(token.connect(alice).mint(alice.address, 1n)).not.to.be.reverted;
    });
  });

  describe("burnFrom (burn using an allowance)", function () {
    beforeEach(async function () {
      await token.transfer(alice.address, 500n);
    });

    it("burns the owner's tokens and spends the allowance", async function () {
      await token.connect(alice).approve(bob.address, 300n);
      await token.connect(bob).burnFrom(alice.address, 200n);
      expect(await token.balanceOf(alice.address)).to.equal(300n);
      expect(await token.allowance(alice.address, bob.address)).to.equal(100n);
      expect(await token.totalSupply()).to.equal(SUPPLY - 200n);
    });

    it("needs an allowance: nobody can burn your tokens without it", async function () {
      await expect(token.connect(bob).burnFrom(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
        .withArgs(bob.address, 0n, 1n);
    });
  });

  describe("permit (EIP-2612): approve with a signature instead of a transaction", function () {
    let deadline;
    beforeEach(async function () {
      deadline = (await latestTimestamp()) + 3600;
    });

    it("a relayer can submit Alice's signed permit: Alice pays no gas and sends no transaction", async function () {
      const { v, r, s } = await signPermit(token, alice, bob.address, 777n, deadline);
      await expect(token.connect(bob).permit(alice.address, bob.address, 777n, deadline, v, r, s))
        .to.emit(token, "Approval")
        .withArgs(alice.address, bob.address, 777n);
      expect(await token.allowance(alice.address, bob.address)).to.equal(777n);
    });

    it("uses up a nonce, so the same signature cannot be replayed", async function () {
      expect(await token.nonces(alice.address)).to.equal(0n);
      const { v, r, s } = await signPermit(token, alice, bob.address, 5n, deadline);
      await token.permit(alice.address, bob.address, 5n, deadline, v, r, s);
      expect(await token.nonces(alice.address)).to.equal(1n);
      await expect(token.permit(alice.address, bob.address, 5n, deadline, v, r, s)).to.be.revertedWithCustomError(
        token,
        "ERC2612InvalidSigner",
      );
    });

    it("rejects an expired signature", async function () {
      const past = (await latestTimestamp()) - 1;
      const { v, r, s } = await signPermit(token, alice, bob.address, 5n, past);
      await expect(token.permit(alice.address, bob.address, 5n, past, v, r, s))
        .to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature")
        .withArgs(past);
    });

    it("rejects a signature made by someone else (Bob cannot sign for Alice)", async function () {
      const { v, r, s } = await signPermit(token, bob, bob.address, 5n, deadline);
      await expect(token.permit(alice.address, bob.address, 5n, deadline, v, r, s))
        .to.be.revertedWithCustomError(token, "ERC2612InvalidSigner")
        .withArgs(anyValue, alice.address); // the recovered signer is not Alice (it is not even Bob)
    });

    it("rejects a signature whose amount, spender or deadline was changed afterwards", async function () {
      const { v, r, s } = await signPermit(token, alice, bob.address, 5n, deadline);
      await expect(token.permit(alice.address, bob.address, 6n, deadline, v, r, s)).to.be.reverted;
      await expect(token.permit(alice.address, owner.address, 5n, deadline, v, r, s)).to.be.reverted;
      await expect(token.permit(alice.address, bob.address, 5n, deadline + 1, v, r, s)).to.be.reverted;
    });

    it("the domain separator binds the signature to THIS token on THIS chain", async function () {
      const { domain } = await signPermit(token, alice, bob.address, 1n, deadline);
      expect(await token.DOMAIN_SEPARATOR()).to.equal(ethers.TypedDataEncoder.hashDomain(domain));
    });

    it("a signature for one token is worthless on another token", async function () {
      const other = await (await ethers.getContractFactory("LearningToken")).deploy(owner.address, SUPPLY, CAP);
      await other.waitForDeployment();
      const { v, r, s } = await signPermit(token, alice, bob.address, 5n, deadline);
      await expect(other.permit(alice.address, bob.address, 5n, deadline, v, r, s)).to.be.revertedWithCustomError(
        other,
        "ERC2612InvalidSigner",
      );
    });
  });
});
