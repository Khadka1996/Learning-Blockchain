const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

/**
 * Differential test: run the SAME random program on MiniNFT (mine) and OpenZeppelin's ERC721.
 * After every step both must agree on: success or failure, the error name and arguments,
 * the events, every owner, every balance and every approval.
 */

const RUNS = Number(process.env.FUZZ_RUNS || 120);
const IDS = [0n, 1n, 2n, 3n];

function decodeError(err, iface) {
  const data = err.data || err.error?.data || err.info?.error?.data;
  if (!data || data === "0x") return { name: "empty" };
  try {
    const parsed = iface.parseError(data);
    return { name: parsed.name, args: parsed.args.map(String) };
  } catch {
    return { name: "unknown", data };
  }
}

async function run(contract, fn) {
  try {
    const tx = await fn(contract);
    const receipt = await tx.wait();
    const events = receipt.logs.map((l) => {
      const e = contract.interface.parseLog(l);
      return `${e.name}(${e.args.map(String).join(",")})`;
    });
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: decodeError(err, contract.interface) };
  }
}

async function snapshotState(nft, people) {
  const state = {};
  for (const id of IDS) {
    try {
      state[`owner${id}`] = await nft.ownerOf(id);
      state[`approved${id}`] = await nft.getApproved(id);
    } catch {
      state[`owner${id}`] = "none";
    }
  }
  for (const p of people) {
    state[`bal:${p}`] = String(await nft.balanceOf(p));
    for (const q of people) state[`op:${p}:${q}`] = await nft.isApprovedForAll(p, q);
  }
  return state;
}

describe("Differential: MiniNFT vs OpenZeppelin ERC721 on random programs", function () {
  this.timeout(10 * 60 * 1000);

  it(`agree on every step of ${RUNS} random programs`, async function () {
    const signers = (await ethers.getSigners()).slice(0, 4); // [0] is the minter
    const addrs = signers.map((s) => s.address);
    const mine = await ethers.deployContract("MiniNFT", ["Mini", "MINI", "x/"]);
    const ref = await ethers.deployContract("ReferenceERC721");
    const good = await ethers.deployContract("GoodReceiver");
    const noHook = await ethers.deployContract("NoHookContract");
    const targets = [...addrs, ethers.ZeroAddress, await good.getAddress(), await noHook.getAddress()];
    const people = addrs;

    const who = fc.integer({ min: 0, max: 3 });
    const target = fc.integer({ min: 0, max: targets.length - 1 });
    const id = fc.constantFrom(...IDS);
    const op = fc.oneof(
      fc.record({ kind: fc.constant("mint"), to: target, id }),
      fc.record({ kind: fc.constant("mint"), to: who, id }), // mints to a person are common
      fc.record({ kind: fc.constant("transfer"), by: who, from: who, to: target, id, honest: fc.boolean() }),
      fc.record({ kind: fc.constant("safeTransfer"), by: who, from: who, to: target, id, honest: fc.boolean() }),
      fc.record({ kind: fc.constant("burn"), by: who, id, honest: fc.boolean() }),
      fc.record({ kind: fc.constant("approve"), by: who, to: target, id }),
      fc.record({ kind: fc.constant("approveAll"), by: who, to: target, on: fc.boolean() }),
      fc.record({ kind: fc.constant("burn"), by: who, id }),
    );

    const call = (o) => (c) => {
      switch (o.kind) {
        case "mint":
          return c.connect(signers[0]).mint(targets[o.to], o.id);
        case "transfer":
          return c.connect(signers[o.by]).transferFrom(addrs[o.from], targets[o.to], o.id);
        case "safeTransfer":
          return c.connect(signers[o.by])["safeTransferFrom(address,address,uint256)"](addrs[o.from], targets[o.to], o.id);
        case "approve":
          return c.connect(signers[o.by]).approve(targets[o.to], o.id);
        case "approveAll":
          return c.connect(signers[o.by]).setApprovalForAll(targets[o.to], o.on);
        default:
          return c.connect(signers[o.by]).burn(o.id);
      }
    };

    let steps = 0;
    let failures = 0;
    let successes = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 5, maxLength: 25 }), async (program) => {
        const snap = await ethers.provider.send("evm_snapshot", []);
        try {
          for (const raw of program) {
            // "honest" steps act as the token's real owner, so plenty of calls SUCCEED.
            const o = { ...raw };
            if (o.honest) {
              const owner = await ref.ownerOf(o.id).catch(() => null);
              const idx = addrs.indexOf(owner);
              if (idx >= 0) {
                o.by = idx;
                o.from = idx;
              }
            }
            const a = await run(mine, call(o));
            const b = await run(ref, call(o));
            expect(a, JSON.stringify(o, (_, v) => (typeof v === "bigint" ? String(v) : v))).to.deep.equal(b);
            steps += 1;
            if (a.ok) successes += 1;
            else failures += 1;
          }
          expect(await snapshotState(mine, people)).to.deep.equal(await snapshotState(ref, people));
        } finally {
          await ethers.provider.send("evm_revert", [snap]);
        }
      }),
      { numRuns: RUNS, seed: Number(process.env.FUZZ_SEED || 8) },
    );
    console.log(`        ${steps} steps compared: ${successes} succeeded on both, ${failures} failed on both with the same error`);
  });
});
