"use strict";
/** Checks the evening exercise solutions. */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");
const Cert = require("../src/certificate");
const { bitsChanged, popcount } = require("../exercises/solutions/ex1-bits-changed");
const { describeVerdict } = require("../exercises/solutions/ex2-describe");
const { checkMany } = require("../exercises/solutions/ex3-check-many");

const base = { registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3", chainId: 31337, issuer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", id: "LB-001", recipient: "Manish Khadka", course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29" };

describe("Exercises", function () {
  describe("1 — bits changed", function () {
    it("popcount basics", function () {
      expect(popcount(0n)).to.equal(0);
      expect(popcount(255n)).to.equal(8);
    });
    it("reordered keys → 0 bits; one letter → about half of 256 (avalanche)", function () {
      const a = Cert.create(base);
      expect(bitsChanged(a, Object.fromEntries(Object.entries(a).reverse()))).to.equal(0);
      expect(bitsChanged(a, { ...a, recipient: "Manish Khadkq" })).to.be.within(90, 166);
    });
    it("property: always between 0 and 256, and symmetric", function () {
      fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), (s) => {
        const a = Cert.create(base);
        const b = { ...a, course: "x" + s.trim() };
        let d;
        try { d = bitsChanged(a, b); } catch { return true; } // invalid text is rejected by validate()
        return d >= 0 && d <= 256 && d === bitsChanged(b, a);
      }), { numRuns: 200 });
    });
  });

  describe("2 — describeVerdict", function () {
    const dir = { "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266": "Kathmandu University" };
    const issuer = base.issuer.toLowerCase();
    it("names a vetted issuer, case-insensitively", function () {
      expect(describeVerdict({ verdict: "VALID", cert: { issuer } }, dir)).to.equal("Genuine certificate issued by Kathmandu University.");
    });
    it("a valid certificate from an unlisted issuer is flagged", function () {
      expect(describeVerdict({ verdict: "VALID", cert: { issuer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" } }, dir)).to.match(/not on the vetted list/);
    });
    it("every verdict has a sentence", function () {
      for (const v of ["VALID_OLD_ISSUER", "REVOKED", "NOT_FOUND", "WRONG_REGISTRY", "BAD_FILE", "SOMETHING_NEW"]) expect(describeVerdict({ verdict: v, cert: { issuer } }, dir)).to.be.a("string").and.not.equal("");
    });
  });

  describe("3 — checkMany", function () {
    it("counts verdicts and flags a reused id", async function () {
      const [admin] = await ethers.getSigners();
      const reg = await ethers.deployContract("CertificateRegistry", [admin.address]);
      await reg.grantRole(await reg.ISSUER_ROLE(), admin.address);
      const { chainId } = await ethers.provider.getNetwork();
      const where = { address: await reg.getAddress(), chainId };
      const mk = (id, name) => Cert.create({ registry: where.address, chainId, issuer: admin.address, id, recipient: name, course: "C", issuedOn: "2026-10-29" });
      const [a, b, c] = [mk("LB-1", "Asha"), mk("LB-2", "Bikash"), mk("LB-2", "Chandra")];
      for (const x of [a, b, c]) await reg.issue(Cert.hash(x));
      await reg.revoke(admin.address, Cert.hash(c), "test");
      const fake = { ...a, recipient: "Forger" };
      const out = await checkMany(reg, [a, b, c, fake].map((x) => JSON.stringify(x)).concat("not json"), where);
      expect(out.counts).to.deep.equal({ VALID: 2, REVOKED: 1, NOT_FOUND: 1, BAD_FILE: 1 });
      // LB-2 is reused by two real certificates; LB-1 by the real one and the forger's edited copy
      expect(out.duplicateIds.sort()).to.deep.equal([`${admin.address}|LB-1`, `${admin.address}|LB-2`]);
    });
  });
});
