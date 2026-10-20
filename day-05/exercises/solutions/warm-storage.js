const { assemble, execute } = require("../../src/evm");

const code = assemble("PUSH1 7 PUSH1 0 SSTORE PUSH1 0 SLOAD PUSH1 0 SLOAD STOP");
const result = execute(code, { trace: true });
const reads = result.trace.filter((step) => step.op === "SLOAD");

console.log(`returned status: ${result.status}`);
console.log(`SLOAD gas: ${reads.map((step) => step.gasCost).join(", ")}`);
