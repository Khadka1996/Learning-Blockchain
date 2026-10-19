"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Ethereum accounts, nonces and gas fees", () => {
  it("an EOA has a balance and a nonce but no code", async () => {
    const [a] = await ethers.getSigners();
    expect(await ethers.provider.getCode(a.address)).to.equal("0x");
    expect(await ethers.provider.getBalance(a.address)).to.be.above(0n);
  });

  it("a plain ETH transfer uses exactly 21,000 gas and the sender pays value + gasUsed × price", async () => {
    const [a, b] = await ethers.getSigners();
    const before = await ethers.provider.getBalance(a.address);
    const nonce = await ethers.provider.getTransactionCount(a.address);
    const rc = await (await a.sendTransaction({ to: b.address, value: ethers.parseEther("1") })).wait();
    expect(rc.gasUsed).to.equal(21000n);
    const after = await ethers.provider.getBalance(a.address);
    expect(before - after).to.equal(ethers.parseEther("1") + rc.gasUsed * rc.gasPrice);
    expect(await ethers.provider.getTransactionCount(a.address)).to.equal(nonce + 1);
  });

  it("a contract's address is predictable: keccak256(rlp(sender, nonce))", async () => {
    const [a] = await ethers.getSigners();
    const predicted = ethers.getCreateAddress({ from: a.address, nonce: await ethers.provider.getTransactionCount(a.address) });
    const layout = await (await ethers.getContractFactory("Layout")).deploy();
    expect(await layout.getAddress()).to.equal(predicted);
    expect((await ethers.provider.getCode(predicted)).length).to.be.above(2);
  });

  it("a transaction signed for another chain is refused (EIP-155 replay protection)", async () => {
    const wallet = ethers.Wallet.createRandom();
    const raw = await wallet.signTransaction({ to: wallet.address, value: 0n, gasLimit: 21000n, gasPrice: 1n, nonce: 0, chainId: 1n });
    await expect(ethers.provider.send("eth_sendRawTransaction", [raw])).to.be.rejectedWith(/chain/i);
  });

  it("the same signed transaction cannot be sent twice (the nonce is used up)", async () => {
    const [funder, b] = await ethers.getSigners();
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await (await funder.sendTransaction({ to: wallet.address, value: ethers.parseEther("1") })).wait();
    const { chainId } = await ethers.provider.getNetwork();
    const fee = await ethers.provider.getFeeData();
    const raw = await wallet.signTransaction({ to: b.address, value: 1n, gasLimit: 21000n, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 0n, nonce: 0, chainId, type: 2 });
    await ethers.provider.send("eth_sendRawTransaction", [raw]);
    await expect(ethers.provider.send("eth_sendRawTransaction", [raw])).to.be.rejectedWith(/nonce/i);
    expect(await ethers.provider.getTransactionCount(wallet.address)).to.equal(1);
  });
});
