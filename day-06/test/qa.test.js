const { expect } = require("chai");
const { ethers } = require("hardhat");

// One regression test per QA.md finding. Each of these FAILED on the original Day 06 code.
describe("QA regressions (see QA.md)", function () {
  let vault, alice, bob;
  const deployVault = async () => {
    const v = await (await ethers.getContractFactory("LearningVault")).deploy();
    await v.waitForDeployment();
    return v;
  };

  beforeEach(async function () {
    [, alice, bob] = await ethers.getSigners();
    vault = await deployVault();
  });

  it("M1: users can still withdraw while the vault is paused (the owner cannot lock funds)", async function () {
    await vault.connect(alice).deposit({ value: 1000n });
    await vault.setPaused(true);
    await expect(vault.connect(alice).withdraw(1000n)).to.changeEtherBalance(alice, 1000n);
    expect(await vault.balances(alice.address)).to.equal(0n);
    // ...and a paused vault still refuses new money:
    await expect(vault.connect(bob).deposit({ value: 1n })).to.be.revertedWithCustomError(vault, "ContractPaused");
  });

  it("L1: events are emitted in an order an indexer can replay (Withdrawn before a re-deposit)", async function () {
    const receiver = await (await ethers.getContractFactory("RedepositingReceiver")).deploy(await vault.getAddress());
    await receiver.waitForDeployment();
    const receipt = await (await receiver.depositThenWithdraw({ value: 100n })).wait();

    const events = receipt.logs.map((l) => vault.interface.parseLog(l)).filter(Boolean);
    expect(events.map((e) => e.name)).to.deep.equal(["Deposited", "Withdrawn", "Deposited"]);

    // Replay the log the way an off-chain app would: every newBalance must match the running total.
    let replayed = 0n;
    for (const e of events) {
      replayed += e.name === "Deposited" ? e.args.amount : -e.args.amount;
      expect(e.args.newBalance).to.equal(replayed);
    }
    expect(replayed).to.equal(await vault.balances(await receiver.getAddress()));
  });

  it("L2: withdraw no longer pays a fresh 22,100-gas guard write on every call", async function () {
    await vault.connect(alice).deposit({ value: 10n });
    const receipt = await (await vault.connect(alice).withdraw(1n)).wait();
    // The original (guard 0 <-> 1) cost 52,031 gas for this exact call; the 1 <-> 2 guard costs ~42,859.
    expect(receipt.gasUsed).to.be.lessThan(46_000n);
  });

  it("L3: the constructor event really is emitted (the old test could never fail)", async function () {
    const receipt = await vault.deploymentTransaction().wait();
    const names = receipt.logs.map((l) => vault.interface.parseLog(l)?.name);
    expect(names).to.deep.equal(["OwnershipTransferred"]);
  });

  it("I1: no dead code: the unused ZeroAddress error is gone", async function () {
    expect(vault.interface.getError("ZeroAddress")).to.equal(null);
  });

  it("I1: solvencyCheck is `>=`, as its comment now says (extra ETH is allowed)", async function () {
    await vault.connect(alice).deposit({ value: 5n });
    const sender = await (await ethers.getContractFactory("ForceSender")).deploy(await vault.getAddress(), { value: 1n });
    await sender.waitForDeployment();
    expect(await vault.solvencyCheck()).to.equal(true);
  });
});
