"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const Cert = require("../src/certificate");

const Status = { Unknown: 0n, Valid: 1n, Revoked: 2n };

async function deploy() {
  const [admin, school, otherSchool, student, stranger] = await ethers.getSigners();
  const reg = await ethers.deployContract("CertificateRegistry", [admin.address]);
  const ISSUER = await reg.ISSUER_ROLE();
  await reg.grantRole(ISSUER, school.address);
  await reg.grantRole(ISSUER, otherSchool.address);
  const { chainId } = await ethers.provider.getNetwork();
  const registry = await reg.getAddress();
  const make = (issuer, recipient = "Manish Khadka", id = "LB-2026-001") =>
    Cert.create({ registry, chainId, issuer: issuer.address, id, recipient, course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29" });
  return { reg, ISSUER, admin, school, otherSchool, student, stranger, make };
}

describe("CertificateRegistry", function () {
  describe("deploy", function () {
    it("gives the admin role to the given address and rejects address(0)", async function () {
      const { reg, admin } = await loadFixture(deploy);
      expect(await reg.hasRole(await reg.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      const F = await ethers.getContractFactory("CertificateRegistry");
      await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
    });
  });

  describe("issue", function () {
    it("an issuer records a certificate and anyone can verify it", async function () {
      const { reg, school, stranger, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await expect(reg.connect(school).issue(h)).to.emit(reg, "CertificateIssued").withArgs(school.address, h);
      const v = await reg.connect(stranger).verify(school.address, h);
      expect(v.status).to.equal(Status.Valid);
      expect(v.issuedAt).to.equal(BigInt(await time.latest()));
      expect(v.revokedAt).to.equal(0n);
      expect(v.issuerActive).to.equal(true);
      expect(await reg.issuedCount()).to.equal(1n);
    });

    it("non-issuers (student, stranger, even the admin) cannot issue", async function () {
      const { reg, admin, student, make, school } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      for (const who of [admin, student]) {
        await expect(reg.connect(who).issue(h)).to.be.revertedWithCustomError(reg, "AccessControlUnauthorizedAccount");
      }
    });

    it("rejects the zero hash and duplicates", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      await expect(reg.connect(school).issue(ethers.ZeroHash)).to.be.revertedWithCustomError(reg, "ZeroHash");
      const h = Cert.hash(make(school));
      await reg.connect(school).issue(h);
      await expect(reg.connect(school).issue(h)).to.be.revertedWithCustomError(reg, "AlreadyIssued").withArgs(h);
    });

    it("issueBatch: a whole class in one tx, size limits enforced, all-or-nothing", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      const hashes = Array.from({ length: 30 }, (_, i) => Cert.hash(make(school, `Student ${i}`, `LB-${i}`)));
      await reg.connect(school).issueBatch(hashes);
      expect(await reg.issuedCount()).to.equal(30n);
      await expect(reg.connect(school).issueBatch([])).to.be.revertedWithCustomError(reg, "BadBatchSize").withArgs(0);
      const tooMany = Array.from({ length: 101 }, (_, i) => ethers.id("x" + i));
      await expect(reg.connect(school).issueBatch(tooMany)).to.be.revertedWithCustomError(reg, "BadBatchSize").withArgs(101);
      // one duplicate inside a batch reverts the whole batch
      const fresh = ethers.id("fresh");
      await expect(reg.connect(school).issueBatch([fresh, hashes[0]])).to.be.revertedWithCustomError(reg, "AlreadyIssued");
      expect((await reg.verify(school.address, fresh)).status).to.equal(Status.Unknown);
    });
  });

  describe("verify", function () {
    it("a tampered certificate (one letter changed) is Unknown", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      const cert = make(school);
      await reg.connect(school).issue(Cert.hash(cert));
      const forged = { ...cert, recipient: "Manish Khadkа" }; // Cyrillic "а" at the end
      expect((await reg.verify(school.address, Cert.hash(forged))).status).to.equal(Status.Unknown);
      const upgraded = { ...cert, course: "Learning Blockchain in 16 Days" };
      expect((await reg.verify(school.address, Cert.hash(upgraded))).status).to.equal(Status.Unknown);
    });

    it("shows when an issuer has since lost its role (old certificates stay readable)", async function () {
      const { reg, ISSUER, school, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await reg.connect(school).issue(h);
      await reg.revokeRole(ISSUER, school.address);
      const v = await reg.verify(school.address, h);
      expect(v.status).to.equal(Status.Valid);
      expect(v.issuerActive).to.equal(false);
    });
  });

  describe("revoke", function () {
    it("the issuer revokes its own certificate with a reason", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await reg.connect(school).issue(h);
      await expect(reg.connect(school).revoke(school.address, h, "issued by mistake"))
        .to.emit(reg, "CertificateRevoked")
        .withArgs(school.address, h, school.address, "issued by mistake");
      const v = await reg.verify(school.address, h);
      expect(v.status).to.equal(Status.Revoked);
      expect(v.revokedAt).to.equal(BigInt(await time.latest()));
      expect(await reg.revokedCount()).to.equal(1n);
    });

    it("the admin can revoke any certificate (stolen issuer key)", async function () {
      const { reg, admin, school, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await reg.connect(school).issue(h);
      await reg.connect(admin).revoke(school.address, h, "issuer key compromised");
      expect((await reg.verify(school.address, h)).status).to.equal(Status.Revoked);
    });

    it("another issuer, the student or a stranger cannot revoke", async function () {
      const { reg, school, otherSchool, student, stranger, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await reg.connect(school).issue(h);
      for (const who of [otherSchool, student, stranger]) {
        await expect(reg.connect(who).revoke(school.address, h, "")).to.be.revertedWithCustomError(reg, "NotAllowedToRevoke").withArgs(who.address);
      }
    });

    it("cannot revoke twice, revoke unknown, or use an over-long reason", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await expect(reg.connect(school).revoke(school.address, h, "")).to.be.revertedWithCustomError(reg, "NotIssued");
      await reg.connect(school).issue(h);
      await expect(reg.connect(school).revoke(school.address, h, "x".repeat(201))).to.be.revertedWithCustomError(reg, "ReasonTooLong").withArgs(201);
      await reg.connect(school).revoke(school.address, h, "x".repeat(200));
      await expect(reg.connect(school).revoke(school.address, h, "")).to.be.revertedWithCustomError(reg, "AlreadyRevoked");
    });

    it("a revoked certificate can never be re-issued back to Valid", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      const h = Cert.hash(make(school));
      await reg.connect(school).issue(h);
      await reg.connect(school).revoke(school.address, h, "cheated");
      await expect(reg.connect(school).issue(h)).to.be.revertedWithCustomError(reg, "AlreadyIssued");
      expect((await reg.verify(school.address, h)).status).to.equal(Status.Revoked);
    });
  });

  describe("gas", function () {
    it("one certificate fits in ONE storage slot (~ 70k gas to issue)", async function () {
      const { reg, school, make } = await loadFixture(deploy);
      const r = await (await reg.connect(school).issue(Cert.hash(make(school)))).wait();
      expect(r.gasUsed).to.be.lessThan(75000n);
    });
  });
});
