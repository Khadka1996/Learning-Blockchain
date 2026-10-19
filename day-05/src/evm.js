"use strict";
/**
 * mini-EVM — a teaching interpreter for a small subset of the Ethereum Virtual Machine.
 *
 * The EVM is a stack machine: every instruction (opcode) is one byte, pops its inputs
 * from a stack of 256-bit words, and pushes its result back. Each opcode costs gas.
 * This file implements ~70 opcodes with the SAME gas rules as Ethereum mainnet
 * (Cancun) for those opcodes, including the warm/cold storage pricing (EIP-2929)
 * and SSTORE refunds (EIP-2200 + EIP-3529). test/evm.diff.test.js runs random programs
 * on this interpreter AND on Hardhat's real EVM and checks every step's gas matches.
 *
 * Not implemented on purpose: calls to other contracts, logs, CREATE, precompiles,
 * calldata, environment opcodes. Unknown opcodes stop execution like INVALID (0xFE).
 */

const WORD = 1n << 256n;
const MASK = WORD - 1n;
const MAX_STACK = 1024;
const MAX_GAS = 30_000_000;        // one Ethereum block's worth; also caps memory at ~4 MB (QA M1)
const MAX_TRACE = 100_000;         // keep at most this many trace steps in memory (QA L1)

// Gas schedule (Yellow Paper Appendix G + EIP-2929 + EIP-3529), Cancun values.
const G = Object.freeze({
  zero: 0, base: 2, verylow: 3, low: 5, mid: 8, high: 10, jumpdest: 1,
  coldSload: 2100, warmRead: 100, sset: 20000, sreset: 2900, clearRefund: 4800,
  memoryWord: 3, quadDivisor: 512, txBase: 21000, maxRefundQuotient: 5, callStipend: 2300,
});

class EvmError extends Error {}

/** Opcode table: byte → { name, inputs, gas, run(state, args) → pushed value or undefined }. */
const OPS = new Map();
function op(code, name, inputs, gas, run) { OPS.set(code, Object.freeze({ code, name, inputs, gas, run })); }

const toSigned = (x) => (x >= 1n << 255n ? x - WORD : x);
const toUnsigned = (x) => ((x % WORD) + WORD) % WORD;

