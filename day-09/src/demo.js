// Day 09 guided tour: five classic smart-contract bugs, each exploited and then fixed,
// on a local Hardhat chain (no real money).
//   npm start                    (in-process chain)
//   npm run demo:localhost       (against `npm run node`)
const { ethers } = require("hardhat");
const { pauseMining, resumeMining, mineBlock, spyOnMempool, tip, statusOf } = require("../test/helpers");

const fmt = (wei) => `${ethers.formatEther(wei)} ETH`;
const n = (x) => Number(x).toLocaleString("en-US");
const line = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
const bal = async (c) => ethers.provider.getBalance(typeof c === "string" ? c : await c.getAddress());
const reason = async (p) => {
  try {
    await p;
    return "no revert";
  } catch (e) {
    if (e.revert) return e.revert.name;
    const m = /custom error '(\w+)\(/.exec(e.message || "");
    return m ? m[1] : e.shortMessage || e.message;
  }
};

async function main() {
  const [, alice, bob, thief, carol] = await ethers.getSigners();

  // ------------------------------------------------------------------ 1
  line("1. Re-entrancy: paying out BEFORE updating the balance");
  for (const name of ["VulnerableBank", "SafeBank"]) {
    const bank = await ethers.deployContract(name);
    await bank.connect(alice).deposit({ value: ethers.parseEther("6") });
    await bank.connect(bob).deposit({ value: ethers.parseEther("4") });
    const attacker = await ethers.deployContract("ReentrancyAttacker", [await bank.getAddress()], thief);
    const before = await bal(thief.address);
    const r = await (await attacker.connect(thief).attack({ value: ethers.parseEther("1") })).wait();
    const profit = (await bal(thief.address)) + r.gasUsed * r.gasPrice - before;
    console.log(
      `   ${name.padEnd(14)} thief deposits 1 ETH -> re-entries ${await attacker.reentries()}, refused ${await attacker.refused()}, ` +
        `bank left with ${fmt(await bal(bank))}, thief profit ${fmt(profit)}`,
    );
  }
  const v = await ethers.deployContract("VulnerableBank");
  const s = await ethers.deployContract("SafeBank");
  await v.connect(alice).deposit({ value: 1n });
  await s.connect(alice).deposit({ value: 1n });
  const gV = (await (await v.connect(alice).withdraw()).wait()).gasUsed;
  const gS = (await (await s.connect(alice).withdraw()).wait()).gasUsed;
  console.log(`   Cost of safety: withdraw ${n(gV)} gas (vulnerable) vs ${n(gS)} gas (safe, +${n(gS - gV)} for the lock and an event)`);

  // ------------------------------------------------------------------ 2
  line("2. Access control: an initialize() anyone can call");
  const vw = await ethers.deployContract("VulnerableWallet");
  await vw.initialize(alice.address);
  await alice.sendTransaction({ to: await vw.getAddress(), value: ethers.parseEther("5") });
  await vw.connect(thief).initialize(thief.address);
  await vw.connect(thief).withdrawAll(thief.address);
  console.log(`   VulnerableWallet: thief calls initialize(thief), owner is now thief: ${(await vw.owner()) === thief.address}; wallet left with ${fmt(await bal(vw))}`);
  const sw = await ethers.deployContract("SafeWallet", [alice.address]);
  await alice.sendTransaction({ to: await sw.getAddress(), value: ethers.parseEther("5") });
  console.log(`   SafeWallet: thief calls withdrawAll -> ${await reason(sw.connect(thief).withdrawAll(thief.address))}; wallet keeps ${fmt(await bal(sw))}`);

  // ------------------------------------------------------------------ 3
  line("3. tx.origin: a fake 'claim your airdrop' button");
  for (const name of ["TxOriginWallet", "MsgSenderWallet"]) {
    const w = await ethers.deployContract(name, [], alice);
    await alice.sendTransaction({ to: await w.getAddress(), value: ethers.parseEther("5") });
    const trap = await ethers.deployContract("PhishingAirdrop", [await w.getAddress()], thief);
    const outcome = await reason(trap.connect(alice).claim());
    console.log(`   ${name.padEnd(15)} Alice clicks claim() -> ${outcome === "no revert" ? "wallet emptied" : `refused (${outcome})`}; wallet holds ${fmt(await bal(w))}`);
  }

  // ------------------------------------------------------------------ 4
  line("4. Front-running: a bot copies your answer from the waiting room (mempool)");
  const ANSWER = "satoshi";
  const hash = ethers.keccak256(ethers.toUtf8Bytes(ANSWER));
  const puzzle = await ethers.deployContract("HashPuzzle", [hash], { value: ethers.parseEther("2") });
  await pauseMining();
  const aliceTx = await puzzle.connect(alice).solve(ANSWER, tip(2));
  const seen = await spyOnMempool(puzzle, "solve");
  console.log(`   Bot reads Alice's pending transaction: solve("${seen.args[0]}") with a 2 gwei tip`);
  const botTx = await puzzle.connect(thief).solve(seen.args[0], tip(50));
  await mineBlock();
  await resumeMining();
  const [a, b] = [await statusOf(aliceTx), await statusOf(botTx)];
  console.log(`   Bot resends it with a 50 gwei tip. In the block: bot at position ${b.index} (${b.ok ? "WINS 2 ETH" : "fails"}), Alice at position ${a.index} (${a.ok ? "wins" : "fails: AlreadySolved"})`);

  const cr = await ethers.deployContract("CommitRevealPuzzle", [hash], { value: ethers.parseEther("2") });
  const salt = ethers.hexlify(ethers.randomBytes(32));
  await cr.connect(alice).commit(await cr.makeCommitment(alice.address, ANSWER, salt));
  console.log("   Commit-reveal: Alice first sends a sealed envelope keccak256(her address, answer, salt)");
  await pauseMining();
  const reveal = await cr.connect(alice).reveal(ANSWER, salt, tip(2));
  const seen2 = await spyOnMempool(cr, "reveal");
  const copy = await cr.connect(thief).reveal(seen2.args[0], seen2.args[1], tip(50));
  await mineBlock();
  await resumeMining();
  console.log(`   Next block she reveals. Bot copies it with a higher tip -> ${(await statusOf(copy)).ok ? "wins" : "fails (NoCommitment)"}; Alice ${(await statusOf(reveal)).ok ? "wins the 2 ETH" : "fails"}`);

  // ------------------------------------------------------------------ 5
  line("5. Denial of service: one refund that always fails");
  for (const name of ["KingOfTheHill", "SafeKingOfTheHill"]) {
    const game = await ethers.deployContract(name);
    await game.connect(alice).claimThrone({ value: ethers.parseEther("1") });
    const stubborn = await ethers.deployContract("StubbornKing", [], thief);
    await stubborn.connect(thief).seize(await game.getAddress(), { value: ethers.parseEther("1.5") });
    const r1 = await reason(game.connect(bob).claimThrone({ value: ethers.parseEther("3") }));
    const r2 = await reason(game.connect(carol).claimThrone({ value: ethers.parseEther("10") }));
    const king = (await game.king()) === (await stubborn.getAddress()) ? "the stubborn contract (forever)" : "Carol";
    console.log(`   ${name.padEnd(17)} Bob bids 3 ETH -> ${r1 === "no revert" ? "ok" : r1}; Carol bids 10 ETH -> ${r2 === "no revert" ? "ok" : r2}; king = ${king}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
