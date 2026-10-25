"use strict";
/** Exercise 3 — is a new storage layout safe to upgrade to? */

function checkUpgrade(oldLayout, newLayout) {
  const problems = [];
  oldLayout.forEach((o, i) => {
    const n = newLayout[i];
    if (!n) return problems.push(`slot ${i}: "${o.name}" was removed`);
    if (n.name !== o.name) problems.push(`slot ${i}: "${o.name}" is now "${n.name}" (renamed, moved or reordered)`);
    else if (n.type !== o.type) problems.push(`slot ${i}: "${o.name}" changed type ${o.type} -> ${n.type}`);
  });
  return { safe: problems.length === 0, problems };
}

const V1 = [
  { name: "balanceOf", type: "mapping(address=>uint256)" },
  { name: "totalDeposits", type: "uint256" },
];
const V2 = [...V1, { name: "maxPerUser", type: "uint256" }, { name: "paused", type: "bool" }];
const V2_BROKEN = [
  { name: "totalDeposits", type: "uint256" },
  { name: "balanceOf", type: "mapping(address=>uint256)" },
];

module.exports = { checkUpgrade, V1, V2, V2_BROKEN };

if (require.main === module) {
  console.log("V1 -> V2        :", JSON.stringify(checkUpgrade(V1, V2)));
  console.log("V1 -> V2_BROKEN :", JSON.stringify(checkUpgrade(V1, V2_BROKEN), null, 1));
}
