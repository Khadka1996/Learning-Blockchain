"use strict";
/**
 * Differential test: the SAME bytecode runs on my mini-EVM and on Hardhat's real EVM.
 * Every opcode's gas, the final storage, the return data, the status and the total gasUsed
 * must match exactly. fast-check generates the random programs.
 */
const { expect } = require("chai");
const fc = require("fast-check");
const { ethers, network } = require("hardhat");
const { execute, assemble, deployer } = require("../src/evm");

const MAX = (1n << 256n) - 1n;
const KEYS = [0, 1, 2, 3];
const BIN = ["ADD", "MUL", "SUB", "DIV", "SDIV", "MOD", "LT", "GT", "SLT", "SGT", "EQ", "AND", "OR", "XOR", "BYTE", "SHL", "SHR"];
const UN = ["ISZERO", "NOT"];

// One random "step" → assembly text, chosen so the stack never underflows.
const stepArb = fc.oneof(
  fc.record({ k: fc.constant("push"), v: fc.oneof(fc.constantFrom(0n, 1n, 2n, 31n, 255n, 1n << 255n, MAX), fc.bigInt(0n, MAX)) }),
  fc.record({ k: fc.constant("bin"), op: fc.constantFrom(...BIN) }),
  fc.record({ k: fc.constant("un"), op: fc.constantFrom(...UN) }),
  fc.record({ k: fc.constant("dup"), n: fc.integer({ min: 1, max: 4 }) }),
  fc.record({ k: fc.constant("swap"), n: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ k: fc.constant("sstore"), key: fc.constantFrom(...KEYS) }),
  fc.record({ k: fc.constant("sload"), key: fc.constantFrom(...KEYS) }),
  fc.record({ k: fc.constant("mstore"), off: fc.integer({ min: 0, max: 200 }) }),
  fc.record({ k: fc.constant("mload"), off: fc.integer({ min: 0, max: 200 }) }),
  fc.record({ k: fc.constant("misc"), op: fc.constantFrom("POP", "PC", "MSIZE", "GAS", "PUSH0") }),
);

function build(steps, end) {
  const out = [];
  let depth = 0;
  for (const s of steps) {
    if (s.k === "push") { out.push(`PUSH32 ${s.v}`); depth++; }
    else if (s.k === "bin" && depth >= 2) { out.push(s.op); depth--; }
    else if (s.k === "un" && depth >= 1) out.push(s.op);
    else if (s.k === "dup" && depth >= s.n) { out.push(`DUP${s.n}`); depth++; }
    else if (s.k === "swap" && depth > s.n) out.push(`SWAP${s.n}`);
    else if (s.k === "sstore" && depth >= 1) { out.push(`PUSH1 ${s.key} SSTORE`); depth--; }
    else if (s.k === "sload") { out.push(`PUSH1 ${s.key} SLOAD`); depth++; }
    else if (s.k === "mstore" && depth >= 1) { out.push(`PUSH1 ${s.off} MSTORE`); depth--; }
    else if (s.k === "mload") { out.push(`PUSH1 ${s.off} MLOAD`); depth++; }
    else if (s.k === "misc" && s.op === "POP" && depth >= 1) { out.push("POP"); depth--; }
    else if (s.k === "misc" && s.op !== "POP") { out.push(s.op); depth++; }
  }
  if (depth >= 1) out.push("PUSH1 0 MSTORE");                 // expose the top of the stack in the output
  out.push(end === "STOP" ? "STOP" : `PUSH1 64 PUSH1 0 ${end}`); // RETURN or REVERT 64 bytes
  return assemble(out.join(" "));
}

async function onHardhat(signer, runtime, txs, gasLimit) {
  const rc = await (await signer.sendTransaction({ data: deployer(runtime) })).wait();
  const results = [];
  for (let i = 0; i < txs; i++) {
    let hash;
    try {
      hash = (await signer.sendTransaction({ to: rc.contractAddress, gasLimit })).hash;
    } catch (e) {
      // Hardhat throws for a failed tx but still mines it: take the hash from the latest block.
      if (!/revert|out of gas/i.test(e.message)) throw e;
      hash = (await ethers.provider.getBlock("latest")).transactions[0];
    }
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    const trace = await network.provider.send("debug_traceTransaction", [hash]);
    const storage = new Map();
    for (const k of KEYS) storage.set(BigInt(k), BigInt(await ethers.provider.getStorage(rc.contractAddress, k)));
    results.push({ receipt, trace, storage });
  }
  return results;
}

