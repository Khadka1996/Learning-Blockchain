// Mutation testing (Day 06 introduced it): break MiniNFT, LearningNFT and GameItems on purpose,
// one small change at a time, and run the whole test suite. A good suite FAILS for every mutant
// ("killed"). A mutant that survives is behaviour nobody tests. Original files are always restored.
//
//   npm run qa:mutation
//   ONLY='approval|limit' npm run qa:mutation     (re-run just the mutants whose name matches)
//
// The differential test runs with FUZZ_RUNS=15 here (120 runs in `npm test`) to keep each pass short.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MINI = "contracts/MiniNFT.sol";
const NFT = "contracts/LearningNFT.sol";
const ITEMS = "contracts/GameItems.sol";

const MUTANTS = [
  // ---- MiniNFT ---------------------------------------------------------------------------------
  [MINI, "ERC-721 interface id not advertised", "            || interfaceId == 0x80ac58cd // ERC-721\n", ""],
  [MINI, "balanceOf(0x0) does not revert", "        if (owner == address(0)) revert ERC721InvalidOwner(address(0));\n", ""],
  [MINI, "ownerOf returns 0x0 for missing tokens", "        if (owner == address(0)) revert ERC721NonexistentToken(tokenId);\n", ""],
  [MINI, "anyone can approve", "        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) {\n            revert ERC721InvalidApprover(msg.sender);\n        }\n", ""],
  [MINI, "operator 0x0 allowed", "        if (operator == address(0)) revert ERC721InvalidOperator(operator);\n", ""],
  [MINI, "transfer to 0x0 allowed", "        if (to == address(0)) revert ERC721InvalidReceiver(address(0));\n        address owner = ownerOf(tokenId);\n        // Permission", "        address owner = ownerOf(tokenId);\n        // Permission"],
  [MINI, "transferFrom skips the approval check", "_tokenApprovals[tokenId] != msg.sender && !isApprovedForAll(owner, msg.sender)) {\n            revert ERC721InsufficientApproval(msg.sender, tokenId);\n        }\n        if (owner != from)", "false) {\n            revert ERC721InsufficientApproval(msg.sender, tokenId);\n        }\n        if (owner != from)"],
  [MINI, "transferFrom ignores operators", "if (msg.sender != owner && _tokenApprovals[tokenId] != msg.sender && !isApprovedForAll(owner, msg.sender)) {\n            revert ERC721InsufficientApproval(msg.sender, tokenId);\n        }\n        if (owner != from)", "if (msg.sender != owner && _tokenApprovals[tokenId] != msg.sender) {\n            revert ERC721InsufficientApproval(msg.sender, tokenId);\n        }\n        if (owner != from)"],
  [MINI, "wrong `from` accepted", "        if (owner != from) revert ERC721IncorrectOwner(from, tokenId, owner);\n", ""],
  [MINI, "approval survives a transfer", "        delete _tokenApprovals[tokenId]; // the old one-token approval must not survive the sale\n", ""],
  [MINI, "sender balance not lowered", "            _balances[from] -= 1; // cannot underflow: `from` owns this token\n", ""],
  [MINI, "receiver balance not raised", "            _balances[to] += 1; // cannot overflow: there are fewer than 2^256 tokens\n", ""],
  [MINI, "Transfer event missing on transfer", "        _owners[tokenId] = to;\n        emit Transfer(from, to, tokenId);\n", "        _owners[tokenId] = to;\n"],
  [MINI, "safeTransferFrom skips the receiver check", "        _checkOnERC721Received(from, to, tokenId, data);\n", ""],
  [MINI, "receiver's wrong answer accepted", "            if (retval != IERC721Receiver.onERC721Received.selector) revert ERC721InvalidReceiver(to);\n", ""],
  [MINI, "receiver's own error swallowed", "            assembly (\"memory-safe\") {\n                revert(add(32, reason), mload(reason)) // bubble up the receiver's own error\n            }", "            revert ERC721InvalidReceiver(to);"],
  [MINI, "the same id can be minted twice", "        if (_owners[tokenId] != address(0)) revert ERC721InvalidSender(address(0)); // already minted\n", ""],
  [MINI, "anyone can mint", "        if (msg.sender != minter) revert NotMinter(msg.sender);\n", ""],
  [MINI, "anyone can burn", "        if (msg.sender != owner && _tokenApprovals[tokenId] != msg.sender && !isApprovedForAll(owner, msg.sender)) {\n            revert ERC721InsufficientApproval(msg.sender, tokenId);\n        }\n        delete _tokenApprovals[tokenId];\n        unchecked {\n            _balances[owner] -= 1;", "        delete _tokenApprovals[tokenId];\n        unchecked {\n            _balances[owner] -= 1;"],
  [MINI, "burn keeps the owner", "        delete _owners[tokenId];\n", ""],
  [MINI, "tokenURI off by one digit", "buffer[digits] = bytes1(uint8(48 + (value % 10)));", "buffer[digits] = bytes1(uint8(49 + (value % 10)));"],
  // ---- LearningNFT -----------------------------------------------------------------------------
  [NFT, "quantity 0 allowed", "if (quantity == 0 || quantity > MAX_PER_WALLET) revert InvalidQuantity(quantity);", "if (quantity > MAX_PER_WALLET) revert InvalidQuantity(quantity);"],
  [NFT, "sold-out check off by one", "        if (quantity > remaining) revert SoldOut(quantity, remaining);\n        uint256 already", "        if (quantity >= remaining) revert SoldOut(quantity, remaining);\n        uint256 already"],
  [NFT, "wallet limit not enforced", "        if (already + quantity > MAX_PER_WALLET) revert WalletLimit(msg.sender, already, quantity);\n", ""],
  [NFT, "overpayment accepted", "if (msg.value != cost) revert", "if (msg.value < cost) revert"],
  [NFT, "limit recorded AFTER minting (re-entrancy bug)", null, null],
  [NFT, "ownerMint ignores the supply cap", "        if (quantity == 0) revert InvalidQuantity(quantity);\n        uint256 remaining = MAX_SUPPLY - totalMinted;\n        if (quantity > remaining) revert SoldOut(quantity, remaining);\n", "        if (quantity == 0) revert InvalidQuantity(quantity);\n"],
  [NFT, "withdraw failure ignored", "        if (!ok) revert WithdrawFailed();\n", ""],
  [NFT, "tokenURI without .json", "return string.concat(_base, tokenId.toString(), \".json\");", "return string.concat(_base, tokenId.toString());"],
  [NFT, "renounce allowed with funds inside (E1)", "        if (held != 0) revert FundsStillHeld(held);\n", ""],
  [NFT, "setBaseURI ignores the freeze", "        if (metadataFrozen) revert MetadataIsFrozen();\n        _base = newBase;", "        _base = newBase;"],
  [NFT, "freezeMetadata does not freeze", "        metadataFrozen = true;\n", ""],
  [NFT, "no EIP-4906 refresh signal", "        emit BatchMetadataUpdate(1, type(uint256).max);\n", ""],
  [NFT, "ERC-2981 not advertised", "return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);", "return interfaceId == bytes4(0x49064906) || (interfaceId != 0x2a55205a && super.supportsInterface(interfaceId));"],
  // ---- GameItems -------------------------------------------------------------------------------
  [ITEMS, "cap check off by one", "if (amount > remaining) revert ExceedsMaxSupply", "if (amount >= remaining) revert ExceedsMaxSupply"],
  [ITEMS, "undefined ids can be minted", "        if (cap == 0) revert UnknownItem(id);\n", ""],
  [ITEMS, "batch ignores repeats of the same id", "_checkCap(ids[i], already + amounts[i]);", "_checkCap(ids[i], amounts[i]);"],
  [ITEMS, "crown supply is 2", "maxSupply[CROWN] = 1;", "maxSupply[CROWN] = 2;"],
];

function reorder(src) {
  const effects = "        uint256 firstId = totalMinted + 1;\n        totalMinted += quantity;\n        mintedBy[msg.sender] = already + quantity;\n";
  const loop = "        for (uint256 i = 0; i < quantity; i++) {\n            _safeMint(msg.sender, firstId + i);\n        }\n";
  if (!src.includes(effects) || !src.includes(loop)) throw new Error("pattern for the reorder mutant not found");
  const late = "        for (uint256 i = 0; i < quantity; i++) {\n            totalMinted += 1;\n            _safeMint(msg.sender, totalMinted);\n        }\n        mintedBy[msg.sender] = already + quantity;\n";
  return src.replace(effects, "").replace(loop, late);
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
for (const f of [MINI, NFT, ITEMS]) originals.set(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
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
    const label = path.basename(file, ".sol").padEnd(12);
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
