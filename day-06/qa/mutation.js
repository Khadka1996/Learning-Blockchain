// Mutation testing: break LearningVault on purpose, one small change at a time, and run the
// whole test suite. A good suite FAILS for every mutant ("killed"). A mutant that survives means
// a behaviour nobody tests. The original file is always restored, even on Ctrl-C.
//
//   npm run qa:mutation
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FILE = path.join(__dirname, "..", "contracts", "LearningVault.sol");
const original = fs.readFileSync(FILE, "utf8");

const MUTANTS = [
  ["constructor no longer emits OwnershipTransferred", "        emit OwnershipTransferred(address(0), msg.sender);\n", ""],
  ["deposit accepts 0 wei", "        if (msg.value == 0) revert ZeroAmount();\n", ""],
  ["deposit ignores the pause", "function deposit() external payable override whenNotPaused {", "function deposit() external payable override {"],
  ["withdraw is blocked while paused (the original M1 bug)", "function withdraw(uint256 amount) external override nonReentrant {", "function withdraw(uint256 amount) external override whenNotPaused nonReentrant {"],
  ["withdraw rejects amount == balance (off by one)", "if (amount > available) revert", "if (amount >= available) revert"],
  ["withdraw never lowers the user's balance", "        balances[msg.sender] = remaining;\n", ""],
  ["withdraw never lowers totalDeposits", "        totalDeposits -= amount;\n", ""],
  ["deposit never raises totalDeposits", "        totalDeposits += msg.value;\n", ""],
  ["failed payout is ignored", "        if (!success) revert TransferFailed();\n", ""],
  ["reentrancy guard removed", "function withdraw(uint256 amount) external override nonReentrant {", "function withdraw(uint256 amount) external override {"],
  ["reentrancy guard never released", "        _;\n        _status = _NOT_ENTERED;\n", "        _;\n"],
  ["setPaused open to everyone", "function setPaused(bool isPaused) external onlyOwner {", "function setPaused(bool isPaused) external {"],
  ["setPaused emits even when nothing changed", "        if (paused == isPaused) return;\n", ""],
  ["solvencyCheck uses == instead of >=", "return address(this).balance >= totalDeposits;", "return address(this).balance == totalDeposits;"],
  ["Withdrawn event reports the withdrawn amount as the new balance", "emit Withdrawn(msg.sender, amount, remaining);", "emit Withdrawn(msg.sender, amount, amount);"],
  ["interaction before effects (guard kept)", null, null], // built below: moves the ETH send above the state update
];

function buildInteractionBeforeEffects(src) {
  const effects = "        uint256 remaining = available - amount;\n        balances[msg.sender] = remaining;\n        totalDeposits -= amount;\n        emit Withdrawn(msg.sender, amount, remaining);\n";
  const call = '        (bool success, ) = payable(msg.sender).call{value: amount}("");\n        if (!success) revert TransferFailed();\n';
  if (!src.includes(effects) || !src.includes(call)) throw new Error("pattern for reorder mutant not found");
  return src.replace(effects, "        uint256 remaining = available - amount;\n").replace(call, call + effects.replace("        uint256 remaining = available - amount;\n", ""));
}

function runTests() {
  const result = spawnSync("npx", ["hardhat", "test"], { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 300_000 });
  const out = (result.stdout || "") + (result.stderr || "");
  const failing = /(\d+) failing/.exec(out);
  const compileError = /(HardhatError|Compilation failed|DeclarationError|TypeError)/.test(out) && !/passing/.test(out);
  return { failing: failing ? Number(failing[1]) : 0, passing: /(\d+) passing/.test(out), compileError };
}

function restore() {
  fs.writeFileSync(FILE, original);
}
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

let killed = 0;
const survivors = [];
const rows = [];
try {
  const baseline = runTests();
  if (baseline.failing || !baseline.passing) throw new Error("baseline suite is not green; fix that first");
  console.log("baseline: all tests pass\n");

  for (const [name, from, to] of MUTANTS) {
    let mutated;
    if (from === null) mutated = buildInteractionBeforeEffects(original);
    else {
      if (!original.includes(from)) throw new Error(`pattern not found for mutant "${name}"`);
      mutated = original.replace(from, to);
    }
    fs.writeFileSync(FILE, mutated);
    const { failing, compileError } = runTests();
    const status = compileError ? "invalid (did not compile)" : failing > 0 ? `KILLED  (${failing} test${failing === 1 ? "" : "s"} failed)` : "SURVIVED";
    if (compileError) {
      rows.push([name, status]);
      continue;
    }
    if (failing > 0) killed += 1;
    else survivors.push(name);
    rows.push([name, status]);
    console.log(`${status.padEnd(26)} ${name}`);
  }
} finally {
  restore();
}

const valid = rows.filter(([, s]) => !s.startsWith("invalid")).length;
console.log(`\n${killed} of ${valid} mutants killed.`);
if (survivors.length) {
  console.log("SURVIVORS (untested behaviour):\n  - " + survivors.join("\n  - "));
  process.exitCode = 1;
}
