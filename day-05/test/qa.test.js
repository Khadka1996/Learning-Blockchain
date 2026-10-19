"use strict";
/** One regression test per QA finding (see QA.md). */
const { expect } = require("chai");
const { execute, assemble, deployer, MAX_GAS, MAX_TRACE } = require("../src/evm");

describe("QA regressions", () => {
  it("D1: running off the end of the code records an implicit STOP, like the real EVM", () => {
    const r = execute(assemble("PUSH1 1"));
    expect(r.trace.map((t) => t.op)).to.deep.equal(["PUSH1", "STOP"]);
  });

  it("M1: a huge gas limit is refused, so a program cannot make the host allocate gigabytes", () => {
    const grab = assemble("PUSH1 1 PUSH4 0xffffffe0 MSTORE"); // touches memory at ~4 GB
    expect(() => execute(grab, { gasLimit: 9_000_000_000_000_000 })).to.throw(RangeError);
    const r = execute(grab, { gasLimit: MAX_GAS });
    expect(r.error).to.match(/out of gas/);
  });

  it("L1: a long loop keeps at most MAX_TRACE steps in memory", () => {
    const r = execute(assemble("JUMPDEST PUSH1 0 JUMP"), { gasLimit: 2_000_000 });
    expect(r.trace.length).to.equal(MAX_TRACE);
    expect(r.traceTruncated).to.equal(true);
    expect(r.gasUsed).to.equal(2_000_000);
  });

  it("L2: storage with Number keys or out-of-range values is rejected, not silently ignored", () => {
    expect(() => execute("0x00", { storage: new Map([[0, 1n]]) })).to.throw(TypeError);
    expect(() => execute("0x00", { storage: new Map([[0n, -1n]]) })).to.throw(TypeError);
    expect(() => execute("0x00", { storage: { 0: 1n } })).to.throw(TypeError);
  });

  it("L3: deployer() refuses runtime code starting with 0xEF (EIP-3541)", () => {
    expect(() => deployer("0xef00")).to.throw(RangeError);
  });

  it("SDIV corner case: -2^255 / -1 overflows back to -2^255, as the Yellow Paper says", () => {
    const MIN = 1n << 255n, NEG1 = (1n << 256n) - 1n;
    const r = execute(assemble(`PUSH32 ${NEG1} PUSH32 ${MIN} SDIV PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN`));
    expect(BigInt(r.output)).to.equal(MIN);
  });

  it("PUSH past the end of the code pads with zero bytes on the right", () => {
    const r = execute("0x61ab"); // PUSH2 with only one byte → 0xab00
    expect(r.trace[0].stackTop).to.equal(0xab00n);
  });
});
