// Mutation testing (Day 06 introduced it): break MiniToken and TokenVault on purpose, one small
// change at a time, and run the whole test suite. A good suite FAILS for every mutant ("killed").
// A mutant that survives is behaviour nobody tests. Original files are always restored.
//
//   npm run qa:mutation
//   ONLY='guard|permit' npm run qa:mutation     (re-run just the mutants whose name matches)
//
// The two random tests run with FUZZ_RUNS=15 here (full 150/200 runs in `npm test`) so each of the
// ~35 test passes takes about 10 seconds instead of 50.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MINI = "contracts/MiniToken.sol";
const VAULT = "contracts/TokenVault.sol";

const MUTANTS = [
  // ---- MiniToken ------------------------------------------------------------------------------
  [MINI, "constructor does not mint the initial supply", "        _update(address(0), msg.sender, initialSupply); // mint\n", ""],
  [MINI, "transfer to the zero address is allowed", "        if (to == address(0)) revert ERC20InvalidReceiver(address(0));\n", ""],
  [MINI, "balance check off by one (< becomes <=)", "if (fromBalance < value) revert", "if (fromBalance <= value) revert"],
  [MINI, "sender is never debited", "                balanceOf[from] = fromBalance - value; // cannot underflow: checked just above\n", ""],
  [MINI, "receiver is never credited", "                balanceOf[to] += value; // cannot overflow: the sum of all balances is totalSupply\n", ""],
  [MINI, "mint does not raise totalSupply", "            totalSupply += value;\n", ""],
  [MINI, "burn does not lower totalSupply", "                totalSupply -= value; // cannot underflow: value <= a balance <= totalSupply\n", ""],
  [MINI, "Transfer event is never emitted", "        emit Transfer(from, to, value);\n", ""],
  [MINI, "Approval event is never emitted", "        if (emitEvent) emit Approval(owner, spender, value);\n", ""],
  [MINI, "approve to the zero address is allowed", "        if (spender == address(0)) revert ERC20InvalidSpender(address(0));\n", ""],
  [MINI, "transferFrom skips the allowance entirely", "        _spendAllowance(from, msg.sender, value);\n        _transfer(from, to, value);", "        _transfer(from, to, value);"],
  [MINI, "allowance check off by one (< becomes <=)", "if (current < value) revert ERC20InsufficientAllowance", "if (current <= value) revert ERC20InsufficientAllowance"],
  [MINI, "spending an allowance does not reduce it", "                _approve(owner, spender, current - value, false); // no event: Approval is for explicit approvals\n", ""],
  [MINI, "unlimited allowance is reduced like any other", "if (current != type(uint256).max) {", "if (true) {"],
  [MINI, "spending an allowance emits Approval", "_approve(owner, spender, current - value, false);", "_approve(owner, spender, current - value, true);"],
  [MINI, "decimals is 6 instead of 18", "uint8 public constant decimals = 18;", "uint8 public constant decimals = 6;"],
  [MINI, "anyone can burn someone else's tokens", "_update(msg.sender, address(0), value);", "_update(address(0x1), address(0), value);"],
  // ---- TokenVault -----------------------------------------------------------------------------
  [VAULT, "deposit accepts 0", "    function _deposit(IERC20 token, uint256 amount) private returns (uint256 received) {\n        if (amount == 0) revert ZeroAmount();\n", "    function _deposit(IERC20 token, uint256 amount) private returns (uint256 received) {\n"],
  [VAULT, "credits the requested amount, not what arrived", "balances[token][msg.sender] += received;", "balances[token][msg.sender] += amount;"],
  [VAULT, "total is raised by the requested amount, not what arrived", "totalDeposits[token] += received;", "totalDeposits[token] += amount;"],
  [VAULT, "a deposit that delivers nothing is accepted", "        if (received == 0) revert NothingReceived();\n", ""],
  [VAULT, "Deposited event reports the requested amount as received", "emit Deposited(token, msg.sender, amount, received);", "emit Deposited(token, msg.sender, amount, amount);"],
  [VAULT, "deposit ignores token return values (plain transferFrom)", "token.safeTransferFrom(msg.sender, address(this), amount);", "token.transferFrom(msg.sender, address(this), amount);"],
  [VAULT, "withdraw ignores token return values (plain transfer)", "token.safeTransfer(msg.sender, amount);", "token.transfer(msg.sender, amount);"],
  [VAULT, "withdraw rejects amount == balance (off by one)", "if (amount > available) revert", "if (amount >= available) revert"],
  [VAULT, "withdraw accepts 0", "        if (amount == 0) revert ZeroAmount();\n        uint256 available", "        uint256 available"],
  [VAULT, "withdraw never lowers the user's balance", "        balances[token][msg.sender] = available - amount;\n", ""],
  [VAULT, "withdraw never lowers totalDeposits", "        totalDeposits[token] -= amount;\n", ""],
  [VAULT, "withdraw has no reentrancy guard", "function withdraw(IERC20 token, uint256 amount) external nonReentrant {", "function withdraw(IERC20 token, uint256 amount) external {"],
  [VAULT, "deposit has no reentrancy guard", "function deposit(IERC20 token, uint256 amount) external nonReentrant returns (uint256 received) {", "function deposit(IERC20 token, uint256 amount) external returns (uint256 received) {"],
  [VAULT, "depositWithPermit has no reentrancy guard", "    ) external nonReentrant returns (uint256 received) {", "    ) external returns (uint256 received) {"],
  [VAULT, "interaction before effects (guard kept)", null, null],
  [VAULT, "permit failure is not tolerated (front-run grief)", "try IERC20Permit(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}", "IERC20Permit(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s);"],
  [VAULT, "solvencyCheck uses > instead of >=", "return token.balanceOf(address(this)) >= totalDeposits[token];", "return token.balanceOf(address(this)) > totalDeposits[token];"],
];

