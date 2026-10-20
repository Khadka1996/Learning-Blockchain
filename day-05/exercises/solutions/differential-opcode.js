const { assemble, execute } = require("../../src/evm");

const result = execute(assemble("PUSH1 6 PUSH1 7 MUL STOP"), { trace: true });
const mul = result.trace.find((step) => step.op === "MUL");

console.log(`status: ${result.status}`);
console.log(`MUL gas: ${mul.gasCost}`);
console.log("Extend src/evm.js and test/evm.unit.test.js to make this a real differential exercise.");
