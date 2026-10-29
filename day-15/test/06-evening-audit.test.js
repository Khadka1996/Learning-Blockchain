"use strict";
/** Evening audit (independent pass) — each test reproduces a finding from QA.md. */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Evening audit", function () {
  async function deploy() {
    const [admin, second, school] = await ethers.getSigners();
    const reg = await ethers.deployContract("CertificateRegistry", [admin.address]);
    return { admin, second, school, reg };
  }

  describe("L2 — the registry can be left with NO admin (permanent lock-out)", function () {
    it("the only admin cannot renounce or revoke itself", async function () {
      const { admin, reg } = await deploy();
      const A = await reg.DEFAULT_ADMIN_ROLE();
      await expect(reg.connect(admin).renounceRole(A, admin.address)).to.be.revertedWithCustomError(reg, "LastAdmin");
      await expect(reg.connect(admin).revokeRole(A, admin.address)).to.be.revertedWithCustomError(reg, "LastAdmin");
      expect(await reg.hasRole(A, admin.address)).to.equal(true);
    });

    it("admin hand-over still works: add a second admin, then the first may leave", async function () {
      const { admin, second, reg } = await deploy();
      const A = await reg.DEFAULT_ADMIN_ROLE();
      await reg.connect(admin).grantRole(A, second.address);
      await reg.connect(admin).renounceRole(A, admin.address);
      expect(await reg.hasRole(A, admin.address)).to.equal(false);
      expect(await reg.hasRole(A, second.address)).to.equal(true);
      // now `second` is the last admin and is protected
      await expect(reg.connect(second).renounceRole(A, second.address)).to.be.revertedWithCustomError(reg, "LastAdmin");
    });

    it("issuers can still be removed or leave freely", async function () {
      const { school, reg } = await deploy();
      const R = await reg.ISSUER_ROLE();
      await reg.grantRole(R, school.address);
      await reg.connect(school).renounceRole(R, school.address);
      expect(await reg.hasRole(R, school.address)).to.equal(false);
    });
  });
});
