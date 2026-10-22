const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, leafOf } = require("../exercises/solutions/merkle");

describe("Exercises", function () {
  describe("4. SoulboundCertificate", function () {
    let cert, issuer, ram, sita;

    beforeEach(async function () {
      [issuer, ram, sita] = await ethers.getSigners();
      cert = await ethers.deployContract("SoulboundCertificate");
      await cert.award(ram.address);
    });

    it("can be awarded but never transferred, approved or safe-transferred", async function () {
      expect(await cert.ownerOf(1n)).to.equal(ram.address);
      await expect(cert.connect(ram).transferFrom(ram.address, sita.address, 1n)).to.be.revertedWithCustomError(cert, "Soulbound");
      await expect(
        cert.connect(ram)["safeTransferFrom(address,address,uint256)"](ram.address, sita.address, 1n),
      ).to.be.revertedWithCustomError(cert, "Soulbound");
      await expect(cert.connect(ram).approve(sita.address, 1n)).to.be.revertedWithCustomError(cert, "Soulbound");
      await expect(cert.connect(ram).setApprovalForAll(sita.address, true)).to.be.revertedWithCustomError(cert, "Soulbound");
    });

    it("the issuer can revoke, the holder can delete, a stranger can do neither", async function () {
      await expect(cert.connect(sita).burn(1n)).to.be.revertedWithCustomError(cert, "NotHolderOrIssuer").withArgs(sita.address, 1n);
      await cert.connect(issuer).burn(1n);
      await cert.award(ram.address);
      await cert.connect(ram).burn(2n);
      expect(await cert.balanceOf(ram.address)).to.equal(0n);
    });

    it("only the issuer can award", async function () {
      await expect(cert.connect(ram).award(ram.address)).to.be.revertedWithCustomError(cert, "OwnableUnauthorizedAccount");
    });
  });

  describe("6-7. AllowlistNFT (Merkle presale)", function () {
    let nft, tree, signers;

    beforeEach(async function () {
      signers = await ethers.getSigners();
      const listed = signers.slice(1, 6).map((s) => s.address); // 5 addresses: an odd count on purpose
      tree = buildTree(listed);
      nft = await ethers.deployContract("AllowlistNFT", [tree.root]);
    });

    it("the JS leaf matches the contract's leaf", async function () {
      expect(await nft.leaf(signers[1].address)).to.equal(leafOf(signers[1].address));
    });

    it("every listed address can claim exactly once", async function () {
      for (const s of signers.slice(1, 6)) {
        await nft.connect(s).claim(tree.proofFor(s.address));
        await expect(nft.connect(s).claim(tree.proofFor(s.address))).to.be.revertedWithCustomError(nft, "AlreadyClaimed");
      }
      expect(await nft.nextId()).to.equal(6n);
    });

    it("an outsider is refused with a borrowed proof, an empty proof, or the root itself", async function () {
      const outsider = signers[7];
      for (const proof of [tree.proofFor(signers[1].address), [], [tree.root]]) {
        await expect(nft.connect(outsider).claim(proof)).to.be.revertedWithCustomError(nft, "NotOnAllowlist");
      }
    });

    it("a listed address with a shortened or tampered proof is refused", async function () {
      const ram = signers[1];
      const proof = tree.proofFor(ram.address);
      await expect(nft.connect(ram).claim(proof.slice(1))).to.be.revertedWithCustomError(nft, "NotOnAllowlist");
      const tampered = [...proof];
      tampered[0] = ethers.ZeroHash;
      await expect(nft.connect(ram).claim(tampered)).to.be.revertedWithCustomError(nft, "NotOnAllowlist");
    });
  });

  describe("7. the mapping alternative", function () {
    it("writes the list for ~22,000+ gas per address; only the owner can add", async function () {
      const [, alice] = await ethers.getSigners();
      const list = await ethers.deployContract("MappingAllowlist");
      const addrs = Array.from({ length: 50 }, () => ethers.Wallet.createRandom().address);
      const gas = (await (await list.addMany(addrs)).wait()).gasUsed;
      expect(gas / 50n > 22_000n).to.equal(true);
      expect(await list.allowed(addrs[49])).to.equal(true);
      await expect(list.connect(alice).addMany([alice.address])).to.be.revertedWithCustomError(list, "OwnableUnauthorizedAccount");
    });
  });
});