op(0x00, "STOP", 0, G.zero, (s) => { s.halt = "stop"; });
op(0x01, "ADD", 2, G.verylow, (s, [a, b]) => (a + b) & MASK);
op(0x02, "MUL", 2, G.low, (s, [a, b]) => (a * b) & MASK);
op(0x03, "SUB", 2, G.verylow, (s, [a, b]) => (a - b) & MASK);
op(0x04, "DIV", 2, G.low, (s, [a, b]) => (b === 0n ? 0n : a / b));          // x/0 = 0 in the EVM
op(0x05, "SDIV", 2, G.low, (s, [a, b]) => (b === 0n ? 0n : toUnsigned(toSigned(a) / toSigned(b))));
op(0x06, "MOD", 2, G.low, (s, [a, b]) => (b === 0n ? 0n : a % b));
op(0x10, "LT", 2, G.verylow, (s, [a, b]) => (a < b ? 1n : 0n));
op(0x11, "GT", 2, G.verylow, (s, [a, b]) => (a > b ? 1n : 0n));
op(0x12, "SLT", 2, G.verylow, (s, [a, b]) => (toSigned(a) < toSigned(b) ? 1n : 0n));
op(0x13, "SGT", 2, G.verylow, (s, [a, b]) => (toSigned(a) > toSigned(b) ? 1n : 0n));
op(0x14, "EQ", 2, G.verylow, (s, [a, b]) => (a === b ? 1n : 0n));
op(0x15, "ISZERO", 1, G.verylow, (s, [a]) => (a === 0n ? 1n : 0n));
op(0x16, "AND", 2, G.verylow, (s, [a, b]) => a & b);
op(0x17, "OR", 2, G.verylow, (s, [a, b]) => a | b);
op(0x18, "XOR", 2, G.verylow, (s, [a, b]) => a ^ b);
op(0x19, "NOT", 1, G.verylow, (s, [a]) => MASK ^ a);
op(0x1a, "BYTE", 2, G.verylow, (s, [i, x]) => (i >= 32n ? 0n : (x >> (8n * (31n - i))) & 0xffn));
op(0x1b, "SHL", 2, G.verylow, (s, [sh, x]) => (sh >= 256n ? 0n : (x << sh) & MASK));
op(0x1c, "SHR", 2, G.verylow, (s, [sh, x]) => (sh >= 256n ? 0n : x >> sh));
op(0x50, "POP", 1, G.base, () => undefined);
op(0x51, "MLOAD", 1, G.verylow, (s, [off]) => { expandMemory(s, off, 32n); return readWord(s.memory, Number(off)); });
op(0x52, "MSTORE", 2, G.verylow, (s, [off, v]) => { expandMemory(s, off, 32n); writeWord(s.memory, Number(off), v); });
op(0x53, "MSTORE8", 2, G.verylow, (s, [off, v]) => { expandMemory(s, off, 1n); s.memory[Number(off)] = Number(v & 0xffn); });
op(0x54, "SLOAD", 1, 0, (s, [key]) => { chargeAccess(s, key); return s.storage.get(key) ?? 0n; });
op(0x55, "SSTORE", 2, 0, (s, [key, v]) => sstore(s, key, v));
op(0x56, "JUMP", 1, G.mid, (s, [dest]) => { jumpTo(s, dest); });
op(0x57, "JUMPI", 2, G.high, (s, [dest, cond]) => { if (cond !== 0n) jumpTo(s, dest); });
op(0x58, "PC", 0, G.base, (s) => BigInt(s.pc));
op(0x59, "MSIZE", 0, G.base, (s) => BigInt(s.memory.length));
op(0x5a, "GAS", 0, G.base, (s) => BigInt(s.gasLeft));   // gas left AFTER paying for GAS itself
op(0x5b, "JUMPDEST", 0, G.jumpdest, () => undefined);
op(0x5f, "PUSH0", 0, G.base, () => 0n);
for (let n = 1; n <= 32; n++) op(0x5f + n, `PUSH${n}`, 0, G.verylow, (s) => s.pushValue);
for (let n = 1; n <= 16; n++) op(0x7f + n, `DUP${n}`, n, G.verylow, (s, args) => {
  for (let i = args.length - 1; i >= 0; i--) s.stack.push(args[i]); // put the n items back, deepest first
  return args[n - 1];                                               // then copy the n-th item to the top
});
for (let n = 1; n <= 16; n++) {
  op(0x8f + n, `SWAP${n}`, n + 1, G.verylow, (s, args) => {
    [args[0], args[n]] = [args[n], args[0]];
    for (let i = args.length - 1; i >= 0; i--) s.stack.push(args[i]);
  });
}
op(0xf3, "RETURN", 2, G.zero, (s, [off, len]) => { expandMemory(s, off, len); s.output = s.memory.slice(Number(off), Number(off + len)); s.halt = "return"; });
op(0xfd, "REVERT", 2, G.zero, (s, [off, len]) => { expandMemory(s, off, len); s.output = s.memory.slice(Number(off), Number(off + len)); s.halt = "revert"; });

function readWord(mem, off) { let x = 0n; for (let i = 0; i < 32; i++) x = (x << 8n) | BigInt(mem[off + i]); return x; }
function writeWord(mem, off, v) { for (let i = 31; i >= 0; i--) { mem[off + i] = Number(v & 0xffn); v >>= 8n; } }

/** Memory cost = 3·words + words²/512. Growing memory pays the difference (quadratic, so huge memory is unaffordable). */
function memoryCost(words) { return G.memoryWord * words + Math.floor((words * words) / G.quadDivisor); }
function expandMemory(s, off, len) {
  if (len === 0n) return;
  const end = off + len;
  if (end > 0xffffffffn) throw new EvmError("out of gas (memory)"); // would cost > 2^50 gas anyway
  const words = Math.ceil(Number(end) / 32);
  const have = s.memory.length / 32;
  if (words > have) {
    useGas(s, memoryCost(words) - memoryCost(have));
    const bigger = new Uint8Array(words * 32);
    bigger.set(s.memory);
    s.memory = bigger;
  }
}

/** EIP-2929: the first touch of a storage slot in a transaction is "cold" (2,100 gas), later touches "warm" (100). */
function chargeAccess(s, key) {
  if (s.warm.has(key)) useGas(s, G.warmRead);
  else { s.warm.add(key); useGas(s, G.coldSload); }
}

