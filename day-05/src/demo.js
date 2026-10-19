"use strict";
/**
 * Day 05 demo — Ethereum & the EVM, explored with ethers.js against a LOCAL Hardhat chain.
 *   npx hardhat run src/demo.js                      (in-process chain)
 *   npx hardhat node  +  npx hardhat run src/demo.js --network localhost
 */
const { ethers, network } = require("hardhat");
const { execute, assemble, deployer } = require("./evm");
const { mappingSlot, arraySlot, unpack } = require("./storage");

const fmt = (n) => Number(n).toLocaleString("en-US");
const gwei = (wei) => ethers.formatUnits(wei, "gwei");

async function main() {
  const [sita, ram] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chain id ${chainId})\n`);

  // 1. Two kinds of account ---------------------------------------------------------------
  console.log("1. Accounts: every address has a balance and a nonce; contracts also have code");
  const describe = async (label, a) => {
    const [bal, nonce, code] = await Promise.all([ethers.provider.getBalance(a), ethers.provider.getTransactionCount(a), ethers.provider.getCode(a)]);
    console.log(`   ${label.padEnd(16)} ${a}  balance ${ethers.formatEther(bal).padStart(7)} ETH  nonce ${nonce}  code ${(code.length - 2) / 2} bytes`);
  };
  await describe("Sita (EOA)", sita.address);

  // 2. A plain transfer -------------------------------------------------------------------
  const before = await ethers.provider.getBalance(sita.address);
  const rc = await (await sita.sendTransaction({ to: ram.address, value: ethers.parseEther("1") })).wait();
  const after = await ethers.provider.getBalance(sita.address);
  const fee = rc.gasUsed * rc.gasPrice;
  console.log("\n2. Sita sends Ram 1 ETH");
  console.log(`   gas used          ${fmt(rc.gasUsed)}   (the fixed price of any plain transfer)`);
  console.log(`   gas price         ${gwei(rc.gasPrice)} gwei`);
  console.log(`   fee               ${ethers.formatEther(fee)} ETH = gas used × gas price`);
  console.log(`   Sita paid         ${ethers.formatEther(before - after)} ETH = 1 ETH + fee → ${before - after === ethers.parseEther("1") + fee}`);
  console.log(`   Sita's nonce now  ${await ethers.provider.getTransactionCount(sita.address)}   (counts her transactions; stops replays)`);

  // 3. Deploy a contract at a predictable address ------------------------------------------
  const predicted = ethers.getCreateAddress({ from: sita.address, nonce: await ethers.provider.getTransactionCount(sita.address) });
  const layout = await (await ethers.getContractFactory("Layout")).deploy();
  const deployRc = await layout.deploymentTransaction().wait();
  const addr = await layout.getAddress();
  console.log("\n3. Deploy Layout.sol");
  console.log(`   predicted address ${predicted}  (keccak256(rlp(Sita, nonce)))`);
  console.log(`   real address      ${addr}  match: ${predicted === addr}`);
  console.log(`   deploy gas        ${fmt(deployRc.gasUsed)}`);
  await describe("Layout (contract)", addr);

  // 4. Storage layout -----------------------------------------------------------------------
  await layout.increment();
  await layout.connect(ram).deposit({ value: 500n });
  await layout.push(11);
  await layout.push(22);
  const slot = (i) => ethers.provider.getStorage(addr, i);
  const s1 = await slot(1), s2 = await slot(2);
  const mSlot = mappingSlot("address", ram.address, 3);
  const aSlot = arraySlot(4, 1);
  console.log("\n4. Storage: 32-byte lockers, read raw with eth_getStorageAt");
  console.log(`   slot 0  ${await slot(0)}  counter = ${BigInt(await slot(0))}`);
  console.log(`   slot 1  ${s1}  small = ${unpack(s1, 0, 16)}, big = ${unpack(s1, 16, 16)} (packed)`);
  console.log(`   slot 2  ${s2}  owner = ${ethers.toBeHex(unpack(s2, 0, 20), 20).slice(0, 10)}…, paused = ${unpack(s2, 20, 1) === 1n}`);
  console.log(`   slot 3  ${await slot(3)}  mapping: empty on purpose`);
  console.log(`   slot 4  ${await slot(4)}  items.length = ${BigInt(await slot(4))}`);
  console.log(`   balances[Ram] at keccak256(Ram, 3) = 0x${mSlot.toString(16).slice(0, 12)}…  → ${BigInt(await slot(mSlot))} wei`);
  console.log(`   items[1]      at keccak256(4) + 1  = 0x${aSlot.toString(16).slice(0, 12)}…  → ${BigInt(await slot(aSlot))}`);

  // 5. What storage writes cost --------------------------------------------------------------
  const fresh = await (await ethers.getContractFactory("Layout")).deploy();
  const g1 = (await (await fresh.increment()).wait()).gasUsed;
  const g2 = (await (await fresh.increment()).wait()).gasUsed;
  console.log("\n5. Gas of the same function, twice");
  console.log(`   increment() 0 → 1   ${fmt(g1)} gas   (new value in an empty slot: 20,000 + cold 2,100)`);
  console.log(`   increment() 1 → 2   ${fmt(g2)} gas   (changing an existing value: 2,900 + cold 2,100)`);
  console.log(`   first write costs ${fmt(g1 - g2)} gas more`);

  // 6. Opcodes: my mini-EVM vs the real one ------------------------------------------------------
  const code = assemble("PUSH1 2 PUSH1 3 ADD PUSH1 0 SSTORE PUSH1 0 SLOAD PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN");
  const raw = await (await sita.sendTransaction({ data: deployer(code) })).wait();
  const tx = await sita.sendTransaction({ to: raw.contractAddress, gasLimit: 100000 });
  const real = await network.provider.send("debug_traceTransaction", [tx.hash]);
  const mine = execute(code, { gasLimit: 100000 });
  console.log(`\n6. Opcodes: "store 2 + 3, read it back, return it" = ${code}`);
  console.log("   pc  opcode    my gas  Hardhat gas");
  mine.trace.forEach((t, i) => console.log(`   ${String(t.pc).padStart(2)}  ${t.op.padEnd(8)} ${String(t.gasCost).padStart(7)}  ${String(real.structLogs[i]?.gasCost).padStart(11)}`));
  const realGas = (await tx.wait()).gasUsed;
  console.log(`   total gasUsed: mine ${fmt(mine.gasUsed)}, Hardhat ${fmt(realGas)}  → match: ${BigInt(mine.gasUsed) === realGas}`);
  console.log(`   returned: ${BigInt(mine.output)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
