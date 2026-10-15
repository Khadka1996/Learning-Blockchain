// Exercise 1 (easy) — find records whose text no longer matches the hash published for it.
"use strict";

const { sha256Hex } = require("../../src/lib");

/** Return the ids of records whose current text does not hash to `publishedHash`. */
function findTampered(records) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  return records
    .filter((r) => sha256Hex(r.text) !== String(r.publishedHash).toLowerCase())
    .map((r) => r.id);
}

function demo() {
  const original = ["Pay Sita 5 coins", "Pay Ram 12 coins", "Pay Hari 7 coins"];
  const records = original.map((text, i) => ({ id: i + 1, text, publishedHash: sha256Hex(text) }));
  records[1].text = "Pay Ram 72 coins"; // someone quietly edits record 2
  console.log("Records:");
  for (const r of records) console.log(`  #${r.id} ${JSON.stringify(r.text).padEnd(20)} published ${r.publishedHash.slice(0, 12)}…`);
  console.log(`\nTampered ids: ${JSON.stringify(findTampered(records))}`);
}

if (require.main === module) demo();

module.exports = { findTampered };
