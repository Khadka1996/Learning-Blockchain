"use strict";
/**
 * Attacker tests — each one reproduces a QA finding (see QA.md) and proves the fix.
 */
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const Cert = require("../src/certificate");
const verifyDocument = require("../src/verify");

async function deploy() {
  const [admin, school, rival, forger] = await ethers.getSigners();
  const v1 = await ethers.deployContract("CertificateRegistryV1", [admin.address]);
  const reg = await ethers.deployContract("CertificateRegistry", [admin.address]);
  for (const c of [v1, reg]) {
    const R = await c.ISSUER_ROLE();
    await c.grantRole(R, school.address);
    await c.grantRole(R, rival.address); // another accredited issuer — honest until it isn't
  }
  const { chainId } = await ethers.provider.getNetwork();
  const where = { address: await reg.getAddress(), chainId };
  const cert = Cert.create({ registry: where.address, chainId, issuer: school.address, id: "LB-001", recipient: "Manish Khadka", course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29" });
  return { admin, school, rival, forger, v1, reg, where, cert };
}

/** Put txs in the mempool, then mine them together in gas-price order (like a real block). */
async function sameBlock(sendAll) {
  await network.provider.send("evm_setAutomine", [false]);
  try {
    const txs = await sendAll();
    await network.provider.send("evm_mine");
    return Promise.all(txs.map((t) => t.wait().then((r) => r.status, () => 0)));
  } finally {
    await network.provider.send("evm_setAutomine", [true]);
  }
}

describe("Attacks", function () {
  describe("M1 — a rival issuer front-runs issue() and steals the certificate", function () {
    it("V1 (keyed by hash only): the rival copies the hash from the mempool, pays more gas, wins", async function () {
      const { school, rival, v1, cert } = await loadFixture(deploy);
      const h = Cert.hash(cert);
      const [schoolOk, rivalOk] = await sameBlock(async () => [
        await v1.connect(school).issue(h, { gasPrice: ethers.parseUnits("2", "gwei"), gasLimit: 200000 }),
        await v1.connect(rival).issue(h, { gasPrice: ethers.parseUnits("50", "gwei"), gasLimit: 200000 }),
      ]);
      expect(rivalOk).to.equal(1); // mined first
      expect(schoolOk).to.equal(0); // the real school's tx reverts: AlreadyIssued
      const v = await v1.verify(h);
      expect(v.issuer).to.equal(rival.address); // the board now says the RIVAL issued it
    });

    it("fixed (per-issuer records): the same copy-paste attack changes nothing for the school", async function () {
      const { school, rival, reg, where, cert } = await loadFixture(deploy);
      const h = Cert.hash(cert);
      const [schoolOk, rivalOk] = await sameBlock(async () => [
        await reg.connect(school).issue(h, { gasPrice: ethers.parseUnits("2", "gwei"), gasLimit: 200000 }),
        await reg.connect(rival).issue(h, { gasPrice: ethers.parseUnits("50", "gwei"), gasLimit: 200000 }),
      ]);
      expect([schoolOk, rivalOk]).to.deep.equal([1, 1]);
      const res = await verifyDocument(reg, JSON.stringify(cert), where);
      expect(res.verdict).to.equal("VALID"); // looked up under the issuer named IN the file
      // and the rival's copy can't be used to revoke the school's record
      await expect(reg.connect(rival).revoke(school.address, h, "")).to.be.revertedWithCustomError(reg, "NotAllowedToRevoke");
    });
  });

  describe("M2 — a forger deploys their OWN registry and issues a matching hash there", function () {
    it("the hash really is 'Valid' on the fake registry, but verifyDocument says WRONG_REGISTRY", async function () {
      const { forger, reg, where } = await loadFixture(deploy);
      const fake = await ethers.deployContract("CertificateRegistry", [forger.address], forger);
      await fake.connect(forger).grantRole(await fake.ISSUER_ROLE(), forger.address);
      // the forger writes a certificate that names the REAL registry but their own issuer key…
      const doc = Cert.create({ registry: where.address, chainId: where.chainId, issuer: forger.address, id: "FAKE-1", recipient: "Forger", course: "PhD in Everything", issuedOn: "2026-10-29" });
      await fake.connect(forger).issue(Cert.hash(doc));
      // …and on the fake registry the raw lookup says Valid:
      expect((await fake.verify(forger.address, Cert.hash(doc))).status).to.equal(1n);
      // A careful verifier checks the registry it trusts:
      expect((await verifyDocument(reg, JSON.stringify(doc), where)).verdict).to.equal("NOT_FOUND");
      // If the forger points the file at their own registry, it no longer matches the one we trust:
      const doc2 = { ...doc, registry: await fake.getAddress() };
      expect((await verifyDocument(reg, JSON.stringify(doc2), where)).verdict).to.equal("WRONG_REGISTRY");
      // and the same file on another chain id is also refused
      expect((await verifyDocument(reg, JSON.stringify(doc), { ...where, chainId: 1n })).verdict).to.equal("WRONG_REGISTRY");
    });
  });

  describe("Privacy — guessing a certificate from public facts", function () {
    it("WITHOUT a salt, 1,000 guesses find the student; WITH a 16-byte salt they find nothing", async function () {
      const { cert } = await loadFixture(deploy);
      const names = Array.from({ length: 999 }, (_, i) => `Student ${i}`).concat("Manish Khadka");
      const unsalted = (c) => ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ recipient: c.recipient, course: c.course, issuedOn: c.issuedOn })));
      const onChainUnsalted = unsalted(cert);
      const found = names.find((n) => unsalted({ ...cert, recipient: n }) === onChainUnsalted);
      expect(found).to.equal("Manish Khadka"); // privacy broken

      const onChain = Cert.hash(cert);
      const hits = names.filter((n) => Cert.hash({ ...cert, recipient: n, salt: Cert.randomSalt() }) === onChain);
      expect(hits).to.deep.equal([]); // 2^128 salts × names: hopeless
      // and the library refuses a certificate with no salt at all
      const { salt, ...noSalt } = cert;
      expect(salt).to.match(/^0x[0-9a-f]{32}$/);
      expect(() => Cert.hash(noSalt)).to.throw(/salt/);
    });
  });

  describe("M3 — stolen issuer key", function () {
    it("admin removes the issuer: new issues fail, the admin can cancel fakes, the page warns on old ones", async function () {
      const { admin, school, reg, where, cert } = await loadFixture(deploy);
      const h = Cert.hash(cert);
      await reg.connect(school).issue(h);
      const fakeHash = ethers.id("fake made with the stolen key");
      await reg.connect(school).issue(fakeHash);
      await reg.connect(admin).revokeRole(await reg.ISSUER_ROLE(), school.address);
      await expect(reg.connect(school).issue(ethers.id("another"))).to.be.revertedWithCustomError(reg, "AccessControlUnauthorizedAccount");
      await reg.connect(admin).revoke(school.address, fakeHash, "made with stolen key");
      expect((await reg.verify(school.address, fakeHash)).status).to.equal(2n);
      // M3: after removal the thief must not be able to cancel the school's REAL certificates
      await expect(reg.connect(school).revoke(school.address, h, "griefing")).to.be.revertedWithCustomError(reg, "NotAllowedToRevoke");
      expect((await verifyDocument(reg, JSON.stringify(cert), where)).verdict).to.equal("VALID_OLD_ISSUER");
    });
  });

  describe("Denial of service & input limits", function () {
    it("a full batch of 100 certificates stays far below the 30M block gas limit", async function () {
      const { school, reg } = await loadFixture(deploy);
      const hashes = Array.from({ length: 100 }, (_, i) => ethers.id("cert " + i));
      const r = await (await reg.connect(school).issueBatch(hashes)).wait();
      expect(r.gasUsed).to.be.lessThan(3_000_000n);
    });

    it("hostile certificate files are rejected before any chain call", async function () {
      const { reg, where, cert } = await loadFixture(deploy);
      const bad = [
        "", "null", "[]", "{", "x".repeat(20000),
        JSON.stringify({ ...cert, admin: true }), // extra field
        JSON.stringify({ ...cert, version: 2 }),
        JSON.stringify({ ...cert, issuedOn: "2026-02-30" }), // not a real date
        JSON.stringify({ ...cert, salt: "0x1234" }),
        JSON.stringify({ ...cert, recipient: "Manish\u0000Khadka" }), // control char
        JSON.stringify({ ...cert, recipient: "M".repeat(121) }),
        JSON.stringify({ ...cert, chainId: "31337" }),
        JSON.stringify({ ...cert, issuer: "0x0000" }),
      ];
      for (const text of bad) expect((await verifyDocument(reg, text, where)).verdict, text.slice(0, 40)).to.equal("BAD_FILE");
    });
  });
});
