// Day 06 demo: a guided tour of LearningVault on a local Hardhat chain (no real money).
//   npm start                 in-process chain
//   npm run node              (terminal 1)  then  npm run demo:localhost  (terminal 2)
const { ethers } = require("hardhat");

const eth = (wei) => ethers.formatEther(wei);
const short = (a) => `${a.slice(0, 8)}…`;
const line = (text = "") => console.log(text);
const title = (text) => line(`\n${text}`);

async function deploy(name, ...args) {
  const contract = await (await ethers.getContractFactory(name)).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function decode(receipt, contract) {
  return receipt.logs.map((l) => contract.interface.parseLog(l)).filter(Boolean);
}

async function main() {
  const [sita, ram, hari] = await ethers.getSigners();
  const names = { [sita.address]: "Sita", [ram.address]: "Ram", [hari.address]: "Hari" };
  const who = (a) => names[a] || short(a);

  line("Day 06: Solidity fundamentals, a tour of LearningVault");
  line("Sita deploys and owns the vault. Ram and Hari are users.");

  // 1. Deploy -------------------------------------------------------------------------------
  title("1. Deploy");
  const vault = await deploy("LearningVault");
  const address = await vault.getAddress();
  const deployReceipt = await vault.deploymentTransaction().wait();
  const code = await ethers.provider.getCode(address);
  line(`   address        ${address}`);
  line(`   deploy gas     ${deployReceipt.gasUsed.toLocaleString("en-US")}`);
  line(`   runtime code   ${(code.length - 2) / 2} bytes   (the constructor ran once and is gone)`);
  line(`   owner()        ${who(await vault.owner())}   (immutable: lives in the bytecode, not in storage)`);
  for (const e of decode(deployReceipt, vault)) {
    line(`   event          ${e.name}(previousOwner=${short(e.args[0])}, newOwner=${who(e.args[1])})`);
  }

  // 2. Deposit ------------------------------------------------------------------------------
  title("2. Deposit: payable function + event");
  const r1 = await (await vault.connect(ram).deposit({ value: ethers.parseEther("1") })).wait();
  const r2 = await (await vault.connect(ram).deposit({ value: ethers.parseEther("0.5") })).wait();
  await (await vault.connect(hari).deposit({ value: ethers.parseEther("2") })).wait();
  for (const e of decode(r2, vault)) {
    line(`   event          ${e.name}(account=${who(e.args.account)}, amount=${eth(e.args.amount)}, newBalance=${eth(e.args.newBalance)})`);
  }
  line(`   Ram's first deposit  ${r1.gasUsed.toLocaleString("en-US")} gas   (creates his storage slot: 0 -> value)`);
  line(`   Ram's second deposit ${r2.gasUsed.toLocaleString("en-US")} gas   (only changes it: value -> value)`);
  line(`   balances(Ram) ${eth(await vault.balances(ram.address))} ETH · balances(Hari) ${eth(await vault.balances(hari.address))} ETH · totalDeposits ${eth(await vault.totalDeposits())} ETH`);

  // 3. Raw storage --------------------------------------------------------------------------
  title("3. Storage: the 32-byte lockers from Day 05, read raw with eth_getStorageAt");
  const slot = (i) => ethers.provider.getStorage(address, i);
  const names4 = ["paused", "_status (reentrancy guard)", "balances (mapping base)", "totalDeposits"];
  for (let i = 0; i < 4; i += 1) {
    const value = await slot(i);
    const note = i === 3 ? `= ${eth(BigInt(value))} ETH` : i === 2 ? "empty on purpose" : `= ${BigInt(value)}`;
    line(`   slot ${i}  ${value.slice(0, 10)}…${value.slice(-6)}  ${names4[i]} ${note}`);
  }
  const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ram.address, 2]));
  line(`   balances[Ram] lives at keccak256(Ram, 2) = ${key.slice(0, 14)}…  -> ${eth(BigInt(await slot(key)))} ETH`);
  line("   (owner is not in any slot: an immutable is copied into the bytecode)");

  // 4. Withdraw + CEI -----------------------------------------------------------------------
  title("4. Withdraw: checks -> effects -> interaction");
  const w = await (await vault.connect(ram).withdraw(ethers.parseEther("0.5"))).wait();
  for (const e of decode(w, vault)) {
    line(`   event          ${e.name}(account=${who(e.args.account)}, amount=${eth(e.args.amount)}, remaining=${eth(e.args.newBalance)})`);
  }
  line(`   withdraw gas   ${w.gasUsed.toLocaleString("en-US")}   (guard flips 1 <-> 2, never back to 0)`);
  for (const [label, call] of [
    ["Ram asks for more than he has   ", () => vault.connect(ram).withdraw(ethers.parseEther("9"))],
    ["Ram asks for 0                  ", () => vault.connect(ram).withdraw(0n)],
    ["Hari tries Ram's money          ", () => vault.connect(hari).withdraw(ethers.parseEther("2.5"))],
  ]) {
    try {
      await call();
    } catch (error) {
      line(`   ${label} -> ${/custom error '(\w+)/.exec(error.message)[1]}`);
    }
  }

  // 5. Pause --------------------------------------------------------------------------------
  title("5. Pause: stops deposits, never withdrawals");
  await (await vault.connect(sita).setPaused(true)).wait();
  try {
    await vault.connect(ram).deposit({ value: 1n });
  } catch (error) {
    line(`   Ram deposits while paused   -> ${/custom error '(\w+)/.exec(error.message)[1]}`);
  }
  try {
    await vault.connect(ram).setPaused(false);
  } catch (error) {
    line(`   Ram tries to unpause        -> ${/custom error '(\w+)/.exec(error.message)[1]}`);
  }
  await (await vault.connect(hari).withdraw(ethers.parseEther("2"))).wait();
  line("   Hari withdraws 2 ETH while paused -> works (the owner cannot lock honest users in)");
  await (await vault.connect(sita).setPaused(false)).wait();

  // 6. Reentrancy ---------------------------------------------------------------------------
  title("6. Reentrancy: the same attacker against two vaults");
  const bad = await deploy("VulnerableVault");
  await (await bad.connect(hari).deposit({ value: ethers.parseEther("5") })).wait();
  const attackerA = await deploy("ReentrantAttacker", await bad.getAddress());
  await (await attackerA.attack({ value: ethers.parseEther("1") })).wait();
  line("   VulnerableVault (sends first, updates after), victim has 5 ETH, attacker stakes 1 ETH:");
  line(`      attacker ends with ${eth(await ethers.provider.getBalance(await attackerA.getAddress()))} ETH after ${await attackerA.reentries()} re-entries · vault holds ${eth(await ethers.provider.getBalance(await bad.getAddress()))} ETH   <- drained`);

  const good = await deploy("LearningVault");
  await (await good.connect(hari).deposit({ value: ethers.parseEther("5") })).wait();
  const attackerB = await deploy("ReentrantAttacker", await good.getAddress());
  await (await attackerB.attack({ value: ethers.parseEther("1") })).wait();
  const selector = await attackerB.lastRevertSelector();
  const refused = good.interface.getError(selector)?.name;
  line("   LearningVault (updates first + nonReentrant), same attack:");
  line(`      re-entry refused with ${refused} · attacker ends with ${eth(await ethers.provider.getBalance(await attackerB.getAddress()))} ETH (its own stake) · vault still holds ${eth(await ethers.provider.getBalance(await good.getAddress()))} ETH`);

  // 7. Failing payout -----------------------------------------------------------------------
  title("7. A payout that fails reverts everything");
  const rejecting = await deploy("RejectingReceiver");
  await (await rejecting.depositInto(await good.getAddress(), { value: 1000n })).wait();
  try {
    await rejecting.withdrawFrom(await good.getAddress(), 1000n);
  } catch (error) {
    line(`   contract with no receive() asks for its money -> ${/custom error '(\w+)/.exec(error.message)[1]}`);
  }
  line(`   its recorded balance is still ${await good.balances(await rejecting.getAddress())} wei (the state change was rolled back)`);

  // 8. StudyLog -----------------------------------------------------------------------------
  title("8. StudyLog: Solidity's building blocks (struct, enum, array, mapping, calldata)");
  const log = await deploy("StudyLog");
  await (await log.addTopic("Hashing & SHA-256", 1)).wait();
  await (await log.addTopic("Ethereum & the EVM", 5)).wait();
  await (await log.addTopic("Solidity fundamentals", 6)).wait();
  await (await log.setStatus(0, 2)).wait();
  await (await log.setStatus(1, 2)).wait();
  await (await log.setStatus(2, 1)).wait();
  const statusName = ["Planned", "Learning", "Done"];
  for (let i = 0n; i < (await log.topicCount()); i += 1n) {
    const t = await log.getTopic(i);
    line(`   #${i}  day ${String(t.day).padStart(2, "0")}  ${statusName[Number(t.status)].padEnd(8)} ${t.name}`);
  }
  line(`   done: ${await log.countByStatus(2)} · learning: ${await log.countByStatus(1)} · planned: ${await log.countByStatus(0)}`);
  try {
    await log.addTopic("Hashing & SHA-256", 2);
  } catch (error) {
    line(`   adding a duplicate -> ${/custom error '(\w+)/.exec(error.message)[1]}`);
  }

  title("Done. Everything above ran on a local chain: no real money, no testnet.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
