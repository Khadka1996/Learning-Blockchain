"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");
const { makeValidators, deployBridges, signMint, signNaive, readDeposits } = require("../src/deploy");

const E = (x) => ethers.parseEther(String(x));

describe("Bridge — SafeBridge vs NaiveBridge (lock on L1, mint on L2)", function () {
  let v, b, alice, bob, attacker;
  beforeEach(async () => {
    [, alice, bob, attacker] = await ethers.getSigners();
    v = makeValidators(3);
    b = await deployBridges({ validators: v, threshold: 2 });
    await b.token.transfer(alice, E(1000));
    await b.token.connect(alice).approve(b.lockbox, ethers.MaxUint256);
  });

  async function lock(amount, to = alice) {
    await b.lockbox.connect(alice).deposit(to, amount);
    return (await readDeposits(b.lockbox)).at(-1);
  }
  const mintWith = (signers, d, caller = alice) =>
    signMint(b.bridge, signers, { srcChainId: b.srcChainId, ...d }).then((sigs) =>
      b.bridge.connect(caller).mint(b.srcChainId, d.depositId, d.to, d.amount, sigs),
    );

  describe("happy path", () => {
    it("lock 100 → 2 of 3 validators sign → 100 wrapped minted; anyone may relay", async () => {
      const d = await lock(E(100));
      await expect(mintWith([v[0], v[2]], d, bob)).to.emit(b.bridge, "Minted").withArgs(0, alice.address, E(100));
      expect(await b.wrapped.balanceOf(alice)).to.equal(E(100));
      expect(await b.token.balanceOf(b.lockbox)).to.equal(E(100));
      expect(await b.bridge.processed(0)).to.equal(true);
    });

    it("3 of 3 also works", async () => {
      const d = await lock(E(5));
      await mintWith(v, d);
      expect(await b.wrapped.totalSupply()).to.equal(E(5));
    });
  });

  describe("attacks on SafeBridge — all must fail", () => {
    it("replay: the same deposit cannot be minted twice", async () => {
      const d = await lock(E(100));
      await mintWith([v[0], v[1]], d);
      await expect(mintWith([v[0], v[1]], d)).to.be.revertedWithCustomError(b.bridge, "AlreadyProcessed").withArgs(0);
    });

    it("one validator signing twice does not meet a 2-of-3 threshold", async () => {
      const d = await lock(E(100));
      const [s] = await signMint(b.bridge, [v[0]], { srcChainId: b.srcChainId, ...d });
      await expect(b.bridge.mint(b.srcChainId, d.depositId, d.to, d.amount, [s, s])).to.be.revertedWithCustomError(
        b.bridge,
        "NotValidatorOrUnsorted",
      );
    });

    it("too few signatures / a non-validator signature are rejected", async () => {
      const d = await lock(E(100));
      await expect(mintWith([v[0]], d)).to.be.revertedWithCustomError(b.bridge, "NotEnoughSignatures").withArgs(1, 2);
      const outsider = ethers.Wallet.createRandom();
      const signers = [v[0], outsider].sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1));
      await expect(mintWith(signers, d)).to.be.revertedWithCustomError(b.bridge, "NotValidatorOrUnsorted");
    });

    it("tampering: changing the recipient or amount breaks every signature", async () => {
      const d = await lock(E(100));
      const sigs = await signMint(b.bridge, [v[0], v[1]], { srcChainId: b.srcChainId, ...d });
      await expect(
        b.bridge.mint(b.srcChainId, d.depositId, attacker.address, d.amount, sigs),
      ).to.be.revertedWithCustomError(b.bridge, "NotValidatorOrUnsorted");
      await expect(b.bridge.mint(b.srcChainId, d.depositId, d.to, E(1000), sigs)).to.be.revertedWithCustomError(
        b.bridge,
        "NotValidatorOrUnsorted",
      );
    });

    it("cross-bridge replay: signatures for bridge A are useless on bridge B (address bound in the digest)", async () => {
      const d = await lock(E(100));
      const sigs = await signMint(b.bridge, [v[0], v[1]], { srcChainId: b.srcChainId, ...d });
      const other = await deployBridges({ validators: v, threshold: 2 });
      await expect(
        other.bridge.mint(b.srcChainId, d.depositId, d.to, d.amount, sigs),
      ).to.be.revertedWithCustomError(other.bridge, "NotValidatorOrUnsorted");
    });

    it("wrong source chain, zero amount and zero recipient are rejected", async () => {
      await expect(b.bridge.mint(999, 0, alice, 1, [])).to.be.revertedWithCustomError(b.bridge, "WrongSourceChain");
      await expect(b.bridge.mint(b.srcChainId, 0, alice, 0, [])).to.be.revertedWithCustomError(b.bridge, "ZeroAmount");
      await expect(b.bridge.mint(b.srcChainId, 0, ethers.ZeroAddress, 1, [])).to.be.revertedWithCustomError(
        b.bridge,
        "ZeroRecipient",
      );
    });

    it("high-s (malleable) signatures are rejected by OpenZeppelin ECDSA", async () => {
      const d = await lock(E(100));
      const sigs = await signMint(b.bridge, [v[0], v[1]], { srcChainId: b.srcChainId, ...d });
      const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
      const sig = ethers.Signature.from(sigs[0]);
      const flipped = ethers.concat([sig.r, ethers.toBeHex(N - BigInt(sig.s), 32), sig.v === 27 ? "0x1c" : "0x1b"]);
      await expect(b.bridge.mint(b.srcChainId, d.depositId, d.to, d.amount, [flipped, sigs[1]])).to.be.revertedWithCustomError(
        b.bridge,
        "ECDSAInvalidSignatureS",
      );
    });

    it("only the bridge can mint wrapped tokens; the token can be wired once, by the deployer", async () => {
      await expect(b.wrapped.connect(attacker).mint(attacker, 1)).to.be.revertedWithCustomError(b.wrapped, "NotBridge");
      await expect(b.bridge.connect(attacker).setToken(attacker)).to.be.revertedWithCustomError(b.bridge, "NotDeployer");
      await expect(b.bridge.setToken(attacker)).to.be.revertedWithCustomError(b.bridge, "TokenAlreadySet");
    });

    it("rejects unsafe validator sets: threshold 0, > N, minority, duplicates, zero address", async () => {
      const F = await ethers.getContractFactory("SafeBridge");
      const a = v.map((w) => w.address);
      for (const [vals, t] of [
        [a, 0],
        [a, 4],
        [a, 1], // 1-of-3 is a minority
        [[a[0], a[0], a[1]], 2],
        [[a[0], ethers.ZeroAddress, a[1]], 2],
      ]) {
        await expect(F.deploy(1, vals, t)).to.be.revertedWithCustomError(F, "BadConfig");
      }
    });
  });

  describe("NaiveBridge — the bugs are real", () => {
    it("the same two signatures mint again and again (no deposit id)", async () => {
      await lock(E(100));
      const sigs = await signNaive([v[0], v[1]], alice.address, E(100));
      for (let i = 0; i < 5; i++) await b.naive.connect(attacker).mint(alice, E(100), sigs);
      expect(await b.naiveWrapped.totalSupply()).to.equal(E(500)); // 5x the locked amount
    });

    it("one validator signing twice passes a 2-of-3 check", async () => {
      const [s] = await signNaive([v[0]], attacker.address, E(1_000_000));
      await b.naive.connect(attacker).mint(attacker, E(1_000_000), [s, s]);
      expect(await b.naiveWrapped.balanceOf(attacker)).to.equal(E(1_000_000));
    });
  });

  describe("lockbox", () => {
    it("rejects zero amount / zero recipient and counts deposit ids", async () => {
      await expect(b.lockbox.connect(alice).deposit(alice, 0)).to.be.revertedWithCustomError(b.lockbox, "ZeroAmount");
      await expect(b.lockbox.connect(alice).deposit(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(
        b.lockbox,
        "ZeroRecipient",
      );
      await lock(1n);
      await lock(2n, bob);
      expect(await b.lockbox.nextDepositId()).to.equal(2n);
    });
  });

  it("fuzz invariant: wrapped supply on L2 never exceeds tokens locked on L1, whatever the order of mints/replays", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ amount: fc.integer({ min: 1, max: 50 }), relays: fc.integer({ min: 1, max: 3 }) }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (ops) => {
          const fresh = await deployBridges({ validators: v, threshold: 2 });
          await fresh.token.transfer(alice, E(1000));
          await fresh.token.connect(alice).approve(fresh.lockbox, ethers.MaxUint256);
          for (const op of ops) await fresh.lockbox.connect(alice).deposit(alice, E(op.amount));
          const deps = await readDeposits(fresh.lockbox);
          for (let i = 0; i < ops.length; i++) {
            const sigs = await signMint(fresh.bridge, [v[1], v[2]], { srcChainId: fresh.srcChainId, ...deps[i] });
            for (let r = 0; r < ops[i].relays; r++) {
              try {
                await fresh.bridge.mint(fresh.srcChainId, deps[i].depositId, deps[i].to, deps[i].amount, sigs);
              } catch {
                /* replays are expected to fail */
              }
              expect(await fresh.wrapped.totalSupply()).to.be.lte(await fresh.token.balanceOf(fresh.lockbox));
            }
          }
          expect(await fresh.wrapped.totalSupply()).to.equal(await fresh.token.balanceOf(fresh.lockbox));
        },
      ),
      { numRuns: Number(process.env.FUZZ_RUNS || 15) },
    );
  });
});