/** SSTORE pricing (EIP-2200 + EIP-2929 + EIP-3529). `original` = value at the start of the transaction. */
function sstore(s, key, value) {
  if (s.gasLeft <= G.callStipend) throw new EvmError("out of gas (SSTORE needs > 2300 gas left)");
  let cost = 0;
  if (!s.warm.has(key)) { s.warm.add(key); cost += G.coldSload; }
  const current = s.storage.get(key) ?? 0n;
  const original = s.original.has(key) ? s.original.get(key) : current;
  if (current === value) cost += G.warmRead;                       // no-op write
  else if (original === current) {                                // first change in this tx ("clean" slot)
    cost += original === 0n ? G.sset : G.sreset;
    if (value === 0n) s.refund += G.clearRefund;
  } else {                                                        // slot already changed in this tx ("dirty")
    cost += G.warmRead;
    if (original !== 0n) {
      if (current === 0n) s.refund -= G.clearRefund;
      else if (value === 0n) s.refund += G.clearRefund;
    }
    if (original === value) s.refund += (original === 0n ? G.sset : G.sreset) - G.warmRead;
  }
  useGas(s, cost);
  if (!s.original.has(key)) s.original.set(key, current);
  s.storage.set(key, value);
}

function jumpTo(s, dest) {
  if (dest >= BigInt(s.code.length) || !s.jumpdests.has(Number(dest))) throw new EvmError(`bad jump destination ${dest}`);
  s.nextPc = Number(dest);
}

function useGas(s, amount) {
  if (amount > s.gasLeft) { s.gasLeft = 0; throw new EvmError("out of gas"); }
  s.gasLeft -= amount;
}

/** Valid jump targets are JUMPDEST bytes that are NOT inside PUSH data. */
function findJumpdests(code) {
  const set = new Set();
  for (let pc = 0; pc < code.length; pc++) {
    const b = code[pc];
    if (b === 0x5b) set.add(pc);
    else if (b >= 0x60 && b <= 0x7f) pc += b - 0x5f;
  }
  return set;
}

/** Storage must be Map<bigint, bigint> with 256-bit values; Number keys would silently miss (QA L2). */
function checkStorage(storage) {
  if (!(storage instanceof Map)) throw new TypeError("storage must be a Map<bigint, bigint>");
  for (const [k, v] of storage) {
    if (typeof k !== "bigint" || typeof v !== "bigint" || k < 0n || k > MASK || v < 0n || v > MASK) {
      throw new TypeError("storage keys and values must be bigints from 0 to 2^256 - 1");
    }
  }
}

function toBytes(code) {
  if (code instanceof Uint8Array) return code;
  if (typeof code !== "string" || !/^(0x)?([0-9a-fA-F]{2})*$/.test(code)) throw new TypeError("code must be hex bytes or a Uint8Array");
  return Uint8Array.from(Buffer.from(code.replace(/^0x/, ""), "hex"));
}

/**
 * Run `code` as one transaction against `storage` (Map<bigint, bigint>, updated in place only on success).
 * Returns { status, gasUsed, executionGas, refund, output, trace }. `trace` = [{ pc, op, gasCost, stackTop }].
 * gasUsed includes the 21,000 base cost of a transaction with empty calldata, minus the capped refund.
 */
