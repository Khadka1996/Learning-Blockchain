// Exercise 2 (medium) — double SHA-256 and the Bitcoin genesis block id.
"use strict";

const { sha256Bytes } = require("../../src/lib");

// Block 0 header, 80 bytes: version | previous hash | Merkle root | time | bits | nonce
const GENESIS_HEADER_HEX =
  "01000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a" +
  "29ab5f49" + // time  0x495fab29 = 2009-01-03 18:15:05 UTC
  "ffff001d" + // bits  difficulty target
  "1dac2b7c"; //  nonce 2,083,236,893

/** Bitcoin's hash256: SHA-256 applied twice. */
function hash256(bytes) {
  return sha256Bytes(sha256Bytes(bytes));
}

/** Block id as Bitcoin displays it: hash256 of the header, byte-reversed, hex. */
function blockId(headerHex) {
  if (typeof headerHex !== "string" || !/^[0-9a-fA-F]{160}$/.test(headerHex)) {
    throw new RangeError("a block header is exactly 80 bytes (160 hex characters)");
  }
  return Buffer.from(hash256(Buffer.from(headerHex, "hex"))).reverse().toString("hex");
}

const leadingZeros = (hex) => hex.length - hex.replace(/^0+/, "").length;

function demo() {
  const header = Buffer.from(GENESIS_HEADER_HEX, "hex");
  const id = blockId(GENESIS_HEADER_HEX);
  console.log(`Header bytes   : ${header.length}`);
  console.log(`Timestamp      : ${new Date(header.readUInt32LE(68) * 1000).toISOString()}`);
  console.log(`Nonce          : ${header.readUInt32LE(76).toLocaleString("en-US")}`);
  console.log(`Genesis id     : ${id}`);
  console.log(`Leading zeros  : ${leadingZeros(id)} hex digits`);
}

if (require.main === module) demo();

module.exports = { GENESIS_HEADER_HEX, hash256, blockId, leadingZeros };
