"use strict";
// Day 09 — Challenge: let a fuzzer find the bug in LeakyBank (and fail to find one in SafeBank).
const { ethers } = require("hardhat");
const fc = require("fast-check");

const WEI = 10n ** 15n; // amounts are multiples of 0.001 ETH

const action = fc.oneof(
  fc.record({ kind: fc.constant("deposit"), who: fc.nat(2), amount: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ kind: fc.constant("transfer"), who: fc.nat(2), to: fc.nat(2), amount: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ kind: fc.constant("withdraw"), who: fc.nat(2) }),
);

/** Run one random program; return the index of the first step that breaks "held == sum of balances", or -1. */
async function runProgram(name, program, users) {
  const bank = await ethers.deployContract(name);
  for (let i = 0; i < program.length; i++) {
    const a = program[i];
    const c = bank.connect(users[a.who]);
    try {
      if (a.kind === "deposit") await c.deposit({ value: BigInt(a.amount) * WEI });
      if (a.kind === "transfer") await c.transferBalance(users[a.to].address, BigInt(a.amount) * WEI);
      if (a.kind === "withdraw") await c.withdraw();
    } catch {
      /* a refused action is fine */
    }
    let sum = 0n;
    for (const u of users) sum += await bank.balanceOf(u.address);
    if ((await ethers.provider.getBalance(await bank.getAddress())) !== sum) return i;
  }
  return -1;
}

async function fuzz(name, users, runs) {
  let counterexample = null;
  try {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), async (program) => {
        const bad = await runProgram(name, program, users);
        if (bad !== -1) {
          counterexample = program.slice(0, bad + 1);
          return false;
        }
        return true;
      }),
      { numRuns: runs, seed: 9 },
    );
  } catch {
    /* fast-check throws with the shrunk counterexample; we print our own version below */
  }
  return counterexample;
}

async function main() {
  const [, a, b, c] = await ethers.getSigners();
  const users = [a, b, c];
  const names = ["Alice", "Bob", "Carol"];
  for (const name of ["LeakyBank", "SafeBank"]) {
    const found = await fuzz(name, users, 100);
    if (!found) {
      console.log(`${name}: invariant held for 100 random programs`);
    } else {
      console.log(`${name}: BROKEN. Shortest failing program fast-check found (${found.length} steps):`);
      for (const s of found) {
        const extra = s.kind === "transfer" ? ` to ${names[s.to]}` : "";
        console.log(`   ${names[s.who]} ${s.kind}${extra}${s.amount ? " " + s.amount * 0.001 + " ETH" : ""}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
