// Day 01 — evening audit regression tests (findings E1–E5 in QA.md).
// Each test was written to FAIL against the morning code, then the code was fixed.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const fc = require("fast-check");
const lib = require("../src/lib");

const SRC = path.join(__dirname, "..", "src");
const run = (script, args = [], timeout = 10000) =>
  spawnSync(process.execPath, [path.join(SRC, script), ...args], { encoding: "utf8", timeout });

// E1 — different JS strings collided: lone UTF-16 surrogates are silently replaced by U+FFFD
// when encoded as UTF-8, so "\uD800", "\uDC00" and "�" all had the SAME hash.
test("E1: malformed strings (lone surrogates) are rejected instead of silently colliding", () => {
  for (const bad of ["\uD800", "\uDC00", "abc\uD83D", "\uDE00xyz"]) {
    assert.throws(() => lib.sha256Hex(bad), /well-formed/, JSON.stringify(bad));
  }
  // the legitimate replacement character and real emoji (valid surrogate PAIRS) still hash fine
  assert.match(lib.sha256Hex("�"), /^[0-9a-f]{64}$/);
  assert.match(lib.sha256Hex("😀 😀"), /^[0-9a-f]{64}$/);
});

test("E1 property: any two DIFFERENT strings that are accepted never share a hash", () => {
  // Mix lone surrogates, the replacement character and plain text, plus fully random UTF-16 units.
  const unit = fc.constantFrom("\uD800", "\uDBFF", "\uDC00", "\uDFFF", "\uFFFD", "a", "\uD83D\uDE00");
  const str = fc.oneof(fc.array(unit, { maxLength: 4 }).map((u) => u.join("")), fc.string16bits({ maxLength: 4 }));
  fc.assert(
    fc.property(str, str, (a, b) => {
      fc.pre(a !== b);
      let ha;
      let hb;
      try {
        ha = lib.sha256Hex(a);
        hb = lib.sha256Hex(b);
      } catch {
        return; // rejected input is fine; silent collision is not
      }
      assert.notEqual(ha, hb);
    }),
    { numRuns: 5000 }
  );
});

// E2 — time-of-check / time-of-use: hashFile() checked the PATH with stat(), then opened the PATH
// again to stream it. If the path is swapped for a pipe in between, the program hangs (F8 again).
test("E2: hashFile checks the file it actually opened (no stat→open race)", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "day01-e2-"));
  const fifo = path.join(dir, "pipe");
  execFileSync("mkfifo", [fifo]);
  // Simulate the attacker winning the race: stat(path) says "regular file", but the path is a pipe.
  const script = `
    const fs = require("fs");
    const real = fs.promises.stat;
    fs.promises.stat = async () => real(${JSON.stringify(__filename)});
    const lib = require(${JSON.stringify(path.join(SRC, "lib.js"))});
    lib.hashFile(${JSON.stringify(fifo)}).then(
      () => { console.log("HASHED"); process.exit(0); },
      (e) => { console.log("REJECTED:", e.message); process.exit(2); }
    );`;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 4000 });
  fs.rmSync(dir, { recursive: true });
  assert.notEqual(r.signal, "SIGTERM", "hashFile hung on a pipe (race not closed)");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /not a regular file/);
});

// E3 — `node src/hash.js ""` silently hashed "Hello, Blockchain!" instead of the empty string.
test("E3: hash CLI hashes an explicit empty string instead of swapping in the demo text", () => {
  const r = run("hash.js", [""]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/);
  // with no argument at all, the demo text is still used
  assert.match(run("hash.js").stdout, /Hello, Blockchain!/);
});

// E4 — loose number parsing: `--stats 0x10` ran 16 trials, `--stats 1e2` ran 100, and
// parseZeros([5]) accepted an array. Same class of bug as morning finding F9.
test("E4: avalanche --stats accepts only plain decimal whole numbers", () => {
  for (const bad of ["0x10", "1e2", "1.5", "-3", "abc", " "]) {
    const r = run("avalanche.js", ["--stats", bad]);
    assert.equal(r.status, 1, `--stats ${JSON.stringify(bad)} should fail: ${r.stdout}`);
    assert.match(r.stderr, /trials must be a whole number/);
  }
  assert.equal(run("avalanche.js", ["--stats", "20"]).status, 0);
});

test("E4: parseZeros rejects non-number, non-string types", () => {
  for (const bad of [[5], { valueOf: () => 5 }, true, null, undefined, 5n]) {
    assert.throws(() => lib.parseZeros(bad), RangeError);
  }
});

// E5 — findLeadingZeros() accepted any prefix type; objects became "[object Object]".
test("E5: findLeadingZeros requires a string prefix", () => {
  for (const bad of [{}, 42, null, ["a"]]) {
    assert.throws(() => lib.findLeadingZeros(1, { prefix: bad }), TypeError);
  }
  assert.equal(lib.findLeadingZeros(1, { prefix: "" }).found, true);
});

// Evening improvement — the README difficulty table is now generated by code, not typed by hand.
test("difficultyTable reproduces the README numbers and validates its input", () => {
  const { difficultyTable } = require("../src/preimage");
  const rows = difficultyTable(3);
  assert.deepEqual(
    rows.map((r) => [r.zeros, r.attempts, r.expected]),
    [
      [1, 23, 16],
      [2, 193, 256],
      [3, 13699, 4096],
    ]
  );
  assert.throws(() => difficultyTable("abc"), RangeError);
  const r = run("preimage.js", ["--table", "2"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\|\s+193 \|\s+256 \|/);
});
