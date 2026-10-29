"use strict";
/**
 * npm run build:web — copy the shared certificate code into the frontend.
 * src/ is the ONE source of truth; frontend/lib/ is a copy so the page works on any
 * static host. test/04-e2e checks the copies are identical.
 */
const fs = require("node:fs");
const path = require("node:path");

const FILES = ["certificate.js", "verify.js"];
const SRC = path.join(__dirname, "..", "src");
const DEST = path.join(__dirname, "..", "frontend", "lib");

function copyLib() {
  fs.mkdirSync(DEST, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}

if (require.main === module) {
  copyLib();
  console.log("copied " + FILES.join(", ") + " → frontend/lib/");
}

module.exports = { copyLib, FILES, SRC, DEST };
