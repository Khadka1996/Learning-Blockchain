const { expect } = require("chai");
const { ethers } = require("hardhat");

// Day 05: every variable lives in a 32-byte "locker". Here we open the lockers of MiniToken with
// eth_getStorageAt and check the layout promised in its source comment.
describe("MiniToken: storage layout (raw eth_getStorageAt)", function () {
  let token, addr, owner, alice, bob;
  const word = (n) => ethers.toBeHex(n, 32);
  const slot = (i) => ethers.provider.getStorage(addr, i);
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const keccak = (types, values) => ethers.keccak256(abi.encode(types, values));

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MiniToken")).deploy("Mini", "MINI", 5_000n);
    await token.waitForDeployment();
    addr = await token.getAddress();
  });

  it("slot 2 is totalSupply", async function () {
    expect(await slot(2)).to.equal(word(5_000));
    await token.burn(1_000n);
    expect(await slot(2)).to.equal(word(4_000));
  });

  it("slots 0 and 1 hold the short strings: the bytes on the left, length*2 in the last byte", async function () {
    const pack = (text) => ethers.zeroPadBytes(ethers.concat([ethers.toUtf8Bytes(text), "0x"]), 31) + ethers.toBeHex(text.length * 2, 1).slice(2);
    expect(await slot(0)).to.equal(pack("Mini"));
    expect(await slot(1)).to.equal(pack("MINI"));
  });

  it("slot 3 is the balances mapping: balanceOf[who] lives at keccak256(who, 3); the base slot stays empty", async function () {
    await token.transfer(alice.address, 321n);
    expect(await slot(3)).to.equal(word(0));
    expect(await ethers.provider.getStorage(addr, keccak(["address", "uint256"], [alice.address, 3]))).to.equal(word(321));
    expect(await ethers.provider.getStorage(addr, keccak(["address", "uint256"], [owner.address, 3]))).to.equal(word(5_000 - 321));
  });

  it("slot 4 is the NESTED allowance mapping: allowance[owner][spender] lives at keccak256(spender, keccak256(owner, 4))", async function () {
    await token.approve(bob.address, 777n);
    const inner = keccak(["address", "uint256"], [owner.address, 4]);
    const position = keccak(["address", "bytes32"], [bob.address, inner]);
    expect(await ethers.provider.getStorage(addr, position)).to.equal(word(777));
    expect(await token.allowance(owner.address, bob.address)).to.equal(777n);
  });

  it("decimals is a constant: it is in the bytecode, not in any slot", async function () {
    for (let i = 0; i < 6; i += 1) expect(BigInt(await slot(i))).to.not.equal(18n);
    expect(await token.decimals()).to.equal(18n);
  });

  it("a spent allowance is written back as 0; an unlimited one is NOT rewritten (saves gas)", async function () {
    const position = keccak(["address", "bytes32"], [bob.address, keccak(["address", "uint256"], [owner.address, 4])]);
    await token.approve(bob.address, 50n);
    await token.connect(bob).transferFrom(owner.address, bob.address, 50n);
    expect(await ethers.provider.getStorage(addr, position)).to.equal(word(0));
    await token.approve(bob.address, ethers.MaxUint256);
    await token.connect(bob).transferFrom(owner.address, bob.address, 50n);
    expect(await ethers.provider.getStorage(addr, position)).to.equal(word(ethers.MaxUint256));
  });
});
