"use strict";
// Property-based (fuzz) tests with fast-check: random sequences of actions by several users,
// checking after EVERY step that money is never created or lost.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

const RUNS = Number(process.env.FUZZ_RUNS || 40);

describe("6. Invariants (fuzz)", function () {
  this.timeout(120_000);

  it("SafeBank: ETH held == sum of balances; withdraw pays exactly the balance", async function () {
    const signers = (await ethers.getSigners()).slice(1, 5);
    const action = fc.oneof(
      fc.record({ kind: fc.constant("deposit"), who: fc.nat(3), wei: fc.bigInt(1n, 10n ** 18n) }),
      fc.record({ kind: fc.constant("withdraw"), who: fc.nat(3) }),
      fc.record({ kind: fc.constant("transfer"), who: fc.nat(3), to: fc.nat(3), wei: fc.bigInt(0n, 2n * 10n ** 18n) }),
    );
    let steps = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), async (actions) => {
        const bank = await ethers.deployContract("SafeBank");
        const model = [0n, 0n, 0n, 0n];
        for (const a of actions) {
          steps++;
          const user = signers[a.who];
          if (a.kind === "deposit") {
            await bank.connect(user).deposit({ value: a.wei });
            model[a.who] += a.wei;
          } else if (a.kind === "withdraw") {
            if (model[a.who] === 0n) {
              await expect(bank.connect(user).withdraw()).to.be.revertedWithCustomError(bank, "NothingToWithdraw");
            } else {
              await expect(bank.connect(user).withdraw()).to.changeEtherBalance(user, model[a.who]);
              model[a.who] = 0n;
            }
          } else if (a.wei > model[a.who]) {
            await expect(bank.connect(user).transferBalance(signers[a.to].address, a.wei)).to.be.revertedWithCustomError(bank, "InsufficientBalance");
          } else {
            await bank.connect(user).transferBalance(signers[a.to].address, a.wei);
            model[a.who] -= a.wei;
            model[a.to] += a.wei;
          }
          let sum = 0n;
          for (let i = 0; i < 4; i++) {
            const onChain = await bank.balanceOf(signers[i].address);
            expect(onChain).to.equal(model[i]);
            sum += onChain;
          }
          expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(sum);
        }
      }),
      { numRuns: RUNS },
    );
    console.log(`      (${RUNS} random programs, ${steps} steps, invariant held after every step)`);
  });

  it("SafeKingOfTheHill: ETH held == prize + all pending refunds, king always the highest bid", async function () {
    const signers = (await ethers.getSigners()).slice(1, 5);
    const action = fc.oneof(
      fc.record({ kind: fc.constant("bid"), who: fc.nat(3), wei: fc.bigInt(0n, 5n * 10n ** 18n) }),
      fc.record({ kind: fc.constant("withdraw"), who: fc.nat(3) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), async (actions) => {
        const game = await ethers.deployContract("SafeKingOfTheHill");
        let prize = 0n;
        for (const a of actions) {
          const user = signers[a.who];
          if (a.kind === "bid") {
            if (a.wei <= prize) {
              await expect(game.connect(user).claimThrone({ value: a.wei })).to.be.revertedWithCustomError(game, "BidTooLow");
            } else {
              await game.connect(user).claimThrone({ value: a.wei });
              prize = a.wei;
              expect(await game.king()).to.equal(user.address);
            }
          } else if ((await game.pendingReturns(user.address)) === 0n) {
            await expect(game.connect(user).withdraw()).to.be.revertedWithCustomError(game, "NothingToWithdraw");
          } else {
            await game.connect(user).withdraw();
          }
          let owed = await game.prize();
          expect(owed).to.equal(prize);
          for (const s of signers) owed += await game.pendingReturns(s.address);
          expect(await ethers.provider.getBalance(await game.getAddress())).to.equal(owed);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
