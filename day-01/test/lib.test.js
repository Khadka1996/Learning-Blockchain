// Day 01 tests — run with `npm test` (Node's built-in test runner + fast-check).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const fc = require("fast-check");
const lib = require("../src/lib");
const { stats } = require("../src/avalanche");

const SRC = path.join(__dirname, "..", "src");
const run = (script, args = [], timeout = 10000) =>
  spawnSync(process.execPath, [path.join(SRC, script), ...args], { encoding: "utf8", timeout });

// ---------- correctness: official test vectors ----------
test("matches official SHA-256 test vectors (FIPS 180-4 / NIST examples)", () => {
  assert.equal(lib.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(lib.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    lib.sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
});

test("strings are hashed as UTF-8: string and Buffer of the same bytes agree", () => {
  assert.equal(lib.sha256Hex("नमस्ते"), lib.sha256Hex(Buffer.from("नमस्ते", "utf8")));
});

// ---------- properties (fuzzed with fast-check) ----------
test("property: deterministic and always 64 lowercase hex chars", () => {
  fc.assert(
    fc.property(fc.oneof(fc.fullUnicodeString({ maxLength: 500 }), fc.uint8Array({ maxLength: 2000 })), (input) => {
      const h = lib.sha256Hex(input);
      assert.match(h, /^[0-9a-f]{64}$/);
      assert.equal(lib.sha256Hex(input), h);
    }),
    { numRuns: 2000 }
  );
});

test("property: different inputs gave different hashes in every fuzzed pair (no collisions)", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => {
      fc.pre(a !== b);
      assert.notEqual(lib.sha256Hex(a), lib.sha256Hex(b));
    }),
    { numRuns: 2000 }
  );
});

test("property: bitsDifferent is a proper distance (0 for self, symmetric, ≤ 256)", () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.uint8Array({ minLength: 32, maxLength: 32 }), (a, b) => {
      assert.equal(lib.bitsDifferent(a, a), 0);
      const d = lib.bitsDifferent(a, b);
      assert.equal(d, lib.bitsDifferent(b, a));
      assert.ok(d >= 0 && d <= 256);
    })
  );
});

test("bitsDifferent counts every bit, including the top bit of a byte", () => {
  assert.equal(lib.bitsDifferent(Buffer.from([0x00]), Buffer.from([0xff])), 8);
  assert.equal(lib.bitsDifferent(Buffer.from([0x80, 0x01]), Buffer.from([0x00, 0x00])), 2);
});

// ---------- the avalanche effect ----------
test("README example: 10 coins → 11 coins flips 137 of 256 bits", () => {
  const r = lib.avalanche("Manish sends 10 coins", "Manish sends 11 coins");
  assert.equal(r.bits, 137);
  assert.equal(r.percent.toFixed(1), "53.5");
});

test("avalanche: one-character edits flip ~50% of bits on average", () => {
  const s = stats(5000);
  // Expected mean is 128 with std-dev 8 per trial; the mean of 5,000 trials sits within ±1 almost surely.
  assert.ok(s.average > 125 && s.average < 131, `average was ${s.average}`);
  assert.ok(s.min > 0, "a one-character edit must never leave the hash unchanged");
});

// ---------- input validation (QA findings F1–F6) ----------
test("F6: sha256 rejects non-hashable input with a clear TypeError", () => {
  for (const bad of [42, null, undefined, {}, [1, 2], true]) {
    assert.throws(() => lib.sha256Hex(bad), TypeError);
  }
});

test("bitsDifferent rejects mismatched lengths and non-byte inputs", () => {
  assert.throws(() => lib.bitsDifferent(Buffer.alloc(32), Buffer.alloc(31)), RangeError);
  assert.throws(() => lib.bitsDifferent("abc", "abd"), TypeError);
});

