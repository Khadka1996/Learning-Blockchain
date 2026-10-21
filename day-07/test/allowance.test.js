const { expect } = require("chai");
const { ethers } = require("hardhat");

// The allowance is the most misunderstood part of ERC-20. These tests tell its story.
describe("Allowances: the approve race and the unlimited approval", function () {
  const SUPPLY = ethers.parseEther("1000");
  let token, alice, bob, mallory;

  beforeEach(async function () {
    [, alice, bob, mallory] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MiniToken")).deploy("Mini", "MINI", SUPPLY);
    await token.waitForDeployment();
    await token.transfer(alice.address, 1000n);
  });

  it("THE APPROVE RACE: lowering an allowance 100 -> 50 can let the spender take 150", async function () {
    // 1. Alice approves Mallory for 100.
    await token.connect(alice).approve(mallory.address, 100n);

    // 2. Alice changes her mind: she sends approve(50). While that transaction waits in the
    //    mempool, Mallory sees it and sends transferFrom(100) with a higher fee, so it lands FIRST.
    await token.connect(mallory).transferFrom(alice.address, mallory.address, 100n);
    expect(await token.allowance(alice.address, mallory.address)).to.equal(0n);

    // 3. Alice's approve(50) now lands: the allowance is 50 AGAIN, on top of the 100 already taken.
    await token.connect(alice).approve(mallory.address, 50n);
    await token.connect(mallory).transferFrom(alice.address, mallory.address, 50n);

    expect(await token.balanceOf(mallory.address)).to.equal(150n); // Alice only ever meant 100 or 50
  });

  it("the plain-ERC-20 habit 'approve 0 first' does NOT fully close the race (it only makes it a two-step)", async function () {
    await token.connect(alice).approve(mallory.address, 100n);
    // Alice sends approve(0). Mallory front-runs with transferFrom(100): she already got everything
    // Alice had allowed, which is acceptable. The real danger is only the 100 -> 50 direct change above.
    await token.connect(mallory).transferFrom(alice.address, mallory.address, 100n);
    await token.connect(alice).approve(mallory.address, 0n);
    expect(await token.allowance(alice.address, mallory.address)).to.equal(0n);
    expect(await token.balanceOf(mallory.address)).to.equal(100n); // total never exceeded the ORIGINAL 100
  });

  it("an allowance is only a PERMISSION: it is checked at spending time against the balance then", async function () {
    await token.connect(alice).approve(bob.address, 800n);
    await token.connect(alice).transfer(mallory.address, 900n); // Alice spends her tokens elsewhere
    await expect(token.connect(bob).transferFrom(alice.address, bob.address, 800n))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
      .withArgs(alice.address, 100n, 800n);
  });

  it("an unlimited approval stays unlimited: if the spender is hacked, EVERYTHING you hold is at risk", async function () {
    await token.connect(alice).approve(bob.address, ethers.MaxUint256);
    await token.connect(bob).transferFrom(alice.address, bob.address, 400n);
    await token.connect(bob).transferFrom(alice.address, bob.address, 600n);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
    // ...and it is STILL unlimited, ready for any tokens Alice receives later:
    expect(await token.allowance(alice.address, bob.address)).to.equal(ethers.MaxUint256);
    await token.transfer(alice.address, 5n);
    await token.connect(bob).transferFrom(alice.address, bob.address, 5n);
    expect(await token.balanceOf(bob.address)).to.equal(1005n);
  });

  it("a spender can split an allowance across many calls and recipients", async function () {
    await token.connect(alice).approve(bob.address, 100n);
    await token.connect(bob).transferFrom(alice.address, bob.address, 30n);
    await token.connect(bob).transferFrom(alice.address, mallory.address, 30n);
    await token.connect(bob).transferFrom(alice.address, bob.address, 40n);
    expect(await token.allowance(alice.address, bob.address)).to.equal(0n);
    await expect(token.connect(bob).transferFrom(alice.address, bob.address, 1n)).to.be.revertedWithCustomError(
      token,
      "ERC20InsufficientAllowance",
    );
  });
});
