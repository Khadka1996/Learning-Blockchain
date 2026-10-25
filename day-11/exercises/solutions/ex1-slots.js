"use strict";
/** Exercise 1 — how many 32-byte storage slots does a struct use? */
const SIZE = { bool: 1, uint8: 1, uint16: 2, uint32: 4, uint64: 8, uint128: 16, address: 20, uint256: 32, bytes32: 32 };

function slotsUsed(fields) {
  if (fields.length === 0) return 0;
  let slots = 1;
  let used = 0;
  for (const f of fields) {
    const size = SIZE[f];
    if (!size) throw new Error(`unknown type ${f}`);
    // Solidity starts a new slot when the next field does not fit in what is left
    if (used + size > 32) {
      slots++;
      used = 0;
    }
    used += size;
  }
  return slots;
}

module.exports = { slotsUsed };

if (require.main === module) {
  const naive = ["bool", "uint256", "uint256", "address"];
  const packed = ["address", "uint64", "uint32"];
  console.log("ClubNaive.Member     ", naive.join(", "), "->", slotsUsed(naive), "slots");
  console.log("ClubOptimized.Member ", packed.join(", "), "->", slotsUsed(packed), "slot");
  console.log("order matters: [uint8, uint256, uint8] ->", slotsUsed(["uint8", "uint256", "uint8"]), "slots, [uint8, uint8, uint256] ->", slotsUsed(["uint8", "uint8", "uint256"]), "slots");
}