test("F1–F3: parseZeros accepts only whole numbers 1..8", () => {
  for (const ok of [1, "4", " 5 ", 8]) assert.ok(lib.parseZeros(ok) >= 1);
  for (const bad of ["abc", "", -1, 0, 2.5, 9, 65, "1e3", "0x3", "5abc", NaN, Infinity]) {
    assert.throws(() => lib.parseZeros(bad), RangeError, `should reject ${bad}`);
  }
});

test("findLeadingZeros finds a real match and is reproducible", () => {
  const r = lib.findLeadingZeros(3);
  assert.equal(r.found, true);
  assert.ok(r.hash.startsWith("000"));
  assert.equal(lib.sha256Hex(r.input), r.hash);
  assert.deepEqual(lib.findLeadingZeros(3), r);
});

test("F3: findLeadingZeros always terminates (maxAttempts cap)", () => {
  const r = lib.findLeadingZeros(8, { maxAttempts: 1000 });
  assert.equal(r.found, false);
  assert.equal(r.attempts, 1000);
  assert.throws(() => lib.findLeadingZeros(2, { maxAttempts: 0 }), RangeError);
});

test("F1/F2/F3: preimage CLI refuses bad input with exit code 1 instead of lying, crashing or hanging", () => {
  for (const bad of ["abc", "-1", "65"]) {
    const r = run("preimage.js", [bad]);
    assert.equal(r.status, 1, `arg ${bad}: ${r.stderr}`);
    assert.match(r.stderr, /zeros must be a whole number/);
  }
});

// ---------- files ----------
test("hashFile equals hashing the bytes in memory, and reports the bytes actually hashed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "day01-"));
  const file = path.join(dir, "data.bin");
  const data = Buffer.alloc(200_000, 7); // bigger than one 64 KiB stream chunk
  fs.writeFileSync(file, data);
  const r = await lib.hashFile(file);
  assert.equal(r.hex, lib.sha256Hex(data));
  assert.equal(r.bytes, data.length);
  fs.rmSync(dir, { recursive: true });
});

test("tamper detection: changing one byte of a file changes its fingerprint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "day01-"));
  const file = path.join(dir, "contract.txt");
  fs.writeFileSync(file, "Pay Manish 10 coins");
  const before = (await lib.hashFile(file)).hex;
  fs.writeFileSync(file, "Pay Manish 90 coins");
  const after = (await lib.hashFile(file)).hex;
  assert.notEqual(before, after);
  const ok = run("file-fingerprint.js", [file, after]);
  const bad = run("file-fingerprint.js", [file, before]);
  assert.equal(ok.status, 0);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /MISMATCH/);
  fs.rmSync(dir, { recursive: true });
});

test("F4: fingerprint CLI exits 1 for a missing file or a directory", () => {
  assert.equal(run("file-fingerprint.js", ["/definitely/not/here"]).status, 1);
  assert.equal(run("file-fingerprint.js", [os.tmpdir()]).status, 1);
  assert.equal(run("file-fingerprint.js", [__filename, "nothex"]).status, 1);
});

test("F8: fingerprint refuses endless devices like /dev/zero instead of hanging", { skip: process.platform === "win32" }, async () => {
  await assert.rejects(lib.hashFile("/dev/zero"), /not a regular file/);
  const r = run("file-fingerprint.js", ["/dev/zero"], 5000);
  assert.equal(r.status, 1);
});

test("F5: requiring a script has no side effects (prints nothing)", () => {
  const r = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(SRC, "hash.js"))})`], {
    encoding: "utf8",
  });
  assert.equal(r.stdout, "");
});

test("known issue F7: visually identical Unicode text can hash differently (normalise first)", () => {
  const composed = "café"; // é as one code point
  const decomposed = "café"; // e + combining accent
  assert.notEqual(lib.sha256Hex(composed), lib.sha256Hex(decomposed));
  assert.equal(lib.sha256Hex(composed.normalize("NFC")), lib.sha256Hex(decomposed.normalize("NFC")));
});