function execute(code, { gasLimit = 1_000_000, storage = new Map(), trace = true } = {}) {
  const bytes = toBytes(code);
  if (!Number.isSafeInteger(gasLimit) || gasLimit < G.txBase || gasLimit > MAX_GAS) {
    throw new RangeError(`gasLimit must be an integer from 21,000 to ${MAX_GAS.toLocaleString("en-US")}`);
  }
  checkStorage(storage);
  const s = {
    code: bytes, pc: 0, nextPc: 0, stack: [], memory: new Uint8Array(0),
    storage: new Map(storage), original: new Map(), warm: new Set(), refund: 0,
    gasLeft: gasLimit - G.txBase, halt: null, output: new Uint8Array(0), pushValue: 0n,
    jumpdests: findJumpdests(bytes),
  };
  const steps = [];
  let error = null;
  try {
    while (!s.halt) {
      if (s.pc >= bytes.length) {                                    // running off the end = an implicit STOP
        s.halt = "stop";
        if (trace && steps.length < MAX_TRACE) steps.push({ pc: s.pc, op: "STOP", gasCost: 0, stackTop: s.stack.at(-1) });
        break;
      }
      const byte = bytes[s.pc];
      const def = OPS.get(byte);
      if (!def) throw new EvmError(`invalid opcode 0x${byte.toString(16).padStart(2, "0")}`);
      const before = s.gasLeft;
      s.nextPc = s.pc + 1;
      if (def.name.startsWith("PUSH") && byte !== 0x5f) {
        const n = byte - 0x5f;
        let v = 0n;
        for (let i = 1; i <= n; i++) v = (v << 8n) | BigInt(bytes[s.pc + i] ?? 0); // missing bytes read as 0
        s.pushValue = v;
        s.nextPc = s.pc + 1 + n;
      }
      if (s.stack.length < def.inputs) throw new EvmError(`stack underflow at ${def.name}`);
      useGas(s, def.gas);
      const args = def.inputs ? s.stack.splice(-def.inputs).reverse() : []; // args[0] = top of stack
      const out = def.run(s, args);
      if (out !== undefined) s.stack.push(out);
      if (s.stack.length > MAX_STACK) throw new EvmError("stack overflow");
      if (trace && steps.length < MAX_TRACE) steps.push({ pc: s.pc, op: def.name, gasCost: before - s.gasLeft, stackTop: s.stack.at(-1) });
      s.pc = s.nextPc;
    }
  } catch (e) {
    if (!(e instanceof EvmError)) throw e;
    error = e.message;
  }
  const failed = error !== null;
  // An exceptional halt (error) burns ALL gas; REVERT refunds the unused gas but undoes storage.
  const executionGas = failed ? gasLimit - G.txBase : gasLimit - G.txBase - s.gasLeft;
  const raw = G.txBase + executionGas;
  const refund = s.halt === "stop" || s.halt === "return" ? Math.min(Math.max(s.refund, 0), Math.floor(raw / G.maxRefundQuotient)) : 0;
  const ok = !failed && s.halt !== "revert";
  return {
    status: ok ? "success" : failed ? "error" : "revert",
    error,
    gasUsed: raw - refund,
    executionGas,
    refund,
    output: "0x" + Buffer.from(s.output).toString("hex"),
    storage: ok ? s.storage : new Map(storage),
    trace: steps,
    traceTruncated: trace && steps.length >= MAX_TRACE,
  };
}

/** Tiny assembler: "PUSH1 0x2a PUSH1 0 SSTORE" → hex. Lets tests and demos write readable programs. */
const BY_NAME = new Map([...OPS.values()].map((d) => [d.name, d.code]));
function assemble(src) {
  const out = [];
  const tokens = src.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i].toUpperCase();
    if (!BY_NAME.has(name)) throw new SyntaxError(`unknown opcode ${tokens[i]}`);
    const code = BY_NAME.get(name);
    out.push(code);
    if (code >= 0x60 && code <= 0x7f) {
      const n = code - 0x5f;
      const v = BigInt(tokens[++i]);
      if (v < 0n || v >= 1n << BigInt(8 * n)) throw new RangeError(`${name} value does not fit in ${n} bytes`);
      out.push(...Buffer.from(v.toString(16).padStart(2 * n, "0"), "hex"));
    }
  }
  return "0x" + Buffer.from(out).toString("hex");
}

/** Init code that deploys `runtime` as-is (CODECOPY it into memory and RETURN it). Used to put raw bytecode on Hardhat. */
function deployer(runtimeHex) {
  const rt = toBytes(runtimeHex);
  if (rt.length > 24576) throw new RangeError("runtime code larger than the EIP-170 limit (24,576 bytes)");
  if (rt[0] === 0xef) throw new RangeError("runtime code may not start with 0xEF (EIP-3541)"); // QA L3
  const len = rt.length.toString(16).padStart(4, "0");
  return "0x61" + len + "80600c6000396000f3" + Buffer.from(rt).toString("hex");
}

module.exports = { execute, assemble, deployer, OPS, G, memoryCost, MAX_GAS, MAX_TRACE };
