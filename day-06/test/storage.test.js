const { expect } = require("chai");
const { ethers } = require("hardhat");

// Day 05 showed where Solidity puts variables. Here we read LearningVault's raw storage
// with eth_getStorageAt and check the layout the source comment promises.
describe("LearningVault: storage layout (raw eth_getStorageAt)", function () {
  let vault, owner, alice, addr;
  const word = (n) => ethers.toBeHex(n, 32);
  const slot = (i) => ethers.provider.getStorage(addr, i);

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    vault = await (await ethers.getContractFactory("LearningVault")).deploy();
    await vault.waitForDeployment();
    addr = await vault.getAddress();
  });

  it("slot 0 is `paused`, slot 3 is `totalDeposits`", async function () {
    expect(await slot(0)).to.equal(word(0));
    await vault.setPaused(true);
    expect(await slot(0)).to.equal(word(1));

    await vault.setPaused(false);
    await vault.connect(alice).deposit({ value: 1234n });
    expect(await slot(3)).to.equal(word(1234));
  });

  it("slot 1 is the reentrancy guard: 1 when idle (never 0), so it is never re-created from scratch", async function () {
    expect(await slot(1)).to.equal(word(1));
    await vault.connect(alice).deposit({ value: 10n });
    await vault.connect(alice).withdraw(10n);
    expect(await slot(1)).to.equal(word(1));
  });

  it("slot 2 is the mapping base: it stays empty, values live at keccak256(key, 2)", async function () {
    await vault.connect(alice).deposit({ value: 777n });
    expect(await slot(2)).to.equal(word(0));

    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [alice.address, 2]));
    expect(await slot(key)).to.equal(word(777));
    expect(await vault.balances(alice.address)).to.equal(777n);
  });

  it("`owner` is immutable: it lives in the bytecode, so it uses no storage slot", async function () {
    for (let i = 0; i < 8; i += 1) {
      const value = BigInt(await slot(i));
      expect(value).to.not.equal(BigInt(owner.address));
    }
    const code = await ethers.provider.getCode(addr);
    expect(code.toLowerCase()).to.include(owner.address.slice(2).toLowerCase());
  });
});
