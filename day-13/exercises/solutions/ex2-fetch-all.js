"use strict";
// Exercise 2 (medium): read EVERY tip using only getTips(offset, limit) (max 50 per call).
async function fetchAllTips(jar, pageSize = 50) {
  const total = Number(await jar.tipCount());
  const all = [];
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await jar.getTips(offset, pageSize);
    if (page.length === 0) break; // safety: never loop forever
    all.push(...page);
  }
  return all; // newest first
}
const pagesNeeded = (total, pageSize) => Math.ceil(total / Math.min(pageSize, 50));
module.exports = { fetchAllTips, pagesNeeded };
if (require.main === module) {
  const hre = require("hardhat");
  (async () => {
    const jar = await (await hre.ethers.getContractFactory("TipJar")).deploy();
    const [, a] = await hre.ethers.getSigners();
    for (let i = 0; i < 120; i++) await jar.connect(a).tip(`tip ${i}`, { value: 10n ** 14n });
    const all = await fetchAllTips(jar);
    console.log(`read ${all.length} tips in ${pagesNeeded(120, 50)} calls; newest "${all[0].message}", oldest "${all[119].message}"`);
  })();
}
