// Day 02 — what happens when someone edits an old block? Watch the chain break, then count
// how much work it takes to "repair" the lie by re-mining every later block.
// Usage: node src/tamper.js [difficultyBits=16]
"use strict";

const { hashBlock, mineBlock, parseDifficulty } = require("./block");
const { buildDemoChain } = require("./demo");

const show = (label, result) =>
  console.log(`${label.padEnd(44)} → ${result.valid ? "VALID" : `INVALID at block ${result.index}: ${result.reason}`}`);

/** Run the tamper story and return the numbers (used by tests and the README). */
function tamperStory(difficulty = 16, target = 1) {
  const { chain } = buildDemoChain(difficulty);
  const steps = [];
  steps.push(["1. Honest chain", chain.validate()]);

  const original = chain.blocks[target].data;
  chain.blocks[target] = { ...chain.blocks[target], data: original.replace(/\d+/, "500") };
  steps.push([`2. Edit block ${target}: "${chain.blocks[target].data}"`, chain.validate()]);

  chain.blocks[target] = { ...chain.blocks[target], hash: hashBlock(chain.blocks[target]) };
  steps.push(["3. Recompute its hash (no mining)", chain.validate()]);

  let attempts = 0;
  const remine = (i) => {
    const prev = chain.blocks[i - 1];
    const r = mineBlock({ ...chain.blocks[i], prevHash: prev.hash });
    chain.blocks[i] = r.block;
    attempts += r.attempts;
  };
  remine(target);
  steps.push([`4. Re-mine block ${target} only`, chain.validate()]);

  for (let i = target + 1; i < chain.blocks.length; i++) remine(i);
  steps.push([`5. Re-mine blocks ${target}–${chain.blocks.length - 1}`, chain.validate()]);
  return { steps, attempts, blocksRemined: chain.blocks.length - target };
}

function main(argv) {
  const difficulty = parseDifficulty(argv[0] ?? 16);
  const { steps, attempts, blocksRemined } = tamperStory(difficulty);
  for (const [label, result] of steps) show(label, result);
  console.log(`\nRewriting history cost ${attempts.toLocaleString("en-US")} hashes (${blocksRemined} blocks re-mined).`);
  console.log("On Bitcoin the attacker must also out-pace every honest miner adding new blocks — that is the security.");
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { tamperStory };
