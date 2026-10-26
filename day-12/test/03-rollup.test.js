"use strict";
const { expect } = require("chai");
const fc = require("fast-check");
const R = require("../src/rollup");

const DAY = 24 * 3600;
const honestWitness = (run) => ({ rootAt: (i) => run.roots[i], stateAt: (i) => run.states[i] });

describe("Rollup (simulated) — batching, fraud proofs, challenge window", function () {
  const genesis = Array(20).fill(1000);

  describe("state transition", () => {
    it("moves coins; total supply is conserved", () => {
      const s = R.applyTx(genesis, { from: 1, to: 2, amount: 300 });
      expect(s[1]).to.equal(700);
      expect(s[2]).to.equal(1300);
      expect(s.reduce((a, b) => a + b)).to.equal(20_000);
    });

    it("overspend, self-transfer, bad index, zero/negative/fractional amount are NO-OPs (never throw)", () => {
      for (const tx of [
        { from: 1, to: 2, amount: 1001 },
        { from: 1, to: 1, amount: 5 },
        { from: 1, to: 99, amount: 5 },
        { from: -1, to: 2, amount: 5 },
        { from: 1, to: 2, amount: 0 },
        { from: 1, to: 2, amount: -5 },
        { from: 1, to: 2, amount: 1.5 },
        { from: "1", to: 2, amount: 5 },
        {},
      ]) {
        expect(R.applyTx(genesis, tx)).to.deep.equal(genesis);
      }
    });

    it("the state root changes when any balance changes, and is deterministic", () => {
      const a = R.stateRoot(genesis);
      expect(R.stateRoot(genesis.slice())).to.equal(a);
      const g2 = genesis.slice();
      g2[19] += 1;
      expect(R.stateRoot(g2)).to.not.equal(a);
    });
  });

  describe("cost model", () => {
    it("calldata gas = 4 per zero byte + 16 per non-zero byte (EIP-2028)", () => {
      expect(R.calldataGas(Buffer.from([0, 0, 1, 255]))).to.equal(4 + 4 + 16 + 16);
    });

    it("one tx alone is MORE expensive than an L1 transfer; 100+ txs per batch are >10x cheaper", () => {
      expect(R.batchCost(R.randomTxs(1, 50)).gasPerTx).to.be.greaterThan(R.L1_TRANSFER_GAS);
      expect(R.batchCost(R.randomTxs(100, 50)).gasPerTx).to.be.lessThan(R.L1_TRANSFER_GAS / 10);
    });
  });

  describe("optimistic fraud proofs", () => {
    it("an honest batch cannot be challenged and becomes final after 7 days (not before)", () => {
      const txs = R.randomTxs(64, 20, 3);
      const run = R.executeBatch(genesis, txs);
      const l1 = new R.RollupL1(genesis);
      l1.depositBond("seq", 10);
      const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: run.roots.at(-1), now: 0 });
      expect(l1.challenge(id, DAY, (i) => run.roots[i], honestWitness(run), "w").fraud).to.equal(false);
      expect(() => l1.finalize(id, 7 * DAY - 1)).to.throw("ChallengeWindowOpen");
      l1.finalize(id, 7 * DAY);
      expect(l1.finalizedRoot).to.equal(run.roots.at(-1));
    });

    it("a lie at tx #637 of 1,000 is found in 10 rounds; batch reverted, bond slashed, watcher paid", () => {
      const g = Array(50).fill(1000);
      const txs = R.randomTxs(1000, 50, 7);
      const run = R.executeBatch(g, txs);
      const lies = R.cheatingRoots(g, txs, 637, 0, 1_000_000);
      const l1 = new R.RollupL1(g);
      l1.depositBond("seq", 10);
      const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: lies.at(-1), now: 0 });
      const r = l1.challenge(id, DAY, (i) => lies[i], honestWitness(run), "w");
      expect(r).to.include({ fraud: true, index: 637, rounds: 10, reward: 5 });
      expect(l1.batches[id].status).to.equal("reverted");
      expect(l1.bonds.get("seq")).to.equal(0);
      expect(() => l1.finalize(id, 8 * DAY)).to.throw("NotPending");
    });

    it("no challenges after the window closes; no batches without a bond", () => {
      const l1 = new R.RollupL1(genesis);
      expect(() => l1.postBatch({ sequencer: "x", txs: [], claimedPostRoot: "00", now: 0 })).to.throw("NoBond");
      l1.depositBond("seq", 1);
      const run = R.executeBatch(genesis, []);
      const id = l1.postBatch({ sequencer: "seq", txs: [], claimedPostRoot: "bad", now: 0 });
      expect(() => l1.challenge(id, 7 * DAY, () => "x", honestWitness(run), "w")).to.throw("ChallengeWindowClosed");
    });

    it("an EMPTY batch that claims a different state is fraud", () => {
      const l1 = new R.RollupL1(genesis);
      l1.depositBond("seq", 4);
      const run = R.executeBatch(genesis, []);
      const id = l1.postBatch({ sequencer: "seq", txs: [], claimedPostRoot: "f00d", now: 0 });
      expect(l1.challenge(id, 1, () => "f00d", honestWitness(run), "w")).to.include({ fraud: true, reward: 2 });
    });

    it("a batch built on top of a fraudulent one is reverted too; the next batch builds on the last good root", () => {
      const txs = R.randomTxs(8, 20, 5);
      const run = R.executeBatch(genesis, txs);
      const lies = R.cheatingRoots(genesis, txs, 3, 0, 500);
      const l1 = new R.RollupL1(genesis);
      l1.depositBond("seq", 10);
      const bad = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: lies.at(-1), now: 0 });
      const after = l1.postBatch({ sequencer: "seq", txs: [], claimedPostRoot: lies.at(-1), now: 10 });
      l1.challenge(bad, DAY, (i) => lies[i], honestWitness(run), "w");
      expect(l1.batches[after].status).to.equal("reverted");
      l1.depositBond("seq2", 1);
      const fresh = l1.postBatch({ sequencer: "seq2", txs, claimedPostRoot: run.roots.at(-1), now: DAY });
      expect(l1.batches[fresh].preRoot).to.equal(R.stateRoot(genesis));
      l1.finalize(fresh, 8 * DAY);
      expect(l1.finalizedRoot).to.equal(run.roots.at(-1));
    });

    it("a challenger with a fake pre-state is rejected", () => {
      const txs = R.randomTxs(4, 20, 9);
      const l1 = new R.RollupL1(genesis);
      l1.depositBond("seq", 1);
      const run = R.executeBatch(genesis, txs);
      const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: run.roots.at(-1), now: 0 });
      const fake = R.executeBatch(Array(20).fill(5), txs);
      expect(() => l1.challenge(id, 1, (i) => run.roots[i], honestWitness(fake), "w")).to.throw("WrongPreState");
    });

    it("fuzz: for ANY batch and ANY lie position, bisection finds exactly that transaction in ⌈log2 n⌉ rounds", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 300 }),
          fc.integer({ min: 0, max: 10_000 }),
          fc.nat(),
          fc.integer({ min: 1, max: 1e6 }),
          (n, seed, kRaw, stolen) => {
            const txs = R.randomTxs(n, 20, seed + 1);
            const k = kRaw % n;
            const run = R.executeBatch(genesis, txs);
            const lies = R.cheatingRoots(genesis, txs, k, 0, stolen);
            const l1 = new R.RollupL1(genesis);
            l1.depositBond("seq", 2);
            const id = l1.postBatch({ sequencer: "seq", txs, claimedPostRoot: lies.at(-1), now: 0 });
            const r = l1.challenge(id, 1, (i) => lies[i], honestWitness(run), "w");
            expect(r.fraud).to.equal(true);
            expect(r.index).to.equal(k);
            expect(r.rounds).to.be.at.most(Math.ceil(Math.log2(n)));
          },
        ),
        { numRuns: Number(process.env.FUZZ_RUNS || 100) },
      );
    });
  });
});
