const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

// Model-based property test for LearningToken: random operations run on the contract AND on a
// small JavaScript model of what a capped ERC-20 should do. After every step they must agree,
// and the invariants below must hold:
//   I1  the sum of all balances == totalSupply          I2  totalSupply never exceeds the cap
//   I3  every balance and allowance matches the model   I4  a failing call changes nothing
describe("LearningToken: random operations vs a JavaScript model", function () {
  this.timeout(180_000);

  const USERS = 4; // signers[0] is the owner and also user 0
  const SUPPLY = 10_000n;
  const CAP = 12_000n;
  const MAX = ethers.MaxUint256;
  const amount = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 7_000 }));
  const user = fc.nat(USERS - 1);
  const op = fc.oneof(
    fc.record({ kind: fc.constant("transfer"), from: user, to: user, value: amount }),
    fc.record({ kind: fc.constant("approve"), from: user, to: user, value: fc.oneof(amount, fc.constant("max")) }),
    fc.record({ kind: fc.constant("transferFrom"), spender: user, from: user, to: user, value: amount }),
    fc.record({ kind: fc.constant("burn"), from: user, value: amount }),
    fc.record({ kind: fc.constant("burnFrom"), spender: user, from: user, value: amount }),
    fc.record({ kind: fc.constant("mint"), by: user, to: user, value: amount }),
  );

  it("agrees with the model and keeps every invariant (200 random programs)", async function () {
    const signers = await ethers.getSigners();
    const users = signers.slice(0, USERS);
    const Factory = await ethers.getContractFactory("LearningToken");

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

    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 14 }), async (ops) => {
        const token = await Factory.deploy(users[0].address, SUPPLY, CAP);
        await token.waitForDeployment();

        const m = { bal: users.map((_, i) => (i === 0 ? SUPPLY : 0n)), allow: users.map(() => users.map(() => 0n)), supply: SUPPLY };
        const V = (v) => (v === "max" ? MAX : BigInt(v));
        const spend = (owner, spender, value) => {
          // returns an error name or null, and applies the allowance change on success
          const cur = m.allow[owner][spender];
          if (cur === MAX) return null;
          if (cur < value) return "ERC20InsufficientAllowance";
          m.allow[owner][spender] = cur - value;
          return null;
        };

        for (const step of ops) {
          let expected = null;
          let actual;
          const snapshot = JSON.stringify([m.bal, m.allow, m.supply], (_, x) => (typeof x === "bigint" ? x.toString() : x));

          if (step.kind === "transfer") {
            const v = BigInt(step.value);
            if (m.bal[step.from] < v) expected = "ERC20InsufficientBalance";
            actual = await attempt(token.connect(users[step.from]).transfer(users[step.to].address, v));
            if (!expected) {
              m.bal[step.from] -= v;
              m.bal[step.to] += v;
            }
          } else if (step.kind === "approve") {
            actual = await attempt(token.connect(users[step.from]).approve(users[step.to].address, V(step.value)));
            m.allow[step.from][step.to] = V(step.value);
          } else if (step.kind === "transferFrom") {
            const v = BigInt(step.value);
            const before = m.allow[step.from][step.spender];
            expected = spend(step.from, step.spender, v);
            if (!expected && m.bal[step.from] < v) {
              expected = "ERC20InsufficientBalance";
              m.allow[step.from][step.spender] = before; // reverted: allowance restored
            }
            actual = await attempt(token.connect(users[step.spender]).transferFrom(users[step.from].address, users[step.to].address, v));
            if (!expected) {
              m.bal[step.from] -= v;
              m.bal[step.to] += v;
            }
          } else if (step.kind === "burn") {
            const v = BigInt(step.value);
            if (m.bal[step.from] < v) expected = "ERC20InsufficientBalance";
            actual = await attempt(token.connect(users[step.from]).burn(v));
            if (!expected) {
              m.bal[step.from] -= v;
              m.supply -= v;
            }
          } else if (step.kind === "burnFrom") {
            const v = BigInt(step.value);
            const before = m.allow[step.from][step.spender];
            expected = spend(step.from, step.spender, v);
            if (!expected && m.bal[step.from] < v) {
              expected = "ERC20InsufficientBalance";
              m.allow[step.from][step.spender] = before;
            }
            actual = await attempt(token.connect(users[step.spender]).burnFrom(users[step.from].address, v));
            if (!expected) {
              m.bal[step.from] -= v;
              m.supply -= v;
            }
          } else {
            const v = BigInt(step.value);
            if (step.by !== 0) expected = "OwnableUnauthorizedAccount";
            else if (m.supply + v > CAP) expected = "ERC20ExceededCap";
            actual = await attempt(token.connect(users[step.by]).mint(users[step.to].address, v));
            if (!expected) {
              m.bal[step.to] += v;
              m.supply += v;
            }
          }
          expect(actual, JSON.stringify(step)).to.equal(expected);

          // I3 + I4: everything matches the model (a failed call left the model untouched too)
          for (let i = 0; i < USERS; i += 1) {
            expect(await token.balanceOf(users[i].address)).to.equal(m.bal[i]);
            for (let j = 0; j < USERS; j += 1) expect(await token.allowance(users[i].address, users[j].address)).to.equal(m.allow[i][j]);
          }
          // I1 + I2
          expect(await token.totalSupply()).to.equal(m.supply);
          expect(m.bal.reduce((a, b) => a + b, 0n)).to.equal(m.supply);
          expect(m.supply <= CAP).to.equal(true);
          if (expected) {
            expect(JSON.stringify([m.bal, m.allow, m.supply], (_, x) => (typeof x === "bigint" ? x.toString() : x))).to.equal(snapshot);
          }
        }
      }),
      { numRuns: Number(process.env.FUZZ_RUNS ?? 200), seed: 20261021 },
    );
  });
});