function compare(mine, real) {
  // Tracer quirk (QA I1): when the very first opcode is STOP, Hardhat records no step at all. Gas is the same (0).
  const steps = real.trace.structLogs.length === 0 && mine.trace.length === 1 && mine.trace[0].op === "STOP" ? [] : mine.trace;
  expect(steps.map((t) => `${t.op}:${t.gasCost}`)).to.deep.equal(real.trace.structLogs.map((t) => `${t.op}:${t.gasCost}`));
  expect(BigInt(mine.gasUsed)).to.equal(real.receipt.gasUsed, "gasUsed");
  expect(mine.status === "success").to.equal(real.receipt.status === 1, "status");
  if (mine.status !== "error") expect(mine.output).to.equal("0x" + real.trace.returnValue.replace(/^0x/, ""), "output");
  for (const k of KEYS) expect(mine.storage.get(BigInt(k)) ?? 0n).to.equal(real.storage.get(BigInt(k)), `slot ${k}`);
}

describe("mini-EVM vs Hardhat's EVM (differential)", function () {
  this.timeout(180000);
  let signer;
  before(async () => {
    [signer] = await ethers.getSigners();
    await network.provider.send("evm_setAutomine", [true]);
  });

  it("property: random programs, run twice (fresh and dirty storage) — every step's gas matches", async () => {
    let compared = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 60, size: "max" }), fc.constantFrom("STOP", "RETURN", "REVERT"), async (steps, end) => {
        const code = build(steps, end);
        const real = await onHardhat(signer, code, 2, 300000);
        let storage = new Map();
        for (const r of real) {
          const mine = execute(code, { gasLimit: 300000, storage });
          compare(mine, r);
          storage = mine.storage;
          compared += mine.trace.length;
        }
      }),
      { numRuns: 150, seed: 5 },
    );
    console.log(`      compared ${compared.toLocaleString("en-US")} opcode steps in 300 transactions`);
    expect(compared).to.be.above(8000);
  });

  it("a counting loop with JUMPI (10 rounds) matches step by step", async () => {
    // i = 10; do { slot0 += 1; i -= 1 } while (i != 0)
    const code = assemble("PUSH1 10 JUMPDEST PUSH1 0 SLOAD PUSH1 1 ADD PUSH1 0 SSTORE PUSH1 1 SWAP1 SUB DUP1 PUSH1 2 JUMPI STOP");
    const [real] = await onHardhat(signer, code, 1, 300000);
    const mine = execute(code, { gasLimit: 300000 });
    compare(mine, real);
    expect(mine.storage.get(0n)).to.equal(10n);
  });

  it("a slot set then cleared in the same tx gets the same refund as Hardhat", async () => {
    const code = assemble("PUSH1 7 PUSH1 1 SSTORE PUSH1 0 PUSH1 1 SSTORE PUSH1 9 PUSH1 2 SSTORE");
    const [a, b] = await onHardhat(signer, code, 2, 300000);
    let mine = execute(code, { gasLimit: 300000 });
    compare(mine, a);
    mine = execute(code, { gasLimit: 300000, storage: mine.storage });
    compare(mine, b);
  });

  it("truncated PUSH at the end of the code and a real 0x5b inside PUSH data behave the same", async () => {
    for (const code of ["0x6001600055" + "61ab", "0x605b5b600155"]) {
      const [real] = await onHardhat(signer, code, 1, 100000);
      compare(execute(code, { gasLimit: 100000 }), real);
    }
  });

  it("out of gas: both burn the whole gas limit", async () => {
    const code = assemble("JUMPDEST PUSH1 0 JUMP");
    const [real] = await onHardhat(signer, code, 1, 40000);
    const mine = execute(code, { gasLimit: 40000 });
    expect(mine.status).to.equal("error");
    expect(BigInt(mine.gasUsed)).to.equal(real.receipt.gasUsed);
    expect(real.receipt.status).to.equal(0);
  });
});
