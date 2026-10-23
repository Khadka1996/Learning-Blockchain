"use strict";
// Regression tests for the findings in QA.md. Each one failed (or could not be written)
// before its fix, and passes after.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const eth = (n) => ethers.parseEther(String(n));

describe("7. QA findings (regression tests)", function () {
  it("S1: no fixed contract exposes an ERC-20-looking transfer(address,uint256)", async function () {
    const erc20Transfer = ethers.id("transfer(address,uint256)").slice(0, 10);
    for (const name of ["SafeBank", "MsgSenderWallet", "TxOriginWallet"]) {
      const f = await ethers.getContractFactory(name);
      const selectors = f.interface.fragments.filter((x) => x.type === "function").map((x) => x.selector);
      expect(selectors, name).to.not.include(erc20Transfer);
    }
  });

  it("M1: SafeWallet owner cannot renounce ownership and lock the ETH forever", async function () {
    const [owner, stranger] = await ethers.getSigners();
    const wallet = await ethers.deployContract("SafeWallet", [owner.address]);
    await owner.sendTransaction({ to: await wallet.getAddress(), value: eth(3) });
    await expect(wallet.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(wallet, "RenounceDisabled");
    await expect(wallet.connect(stranger).renounceOwnership()).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
    expect(await wallet.owner()).to.equal(owner.address);
    await expect(wallet.withdrawAll(owner.address)).to.changeEtherBalance(owner, eth(3));
  });

  it("I1: ETH forced in with selfdestruct does not confuse SafeBank or SafeKingOfTheHill accounting", async function () {
    const [, alice, bob] = await ethers.getSigners();
    const bank = await ethers.deployContract("SafeBank");
    await bank.connect(alice).deposit({ value: eth(2) });
    const Feeder = await ethers.getContractFactory("ForceFeeder");
    await Feeder.deploy(await bank.getAddress(), { value: eth(5) });
    expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(eth(7)); // more than anyone is owed
    await expect(bank.connect(alice).withdraw()).to.changeEtherBalance(alice, eth(2)); // pays the RECORD, not the balance
    await expect(bank.connect(bob).withdraw()).to.be.revertedWithCustomError(bank, "NothingToWithdraw");

    const game = await ethers.deployContract("SafeKingOfTheHill");
    await Feeder.deploy(await game.getAddress(), { value: eth(5) });
    await game.connect(alice).claimThrone({ value: eth(1) }); // prize is tracked, not read from the balance
    expect(await game.prize()).to.equal(eth(1));
  });
});
