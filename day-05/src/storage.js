"use strict";
/**
 * Storage-layout helpers: where does Solidity put a variable?
 * Rules from the Solidity docs, "Layout of State Variables in Storage".
 */
const { AbiCoder, keccak256, toBeHex, zeroPadValue, getBigInt } = require("ethers");

const coder = AbiCoder.defaultAbiCoder();

/** Slot of mapping[key] when the mapping is declared at `slot`: keccak256(abi.encode(key, slot)). */
function mappingSlot(keyType, key, slot) {
  return BigInt(keccak256(coder.encode([keyType, "uint256"], [key, slot])));
}

/** Slot of dynamic array element i when the array is declared at `slot`: keccak256(slot) + i. */
function arraySlot(slot, index) {
  const start = BigInt(keccak256(zeroPadValue(toBeHex(slot), 32)));
  return (start + BigInt(index)) % (1n << 256n);
}

/** Read `size` bytes starting `offset` bytes from the RIGHT (low end) of a 32-byte word. */
function unpack(word, offset, size) {
  if (offset < 0 || size < 1 || offset + size > 32) throw new RangeError("field must fit inside one 32-byte slot");
  return (getBigInt(word) >> BigInt(8 * offset)) & ((1n << BigInt(8 * size)) - 1n);
}

module.exports = { mappingSlot, arraySlot, unpack };
