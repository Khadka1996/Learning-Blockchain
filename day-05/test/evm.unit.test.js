"use strict";
const { expect } = require("chai");
const { execute, assemble, deployer, memoryCost } = require("../src/evm");

const run = (src, opts) => execute(assemble(src), opts);
const top = (src) => BigInt(run(`${src} PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN`).output);
const MAX = (1n << 256n) - 1n;

describe("mini-EVM: arithmetic follows 256-bit EVM rules", () => {
  it("2 + 3 = 5 and the program costs 21,000 + 22,100 + small opcodes", () => {
    const r = run("PUSH1 2 PUSH1 3 ADD PUSH1 0 SSTORE");
    expect(r.status).to.equal("success");
    expect(r.storage.get(0n)).to.equal(5n);
    expect(r.gasUsed).to.equal(21000 + 3 + 3 + 3 + 3 + 22100);
  });
  it("subtraction wraps around (0 - 1 = 2^256 - 1) — no negative numbers", () => {
    expect(top("PUSH1 1 PUSH1 0 SUB")).to.equal(MAX);
  });
  it("addition overflow wraps to 0 at the EVM level (Solidity ≥0.8 adds its own check)", () => {
    expect(top(`PUSH1 1 PUSH32 ${MAX} ADD`)).to.equal(0n);
  });
  it("division and modulo by zero return 0 instead of failing", () => {
    expect(top("PUSH1 0 PUSH1 7 DIV")).to.equal(0n);
    expect(top("PUSH1 0 PUSH1 7 MOD")).to.equal(0n);
  });
  it("signed division: -6 / 2 = -3", () => {
    expect(top(`PUSH1 2 PUSH32 ${MAX - 5n} SDIV`)).to.equal(MAX - 2n);
  });
  it("DUP and SWAP move the right items", () => {
    expect(top("PUSH1 1 PUSH1 2 PUSH1 3 DUP3")).to.equal(1n);
    expect(top("PUSH1 1 PUSH1 2 PUSH1 3 SWAP2")).to.equal(1n);
    expect(top("PUSH1 1 PUSH1 2 PUSH1 3 SWAP2 POP POP")).to.equal(3n);
  });
});

describe("mini-EVM: failures", () => {
  it("stack underflow is an error and burns ALL the gas", () => {
    const r = run("ADD", { gasLimit: 50000 });
    expect(r.status).to.equal("error");
    expect(r.gasUsed).to.equal(50000);
  });
  it("an endless loop stops when gas runs out", () => {
    const r = run("JUMPDEST PUSH1 0 JUMP", { gasLimit: 30000 });
    expect(r.error).to.equal("out of gas");
    expect(r.gasUsed).to.equal(30000);
  });
  it("cannot jump into the middle of PUSH data, even if that byte is 0x5b", () => {
    const r = execute("0x600456605b00", { gasLimit: 30000 }); // PUSH1 4, JUMP, PUSH1 0x5b, STOP → pc 4 is push data
    expect(r.status).to.equal("error");
    expect(r.error).to.match(/bad jump/);
  });
  it("invalid opcode (0xfe) is an error", () => {
    expect(execute("0xfe").status).to.equal("error");
  });
  it("REVERT keeps unused gas but undoes storage writes and gives no refund", () => {
    const storage = new Map([[0n, 1n]]);
    const r = run("PUSH1 0 PUSH1 0 SSTORE PUSH1 0 PUSH1 0 REVERT", { storage });
    expect(r.status).to.equal("revert");
    expect(r.storage.get(0n)).to.equal(1n);
    expect(r.refund).to.equal(0);
    expect(r.gasUsed).to.be.below(30000);
  });
  it("SSTORE refuses to run with ≤ 2,300 gas left (EIP-2200 re-entrancy guard)", () => {
    const r = run("PUSH1 1 PUSH1 0 SSTORE", { gasLimit: 21000 + 6 + 2300 });
    expect(r.error).to.match(/2300/);
  });
  it("rejects bad input instead of guessing", () => {
    expect(() => execute("0x6")).to.throw(TypeError);
    expect(() => execute("0x00", { gasLimit: 100 })).to.throw(RangeError);
    expect(() => assemble("PUSH1 256")).to.throw(RangeError);
    expect(() => assemble("FOO")).to.throw(SyntaxError);
  });
});

describe("mini-EVM: gas rules", () => {
  it("storage: first touch is cold (2,100), second is warm (100)", () => {
    const r = run("PUSH1 0 SLOAD PUSH1 0 SLOAD");
    expect(r.trace.filter((t) => t.op === "SLOAD").map((t) => t.gasCost)).to.deep.equal([2100, 100]);
  });
  it("writing 0 → x costs 22,100; x → y costs 5,000; x → x costs 2,200 (cold)", () => {
    const cost = (storage, v) => run(`PUSH1 ${v} PUSH1 0 SSTORE`, { storage }).trace.find((t) => t.op === "SSTORE").gasCost;
    expect(cost(new Map(), 1)).to.equal(22100);
    expect(cost(new Map([[0n, 1n]]), 2)).to.equal(5000);
    expect(cost(new Map([[0n, 1n]]), 1)).to.equal(2200);
  });
  it("clearing a slot earns a 4,800 refund, capped at 1/5 of the gas used", () => {
    const r = run("PUSH1 0 PUSH1 0 SSTORE", { storage: new Map([[0n, 1n]]) });
    expect(r.refund).to.equal(4800);
    expect(r.gasUsed).to.equal(21000 + 6 + 5000 - 4800);
  });
  it("memory grows quadratically: 1 KB costs 98 gas, 1 MB costs ~2.1 million", () => {
    expect(memoryCost(32)).to.equal(98);
    expect(memoryCost(32768)).to.equal(3 * 32768 + 2097152);
  });
  it("deployer() rejects runtime code over the 24,576-byte limit", () => {
    expect(() => deployer("0x" + "00".repeat(24577))).to.throw(RangeError);
  });
});
