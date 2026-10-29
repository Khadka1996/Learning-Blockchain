"use strict";
/**
 * Property / fuzz tests with fast-check.
 *  1. The certificate fingerprint: same meaning → same hash; any real change → new hash;
 *     junk input → clear error (never a silent hash of garbage).
 *  2. The contract vs a tiny JavaScript model: random sequences of issue / revoke /
 *     role changes by random people must always agree with the model.
 */
const { expect } = require("chai");
const fc = require("fast-check");
const { ethers } = require("hardhat");
const Cert = require("../src/certificate");

const ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ISSUER = "0x70997970C51812Dc3A010c7D01B50E20D17Dc79C";
// eslint-disable-next-line no-control-regex -- deliberately excluding control characters
const text = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(s));
const certArb = fc.record({
  id: text,
  recipient: text,
  course: text,
  issuedOn: fc.date({ min: new Date("2000-01-01"), max: new Date("2099-12-31") }).map((d) => d.toISOString().slice(0, 10)),
  salt: fc.uint8Array({ minLength: 16, maxLength: 16 }).map((b) => ethers.hexlify(b)),
}).map((c) => ({ version: 1, registry: ADDR, chainId: 31337, issuer: ISSUER, ...c }));

describe("Fuzz — certificate fingerprint", function () {
  it("key order and surrounding spaces never change the hash (1,000 runs)", function () {
    fc.assert(
      fc.property(certArb, (c) => {
        const shuffled = Object.fromEntries(Object.entries(c).reverse());
        const padded = { ...c, recipient: "  " + c.recipient + " " };
        expect(Cert.hash(shuffled)).to.equal(Cert.hash(c));
        expect(Cert.hash(padded)).to.equal(Cert.hash(c));
        expect(Cert.hash(Cert.parse(JSON.stringify(c, null, 2)))).to.equal(Cert.hash(c));
      }),
      { numRuns: 1000 }
    );
  });

  it("changing any meaningful field changes the hash (1,000 runs)", function () {
    fc.assert(
      fc.property(certArb, fc.constantFrom("id", "recipient", "course", "salt", "issuedOn", "chainId", "registry"), (c, field) => {
        const m = { ...c };
        if (field === "salt") m.salt = "0x" + (BigInt(c.salt) ^ 1n).toString(16).padStart(32, "0");
        else if (field === "issuedOn") m.issuedOn = c.issuedOn === "2000-01-01" ? "2000-01-02" : "2000-01-01";
        else if (field === "chainId") m.chainId = 11155111;
        else if (field === "registry") m.registry = ISSUER;
        else m[field] = c[field] + "x";
        expect(Cert.hash(m)).to.not.equal(Cert.hash(c));
      }),
      { numRuns: 1000 }
    );
  });

  it("random junk JSON is rejected with an error, never hashed (1,000 runs)", function () {
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        let text;
        try {
          text = JSON.stringify(junk);
        } catch {
          return; // BigInt etc. can't be JSON anyway
        }
        if (text === undefined) return;
        expect(() => Cert.parse(text)).to.throw();
      }),
      { numRuns: 1000 }
    );
  });
});

describe("Fuzz — contract matches a simple model", function () {
  this.timeout(300000);

  it("random issue / revoke / role changes by random callers (60 sequences × 25 steps)", async function () {
    const signers = (await ethers.getSigners()).slice(0, 5); // 0 = admin
    const hashes = [ethers.id("a"), ethers.id("b"), ethers.id("c")];
    const op = fc.record({
      kind: fc.constantFrom("issue", "revoke", "grant", "takeRole"),
      who: fc.nat(4),
      target: fc.nat(4),
      h: fc.nat(2),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 25 }), async (ops) => {
        const reg = await ethers.deployContract("CertificateRegistry", [signers[0].address]);
        const ROLE = await reg.ISSUER_ROLE();
        const issuers = new Set();
        const model = new Map(); // `${issuer}:${h}` → "Valid" | "Revoked"

        for (const o of ops) {
          const who = signers[o.who];
          const target = signers[o.target].address;
          const key = `${target}:${o.h}`;
          if (o.kind === "issue") {
            const ok = issuers.has(who.address) && !model.has(`${who.address}:${o.h}`);
            const tx = reg.connect(who).issue(hashes[o.h]);
            if (ok) {
              await tx;
              model.set(`${who.address}:${o.h}`, "Valid");
            } else await expect(tx).to.be.reverted;
          } else if (o.kind === "revoke") {
            const ok = model.get(key) === "Valid" && ((who.address === target && issuers.has(target)) || o.who === 0);
            const tx = reg.connect(who).revoke(target, hashes[o.h], "");
            if (ok) {
              await tx;
              model.set(key, "Revoked");
            } else await expect(tx).to.be.reverted;
          } else {
            const grant = o.kind === "grant";
            const tx = grant ? reg.connect(who).grantRole(ROLE, target) : reg.connect(who).revokeRole(ROLE, target);
            if (o.who === 0) {
              await tx;
              if (grant) issuers.add(target);
              else issuers.delete(target);
            } else await expect(tx).to.be.reverted;
          }
        }
        // compare every (issuer, hash) cell with the model
        for (const s of signers)
          for (let h = 0; h < hashes.length; h++) {
            const v = await reg.verify(s.address, hashes[h]);
            const want = model.get(`${s.address}:${h}`) || "Unknown";
            expect(["Unknown", "Valid", "Revoked"][Number(v.status)]).to.equal(want);
            expect(v.issuerActive).to.equal(issuers.has(s.address));
          }
        const vals = [...model.values()];
        expect(await reg.issuedCount()).to.equal(BigInt(vals.length));
        expect(await reg.revokedCount()).to.equal(BigInt(vals.filter((x) => x === "Revoked").length));
      }),
      { numRuns: 60 }
    );
  });
});
