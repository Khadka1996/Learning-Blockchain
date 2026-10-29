"use strict";
/**
 * npm start — the whole certificate story on a local Hardhat chain:
 * a school issues certificates, an employer verifies one, a forger edits one,
 * the school cancels one. Prints real gas numbers.
 */
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");
const Cert = require("./certificate");
const verifyDocument = require("./verify");

const line = (k, v) => console.log(k.padEnd(34) + v);

async function main() {
  const [admin, school, employer] = await ethers.getSigners();
  const reg = await ethers.deployContract("CertificateRegistry", [admin.address]);
  const deployGas = (await reg.deploymentTransaction().wait()).gasUsed;
  await reg.grantRole(await reg.ISSUER_ROLE(), school.address);
  const { chainId } = await ethers.provider.getNetwork();
  const where = { address: await reg.getAddress(), chainId };

  console.log("\n== 1. The school issues certificates ==");
  const make = (id, recipient) =>
    Cert.create({ registry: where.address, chainId, issuer: school.address, id, recipient, course: "Learning Blockchain in 15 Days", issuedOn: "2026-10-29" });
  const mine = make("LB-2026-001", "Manish Khadka");
  const r1 = await (await reg.connect(school).issue(Cert.hash(mine))).wait();
  const klass = Array.from({ length: 30 }, (_, i) => make(`LB-2026-${String(i + 2).padStart(3, "0")}`, `Student ${i + 2}`));
  const r2 = await (await reg.connect(school).issueBatch(klass.map(Cert.hash))).wait();
  line("certificate file (canonical text):", Cert.canonicalize(mine).slice(0, 70) + "…");
  line("fingerprint stored on-chain:", Cert.hash(mine));
  line("bytes of personal data on-chain:", "0 (only the 32-byte fingerprint)");
  line("gas: deploy registry", deployGas.toLocaleString("en-US"));
  line("gas: issue 1 certificate", r1.gasUsed.toLocaleString("en-US"));
  line("gas: issue a class of 30 (batch)", `${r2.gasUsed.toLocaleString("en-US")} (${(r2.gasUsed / 30n).toLocaleString("en-US")} each)`);
  line("certificates issued:", (await reg.issuedCount()).toString());

  console.log("\n== 2. An employer checks the file Manish sent ==");
  const asEmployer = reg.connect(employer);
  const file = JSON.stringify(mine, null, 2);
  const t = performance.now();
  let res = await verifyDocument(asEmployer, file, where);
  line("verdict:", `${res.verdict} — ${res.reason} (${(performance.now() - t).toFixed(1)} ms, free: no transaction)`);

  console.log("\n== 3. A forger changes ONE letter ==");
  const forged = file.replace("15 Days", "16 Days");
  res = await verifyDocument(asEmployer, forged, where);
  line("verdict:", `${res.verdict} — ${res.reason}`);
  line("fingerprint now:", Cert.hash(JSON.parse(forged)));

  console.log("\n== 4. The school cancels a certificate ==");
  const r3 = await (await reg.connect(school).revoke(school.address, Cert.hash(klass[0]), "issued by mistake")).wait();
  res = await verifyDocument(asEmployer, JSON.stringify(klass[0]), where);
  line("verdict:", `${res.verdict} — ${res.reason}`);
  line("gas: revoke", r3.gasUsed.toLocaleString("en-US"));

  console.log("\n== 5. Someone who is not an issuer tries to issue ==");
  try {
    await reg.connect(employer).issue(ethers.id("fake"));
  } catch (e) {
    const err = e.data ? reg.interface.parseError(e.data) : null;
    line("result:", "rejected — " + (err ? err.name : e.shortMessage || e.message));
  }

  const out = path.join(__dirname, "..", "examples");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "certificate-LB-2026-001.json"), file + "\n");
  console.log(`\nSaved an example certificate file to examples/certificate-LB-2026-001.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
