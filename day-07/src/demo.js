// Day 07 demo: a guided tour of ERC-20 tokens on a local Hardhat chain (no real money).
//   npm start                 in-process chain
//   npm run node              (terminal 1)  then  npm run demo:localhost  (terminal 2)
const { ethers } = require("hardhat");
const { signPermit, latestTimestamp } = require("../test/helpers/permit");

const fmt = (wei) => ethers.formatUnits(wei, 18);
const line = (text = "") => console.log(text);
const title = (text) => line(`\n${text}`);
const errName = (e) => /custom error '(\w+)/.exec(e.message)?.[1] ?? e.shortMessage ?? "reverted";
const n = (x) => x.toLocaleString("en-US");

async function deploy(name, ...args) {
  const c = await (await ethers.getContractFactory(name)).deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function main() {
  const [sita, ram, hari, relayer] = await ethers.getSigners();
  const who = { [sita.address]: "Sita", [ram.address]: "Ram", [hari.address]: "Hari", [relayer.address]: "Relayer" };
  const name = (a) => who[a] ?? `${a.slice(0, 8)}…`;

  line("Day 07: ERC-20 tokens, a guided tour");
  line("Sita creates the token. Ram and Hari are users. A relayer submits transactions for others.");

  // 1. A token is a table ----------------------------------------------------------------------
  title("1. A token is just a table inside a contract");
  const mini = await deploy("MiniToken", "Mini Token", "MINI", ethers.parseEther("1000"));
  line(`   ${await mini.name()} (${await mini.symbol()}), decimals = ${await mini.decimals()}`);
  line(`   totalSupply()          ${n(await mini.totalSupply())} base units   = ${fmt(await mini.totalSupply())} MINI`);
  line(`   balanceOf(Sita)        ${fmt(await mini.balanceOf(sita.address))} MINI   (the whole supply was minted to the deployer)`);
  line("   There are no coins to hold: 'Ram owns 5 MINI' only means balanceOf[Ram] == 5 * 10^18.");

  // 2. Decimals --------------------------------------------------------------------------------
  title("2. Decimals: the chain has no fractions, so 1 token is 10^18 units");
  const third = ethers.parseEther("1") / 3n;
  line(`   1 token / 3 = ${n(third)} units each, and ${ethers.parseEther("1") - third * 3n} unit is left over (integer division rounds down)`);
  line("   Wallets divide by 10^decimals to show '0.333333333333333333'. USDC uses 6 decimals, most tokens 18.");

  // 3. transfer --------------------------------------------------------------------------------
  title("3. transfer: move tokens and announce it with an event");
  const toNew = await (await mini.transfer(ram.address, ethers.parseEther("100"))).wait();
  const toOld = await (await mini.transfer(ram.address, ethers.parseEther("10"))).wait();
  for (const l of toOld.logs) {
    const e = mini.interface.parseLog(l);
    line(`   event  ${e.name}(from=${name(e.args[0])}, to=${name(e.args[1])}, value=${fmt(e.args[2])})`);
  }
  line(`   gas: first transfer to Ram ${n(toNew.gasUsed)}   second ${n(toOld.gasUsed)}   (a NEW balance slot costs ~20,000 more, Day 05)`);
  try {
    await mini.connect(hari).transfer(ram.address, 1n);
  } catch (e) {
    line(`   Hari has nothing and tries to send 1 unit -> ${errName(e)}`);
  }

  // 4. approve + transferFrom ------------------------------------------------------------------
  title("4. approve + transferFrom: letting a CONTRACT spend your tokens");
  const vault = await deploy("TokenVault");
  const learn = await deploy("LearningToken", sita.address, ethers.parseEther("1000000"), ethers.parseEther("2000000"));
  await (await learn.transfer(ram.address, ethers.parseEther("500"))).wait();
  const vaultAddr = await vault.getAddress();
  const learnAddr = await learn.getAddress();
  try {
    await vault.connect(ram).deposit(learnAddr, ethers.parseEther("100"));
  } catch (e) {
    line(`   Ram deposits 100 without approving first -> ${errName(e)}   (a contract cannot just take tokens)`);
  }
  const ap = await (await learn.connect(ram).approve(vaultAddr, ethers.parseEther("100"))).wait();
  const apEvent = learn.interface.parseLog(ap.logs[0]);
  line(`   Ram approves the vault for 100 -> ${apEvent.name}(owner=${name(apEvent.args[0])}, spender=vault, value=${fmt(apEvent.args[2])})`);
  line(`   allowance(Ram, vault) = ${fmt(await learn.allowance(ram.address, vaultAddr))}   balance(Ram) = ${fmt(await learn.balanceOf(ram.address))}   (approve moves nothing)`);
  await (await vault.connect(ram).deposit(learnAddr, ethers.parseEther("100"))).wait();
  line(`   vault.deposit(100) -> vault pulled the tokens with transferFrom`);
  line(`   allowance(Ram, vault) = ${fmt(await learn.allowance(ram.address, vaultAddr))}   vault holds ${fmt(await learn.balanceOf(vaultAddr))}   Ram is credited ${fmt(await vault.balances(learnAddr, ram.address))}`);

  // 5. the approve race ------------------------------------------------------------------------
  title("5. The approve race: lowering an allowance can still leak the old one");
  await (await mini.transfer(hari.address, 1000n)).wait();
  await (await mini.connect(hari).approve(relayer.address, 100n)).wait();
  await (await mini.connect(relayer).transferFrom(hari.address, relayer.address, 100n)).wait(); // front-runs the change
  await (await mini.connect(hari).approve(relayer.address, 50n)).wait(); // Hari's 'lower it to 50' lands second
  await (await mini.connect(relayer).transferFrom(hari.address, relayer.address, 50n)).wait();
  line("   Hari approves a spender for 100, then sends 'approve 50' to lower it.");
  line(`   The spender front-runs with transferFrom(100), then spends the NEW 50 too -> took ${await mini.balanceOf(relayer.address)} units (Hari meant 100 or 50).`);
  line("   Fix: change allowances with increase/decrease, or compare-and-set (exercise 5), or use permit.");

  // 6. unlimited approval ----------------------------------------------------------------------
  title("6. The unlimited approval (2^256 - 1)");
  await (await mini.connect(hari).approve(relayer.address, ethers.MaxUint256)).wait();
  await mini.transfer(hari.address, 40n);
  await (await mini.connect(relayer).transferFrom(hari.address, relayer.address, 40n)).wait();
  line(`   After spending, allowance is still ${(await mini.allowance(hari.address, relayer.address)) === ethers.MaxUint256 ? "2^256 - 1 (never reduced, saves gas)" : "reduced"}`);
  line("   Convenient, but if that spender is ever hacked, every token Hari holds NOW or LATER is exposed.");

  // 7. permit ----------------------------------------------------------------------------------
  title("7. permit (EIP-2612): approve with a SIGNATURE instead of a transaction");
  const deadline = (await latestTimestamp()) + 3600;
  const first = await signPermit(learn, ram, vaultAddr, ethers.parseEther("50"), deadline);
  line(`   Ram signs off-chain (the Day 03 kind of signature): v=${first.v} r=${first.r.slice(0, 12)}… s=${first.s.slice(0, 12)}…`);
  line(`   Ram's nonce: ${await learn.nonces(ram.address)}   allowance(Ram, vault): ${fmt(await learn.allowance(ram.address, vaultAddr))}`);
  await (await learn.connect(relayer).permit(ram.address, vaultAddr, ethers.parseEther("50"), deadline, first.v, first.r, first.s)).wait();
  line(`   The RELAYER submits it and pays the gas. Ram sent no transaction, yet allowance = ${fmt(await learn.allowance(ram.address, vaultAddr))}, nonce = ${await learn.nonces(ram.address)}.`);
  try {
    await learn.permit(ram.address, vaultAddr, ethers.parseEther("50"), deadline, first.v, first.r, first.s);
  } catch (e) {
    line(`   Replaying the same signature -> ${errName(e)}   (the nonce was used up)`);
  }
  const second = await signPermit(learn, ram, vaultAddr, ethers.parseEther("50"), deadline);
  await (await vault.connect(ram).depositWithPermit(learnAddr, ethers.parseEther("50"), deadline, second.v, second.r, second.s)).wait();
  line(`   Or Ram signs again and calls depositWithPermit: approve + deposit in ONE transaction. Vault now credits Ram ${fmt(await vault.balances(learnAddr, ram.address))}.`);

  // 8. weird tokens ----------------------------------------------------------------------------
  title("8. Tokens that do not behave: what a vault must survive");
  const fee = await deploy("FeeToken", ethers.parseEther("1000000"));
  const naive = await deploy("NaiveTokenVault");
  await (await fee.transfer(ram.address, 2000n)).wait();
  await (await fee.transfer(hari.address, 2000n)).wait();
  for (const user of [ram, hari]) {
    await (await fee.connect(user).approve(await naive.getAddress(), 1000n)).wait();
    await (await naive.connect(user).deposit(await fee.getAddress(), 1000n)).wait();
  }
  line("   Fee token (1% burned on every transfer), two users deposit 1000 each:");
  line(`      NAIVE vault  holds ${await fee.balanceOf(await naive.getAddress())} but credited 2000`);
  await (await naive.connect(ram).withdraw(await fee.getAddress(), 1000n)).wait();
  try {
    await naive.connect(hari).withdraw(await fee.getAddress(), 1000n);
  } catch {
    line("         the first user withdraws fine; the LAST user is robbed (withdraw reverts)");
  }
  await (await fee.connect(ram).approve(vaultAddr, 1000n)).wait();
  const dep = await (await vault.connect(ram).deposit(await fee.getAddress(), 1000n)).wait();
  const dEvent = vault.interface.parseLog(dep.logs.find((l) => vault.interface.parseLog(l)?.name === "Deposited"));
  line(`      TokenVault   credits what ARRIVED: requested ${dEvent.args.requested}, received ${dEvent.args.received}, solvent = ${await vault.solvencyCheck(await fee.getAddress())}`);

  const usdt = await deploy("NoReturnToken", 1_000_000n);
  await (await usdt.transfer(ram.address, 1000n)).wait();
  await (await usdt.connect(ram).approve(vaultAddr, 500n)).wait();
  await (await vault.connect(ram).deposit(await usdt.getAddress(), 500n)).wait();
  line("   USDT-style token (returns nothing): TokenVault deposits fine through SafeERC20.");

  const liar = await deploy("FalseReturnToken", 1000n);
  try {
    await vault.connect(ram).deposit(await liar.getAddress(), 500n);
  } catch (e) {
    line(`   Token that returns false instead of reverting -> ${errName(e)} (nothing credited)`);
  }

  // 9. callback token --------------------------------------------------------------------------
  title("9. A token with a callback hook (ERC-777 style) tries to re-enter the vault");
  const hook = await deploy("HookToken", ethers.parseEther("1000"));
  const attacker = await deploy("HookAttacker", vaultAddr, await hook.getAddress());
  await (await hook.transfer(await attacker.getAddress(), 1000n)).wait();
  await (await attacker.attack(400n)).wait();
  const sel = await attacker.lastRevertSelector();
  line(`   The hook fired: ${await attacker.reentered()}. Its second withdraw was refused with ${vault.interface.getError(sel)?.name ?? sel}.`);
  line(`   Inside the callback it saw vault balance ${await attacker.seenBalance()} and total ${await attacker.seenTotal()}: effects were already applied.`);

  // 10. raw storage ----------------------------------------------------------------------------
  title("10. Where the balances live (Day 05's lockers, read raw)");
  const addr = await mini.getAddress();
  const slot = (i) => ethers.provider.getStorage(addr, i);
  const keyOf = (a, i) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [a, i]));
  line(`   slot 2  totalSupply          = ${fmt(BigInt(await slot(2)))} MINI`);
  line(`   slot 3  balanceOf (base)     = ${await slot(3) === ethers.toBeHex(0, 32) ? "empty on purpose" : "?"}`);
  line(`   balanceOf[Ram] at keccak256(Ram, 3) = ${keyOf(ram.address, 3).slice(0, 14)}… -> ${fmt(BigInt(await ethers.provider.getStorage(addr, keyOf(ram.address, 3))))} MINI`);
  line("   slot 4  allowance (base): allowance[owner][spender] at keccak256(spender, keccak256(owner, 4))");

  // 11. cap, mint, burn ------------------------------------------------------------------------
  title("11. LearningToken: cap, mint, burn");
  const small = await deploy("LearningToken", sita.address, ethers.parseEther("900"), ethers.parseEther("1000"));
  try {
    await small.connect(ram).mint(ram.address, 1n);
  } catch (e) {
    line(`   Ram tries to mint -> ${errName(e)} (only the owner may)`);
  }
  await (await small.mint(sita.address, ethers.parseEther("100"))).wait();
  try {
    await small.mint(sita.address, 1n);
  } catch (e) {
    line(`   Supply is at the cap (${fmt(await small.totalSupply())}); minting 1 more unit -> ${errName(e)}`);
  }
  await (await small.burn(ethers.parseEther("10"))).wait();
  line(`   After Sita burns 10, totalSupply = ${fmt(await small.totalSupply())} and there is room under the cap again.`);

  line("\nDone. Everything above ran on a local chain: no real money, no testnet.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
