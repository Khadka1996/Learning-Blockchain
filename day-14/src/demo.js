"use strict";
// npm start — a guided tour of Day 14 on an in-memory Hardhat chain.
const { ethers } = require("hardhat");
const { poseidonHash, randomSecret, proveSecret, verifyOffChain, toSolidity } = require("./zk");
const { buildUserOp, signUserOp, bundle } = require("./userop");

const E = ethers.parseEther;
/** Turn a revert into a readable reason, e.g. "InvalidProof" or "AA24 signature error". */
function reason(contract, e) {
  const data = e.data ?? e.error?.data ?? e.info?.error?.data;
  try {
    const p = contract.interface.parseError(data);
    return p.name === "FailedOp" ? p.args[1] : p.name;
  } catch {
    return e.shortMessage ?? String(e);
  }
}
const short = (x) => String(x).slice(0, 12) + "…";

async function zkPart() {
  console.log("=== Part 1. Zero-knowledge: prove you know a secret without showing it ===");
  const [, alice, relayer, mallory] = await ethers.getSigners();
  const secret = randomSecret();
  const hash = await poseidonHash(secret);
  console.log("  secret (stays on Alice's laptop): 248 random bits");
  console.log("  public lock = Poseidon(secret)  :", short(hash));

  const verifier = await ethers.deployContract("SecretVerifier");
  const prize = await ethers.deployContract("ZkPrize", [verifier, hash], { value: E("1") });
  console.log("  ZkPrize deployed holding 1 ETH, it stores only the lock\n");

  const t0 = Date.now();
  const { proof, publicSignals } = await proveSecret(secret, alice.address);
  const ms = Date.now() - t0;
  const sol = toSolidity(proof);
  const proofBytes = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [sol.a, sol.b, sol.c]);
  console.log(`  Alice builds a proof in ${ms} ms — ${ethers.dataLength(proofBytes)} bytes (8 numbers), whatever the secret`);
  console.log("  public signals: [lock, Alice's address]  — the secret is not in there");
  console.log("  off-chain check with the verification key:", await verifyOffChain("secret", proof, publicSignals));

  const stolen = prize.connect(mallory).claim(sol.a, sol.b, sol.c, mallory.address);
  console.log("  Mallory copies the proof but names herself →", await stolen.then(() => "PAID?!", (e) => "rejected: " + reason(prize, e)));

  const tx = await prize.connect(relayer).claim(sol.a, sol.b, sol.c, alice.address);
  const r = await tx.wait();
  console.log(`  a relayer submits Alice's proof → Alice +1 ETH, on-chain verification + payout gas ${r.gasUsed}`);

  // Weak secrets: the lock is public, so a guessable secret can be found without any proof.
  const pin = 4821n;
  const lock = await poseidonHash(pin);
  const t1 = Date.now();
  let guess = 0n;
  while ((await poseidonHash(guess)) !== lock) guess++;
  console.log(`  BUT a 4-digit PIN as the secret: found ${guess} by trying ${guess + 1n} guesses in ${Date.now() - t1} ms`);
}

async function aaPart() {
  console.log("\n=== Part 2. Account abstraction (ERC-4337): a wallet that is a contract ===");
  const [bundler, owner, guardian, bob, newOwner] = await ethers.getSigners();
  const entryPoint = await ethers.deployContract("EntryPoint");
  const wallet = await ethers.deployContract("SmartWallet", [entryPoint, owner, guardian, E("1")]);
  await bundler.sendTransaction({ to: wallet, value: E("3") });
  console.log("  SmartWallet: 3 ETH, owner key signs, daily limit 1 ETH, guardian can recover after 2 days");
  const op = async (signer, dest, value) => signUserOp(entryPoint, await buildUserOp({ entryPoint, wallet, dest, value }), signer);

  const b0 = await ethers.provider.getBalance(bundler);
  const { receipt, events } = await bundle(entryPoint, bundler, [await op(owner, bob.address, E("0.4"))]);
  const net = (await ethers.provider.getBalance(bundler)) - b0;
  console.log(`  1. owner signs "send 0.4 ETH to Bob" → bundler → EntryPoint: success=${events[0].success}, op gas ${events[0].actualGasUsed}, bundle tx gas ${receipt.gasUsed}`);
  console.log(`     the WALLET paid the fee (${ethers.formatEther(events[0].actualGasCost)} ETH); the bundler's net: ${net >= 0n ? "+" : ""}${ethers.formatEther(net)} ETH`);

  const bad = await op(bob, bob.address, E("1"));
  console.log("  2. Bob signs for the wallet →", await entryPoint.handleOps([bad], bundler.address).then(() => "accepted?!", (e) => "rejected: " + reason(entryPoint, e)));
  const used = await op(owner, bob.address, E("0.1"));
  await bundle(entryPoint, bundler, [used]);
  console.log("  3. the same signed op sent twice →", await entryPoint.handleOps([used], bundler.address).then(() => "accepted?!", (e) => "rejected: " + reason(entryPoint, e)));
  const over = await bundle(entryPoint, bundler, [await op(owner, bob.address, E("0.6"))]);
  console.log(`  4. 0.6 ETH more today (limit left ${ethers.formatEther(await wallet.remainingToday())}) → success=${over.events[0].success} (DailyLimitExceeded)`);

  await wallet.connect(guardian).startRecovery(newOwner);
  await ethers.provider.send("evm_increaseTime", [2 * 86400]);
  await wallet.finishRecovery();
  console.log("  5. key lost → guardian starts recovery, 2 days pass → new owner:", (await wallet.owner()) === newOwner.address);
  console.log("     old key now →", await entryPoint.handleOps([await op(owner, bob.address, E("0.1"))], bundler.address).then(() => "accepted?!", (e) => "rejected: " + reason(entryPoint, e)));
}

zkPart().then(aaPart).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
