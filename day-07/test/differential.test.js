const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

// Differential testing (Day 05 did it against Hardhat's EVM; here against OpenZeppelin):
// run the SAME random operations on MiniToken and on OpenZeppelin's ERC20. After EVERY operation
// they must agree on: succeeded or failed, which error (name AND arguments), which events, and
// every balance, allowance and the total supply. If my hand-written token has a bug OpenZeppelin
// does not, the first operation that exposes it fails this test.
describe("Differential: MiniToken vs OpenZeppelin ERC20", function () {
  this.timeout(180_000);

  const USERS = 4;
  const SUPPLY = 10_000n;
  const amount = fc.oneof(
    fc.integer({ min: 0, max: 3 }),
    fc.integer({ min: 0, max: 12_000 }),
    fc.constant(Number.MAX_SAFE_INTEGER), // far more than anyone has
  );
  const user = fc.nat(USERS - 1);
  const op = fc.oneof(
    fc.record({ kind: fc.constant("transfer"), from: user, to: user, value: amount }),
    fc.record({ kind: fc.constant("approve"), from: user, to: user, value: fc.oneof(amount, fc.constant("max")) }),
    fc.record({ kind: fc.constant("transferFrom"), spender: user, from: user, to: user, value: amount }),
    fc.record({ kind: fc.constant("burn"), from: user, value: amount }),
    fc.record({ kind: fc.constant("transfer-to-zero"), from: user, value: amount }),
    fc.record({ kind: fc.constant("approve-zero-spender"), from: user }),
  );

  it("behave identically after every operation (150 random programs)", async function () {
    const signers = await ethers.getSigners();
    const users = signers.slice(0, USERS);
    const MiniFactory = await ethers.getContractFactory("MiniToken");
    const RefFactory = await ethers.getContractFactory("OZReference");

    const describeCall = async (contract, fn, args, signer) => {
      try {
        const receipt = await (await contract.connect(signer)[fn](...args)).wait();
        const events = receipt.logs.map((l) => contract.interface.parseLog(l)).map((e) => `${e.name}(${e.args.map(String)})`);
        return { ok: true, events };
      } catch (error) {
        const parsed = contract.interface.parseError(error.data ?? error.error?.data);
        return { ok: false, error: `${parsed.name}(${parsed.args.map(String)})` };
      }
    };

    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 14 }), async (ops) => {
        const mini = await MiniFactory.deploy("T", "T", SUPPLY);
        const ref = await RefFactory.deploy("T", "T", SUPPLY);
        await Promise.all([mini.waitForDeployment(), ref.waitForDeployment()]);
        // Same starting point: users 1..3 get some tokens from user 0.
        for (const c of [mini, ref]) for (let i = 1; i < USERS; i += 1) await c.connect(users[0]).transfer(users[i].address, 1000n);

        for (const step of ops) {
          const a = (i) => users[i].address;
          const V = (v) => (v === "max" ? ethers.MaxUint256 : BigInt(v));
          let fn, args, signer;
          if (step.kind === "transfer") [fn, args, signer] = ["transfer", [a(step.to), V(step.value)], users[step.from]];
          else if (step.kind === "approve") [fn, args, signer] = ["approve", [a(step.to), V(step.value)], users[step.from]];
          else if (step.kind === "transferFrom") [fn, args, signer] = ["transferFrom", [a(step.from), a(step.to), V(step.value)], users[step.spender]];
          else if (step.kind === "burn") [fn, args, signer] = ["burn", [V(step.value)], users[step.from]];
          else if (step.kind === "transfer-to-zero") [fn, args, signer] = ["transfer", [ethers.ZeroAddress, V(step.value)], users[step.from]];
          else [fn, args, signer] = ["approve", [ethers.ZeroAddress, 1n], users[step.from]];

          const [m, r] = [await describeCall(mini, fn, args, signer), await describeCall(ref, fn, args, signer)];
          expect(m, `${JSON.stringify(step)}`).to.deep.equal(r);

          expect(await mini.totalSupply()).to.equal(await ref.totalSupply());
          for (let i = 0; i < USERS; i += 1) {
            expect(await mini.balanceOf(a(i))).to.equal(await ref.balanceOf(a(i)));
            for (let j = 0; j < USERS; j += 1) {
              expect(await mini.allowance(a(i), a(j))).to.equal(await ref.allowance(a(i), a(j)));
            }
          }
        }
      }),
      { numRuns: Number(process.env.FUZZ_RUNS ?? 150), seed: 20261021 },
    );
  });
});
