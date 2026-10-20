const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

// Model-based property test. Random sequences of deposits, withdrawals and pause toggles are
// run on the real contract AND on a 15-line JavaScript model of what a vault should do.
// After every step the two must agree on who owes what, and on whether the call reverts.
describe("LearningVault: random operations vs a JavaScript model", function () {
  this.timeout(120_000);

  const USERS = 4;
  const op = fc.oneof(
    fc.record({ kind: fc.constant("deposit"), user: fc.nat(USERS - 1), amount: fc.integer({ min: 0, max: 5_000 }) }),
    fc.record({ kind: fc.constant("withdraw"), user: fc.nat(USERS - 1), amount: fc.integer({ min: 0, max: 6_000 }) }),
    fc.record({ kind: fc.constant("pause"), on: fc.boolean() }),
    fc.record({ kind: fc.constant("stranger-pause"), user: fc.nat(USERS - 1), on: fc.boolean() }),
  );

  it("agrees with the model after every operation (200 random programs)", async function () {
    const signers = await ethers.getSigners();
    const [owner, ...rest] = signers;
    const users = rest.slice(0, USERS);
    const Factory = await ethers.getContractFactory("LearningVault");

    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
        const vault = await Factory.deploy();
        await vault.waitForDeployment();
        const model = { balances: users.map(() => 0n), paused: false };
        const total = () => model.balances.reduce((a, b) => a + b, 0n);

        // Run one call; return the name of the custom error it reverted with, or null.
        const attempt = async (promise) => {
          try {
            await (await promise).wait();
            return null;
          } catch (error) {
            const match = /custom error '(\w+)/.exec(error.message);
            if (!match) throw error;
            return match[1];
          }
        };

        for (const step of ops) {
          let expected = null;
          let actual;
          if (step.kind === "deposit") {
            const amount = BigInt(step.amount);
            if (model.paused) expected = "ContractPaused"; // the pause check runs first
            else if (amount === 0n) expected = "ZeroAmount";
            actual = await attempt(vault.connect(users[step.user]).deposit({ value: amount }));
            if (expected === null) model.balances[step.user] += amount;
          } else if (step.kind === "withdraw") {
            const amount = BigInt(step.amount);
            if (amount === 0n) expected = "ZeroAmount";
            else if (amount > model.balances[step.user]) expected = "InsufficientBalance";
            actual = await attempt(vault.connect(users[step.user]).withdraw(amount));
            if (expected === null) model.balances[step.user] -= amount;
          } else if (step.kind === "pause") {
            actual = await attempt(vault.connect(owner).setPaused(step.on));
            model.paused = step.on;
          } else {
            expected = "NotOwner";
            actual = await attempt(vault.connect(users[step.user]).setPaused(step.on));
          }
          expect(actual, JSON.stringify(step)).to.equal(expected);

          // Invariants that must hold after EVERY step.
          for (let i = 0; i < USERS; i += 1) {
            expect(await vault.balances(users[i].address)).to.equal(model.balances[i]);
          }
          expect(await vault.totalDeposits()).to.equal(total());
          expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(total());
          expect(await vault.paused()).to.equal(model.paused);
        }
      }),
      { numRuns: 200, seed: 20261020, verbose: false },
    );
  });
});