function reorder(src) {
  const effects = "        balances[token][msg.sender] = available - amount;\n        totalDeposits[token] -= amount;\n        emit Withdrawn(token, msg.sender, amount);\n";
  const call = "        token.safeTransfer(msg.sender, amount);\n";
  if (!src.includes(effects) || !src.includes(call)) throw new Error("pattern for the reorder mutant not found");
  return src.replace(effects, "").replace(call, call + effects);
}

function runTests() {
  const result = spawnSync("npx", ["hardhat", "test"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 400_000,
    env: { ...process.env, FUZZ_RUNS: process.env.FUZZ_RUNS ?? "15" },
  });
  const out = (result.stdout || "") + (result.stderr || "");
  const failing = /(\d+) failing/.exec(out);
  const compileError = /(Compilation failed|DeclarationError|TypeError|ParserError)/.test(out) && !/passing/.test(out);
  return { failing: failing ? Number(failing[1]) : 0, passing: /(\d+) passing/.test(out), compileError };
}

const originals = new Map();
for (const f of [MINI, VAULT]) originals.set(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
const restore = () => {
  for (const [f, text] of originals) fs.writeFileSync(path.join(ROOT, f), text);
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

let killed = 0;
let invalid = 0;
const survivors = [];
try {
  const baseline = runTests();
  if (baseline.failing || !baseline.passing) throw new Error("baseline suite is not green; fix that first");
  console.log("baseline: all tests pass\n");

  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  for (const [file, name, from, to] of MUTANTS) {
    if (only && !only.test(name)) continue;
    const original = originals.get(file);
    let mutated;
    if (from === null) mutated = reorder(original);
    else {
      if (!original.includes(from)) throw new Error(`pattern not found for mutant "${name}"`);
      mutated = original.replace(from, to);
    }
    fs.writeFileSync(path.join(ROOT, file), mutated);
    const { failing, compileError } = runTests();
    restore();
    const label = path.basename(file, ".sol").padEnd(10);
    if (compileError) {
      invalid += 1;
      console.log(`INVALID (did not compile)   ${label} ${name}`);
    } else if (failing > 0) {
      killed += 1;
      console.log(`KILLED  (${String(failing).padStart(2)} failed)        ${label} ${name}`);
    } else {
      survivors.push(`${label} ${name}`);
      console.log(`SURVIVED                    ${label} ${name}`);
    }
  }
} finally {
  restore();
}

const considered = process.env.ONLY ? MUTANTS.filter((m) => new RegExp(process.env.ONLY, "i").test(m[1])).length : MUTANTS.length;
const valid = considered - invalid;
console.log(`\n${killed} of ${valid} mutants killed.`);
if (survivors.length) {
  console.log("SURVIVORS (untested behaviour, or equivalent mutants):\n  - " + survivors.join("\n  - "));
  process.exitCode = 1;
}
