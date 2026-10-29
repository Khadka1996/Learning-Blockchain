"use strict";
// Exercise 3 — verify a whole folder of certificate files and flag duplicate ids.
const Cert = require("../../src/certificate");
const verifyDocument = require("../../src/verify");

async function checkMany(registry, files, where) {
  const counts = {};
  const seen = new Map(); // issuer|id -> Set of fingerprints
  for (const text of files) {
    const r = await verifyDocument(registry, text, where);
    counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    if (r.verdict === "BAD_FILE") continue;
    const cert = r.cert || Cert.parse(text);
    const key = `${cert.issuer}|${cert.id}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(Cert.hash(cert));
  }
  const duplicateIds = [...seen].filter(([, hashes]) => hashes.size > 1).map(([key]) => key);
  return { counts, duplicateIds };
}

module.exports = { checkMany };

if (require.main === module) {
  const hre = require("hardhat");
  (async () => {
    const [admin] = await hre.ethers.getSigners();
    const reg = await hre.ethers.deployContract("CertificateRegistry", [admin.address]);
    await reg.grantRole(await reg.ISSUER_ROLE(), admin.address);
    const { chainId } = await hre.ethers.provider.getNetwork();
    const where = { address: await reg.getAddress(), chainId };
    const mk = (id, name) => Cert.create({ registry: where.address, chainId, issuer: admin.address, id, recipient: name, course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29" });
    const certs = [mk("LB-1", "Asha"), mk("LB-2", "Bikash"), mk("LB-2", "Chandra")]; // LB-2 used twice
    for (const c of certs) await reg.issue(Cert.hash(c));
    const files = [...certs.map((c) => JSON.stringify(c)), "not json"];
    console.log(await checkMany(reg, files, where));
  })();
}
