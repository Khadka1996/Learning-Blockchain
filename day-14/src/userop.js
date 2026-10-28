"use strict";
// Build, sign and send ERC-4337 v0.7 "PackedUserOperation"s — the job a wallet app + bundler do.
const { ethers } = require("ethers");

/** Two 128-bit numbers packed into one bytes32: (high << 128) | low. */
const pack128 = (high, low) => ethers.toBeHex((BigInt(high) << 128n) | BigInt(low), 32);

const DEFAULT_GAS = {
  verificationGasLimit: 150_000n, // budget for validateUserOp
  callGasLimit: 100_000n, // budget for execute
  preVerificationGas: 50_000n, // bundler overhead (calldata etc.)
  maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
  maxFeePerGas: ethers.parseUnits("2", "gwei"),
};

/**
 * A UserOperation is a "wish" the owner signs: "wallet X, please call execute(dest, value, data)".
 * It is NOT an Ethereum transaction: a bundler wraps many of them into one handleOps() transaction.
 */
async function buildUserOp({ entryPoint, wallet, dest, value = 0n, data = "0x", gas = {}, nonce }) {
  const g = { ...DEFAULT_GAS, ...gas };
  const sender = await wallet.getAddress();
  return {
    sender,
    nonce: nonce ?? (await entryPoint.getNonce(sender, 0)),
    initCode: "0x", // wallet already deployed (a factory + initCode would deploy it on first use)
    callData: wallet.interface.encodeFunctionData("execute", [dest, value, data]),
    accountGasLimits: pack128(g.verificationGasLimit, g.callGasLimit),
    preVerificationGas: g.preVerificationGas,
    gasFees: pack128(g.maxPriorityFeePerGas, g.maxFeePerGas),
    paymasterAndData: "0x",
    signature: "0x",
  };
}

/**
 * The owner signs getUserOpHash(op). That hash includes the EntryPoint address and the chain id,
 * so a signed op can't be replayed on another chain or another EntryPoint.
 */
async function signUserOp(entryPoint, op, signer) {
  const hash = await entryPoint.getUserOpHash(op);
  return { ...op, signature: await signer.signMessage(ethers.getBytes(hash)) };
}

/** Play the bundler: submit ops via handleOps and collect the UserOperationEvent for each. */
async function bundle(entryPoint, bundler, ops) {
  const tx = await entryPoint.connect(bundler).handleOps(ops, bundler.address);
  const receipt = await tx.wait();
  const events = receipt.logs
    .map((l) => { try { return entryPoint.interface.parseLog(l); } catch { return null; } })
    .filter((e) => e && e.name === "UserOperationEvent")
    .map((e) => ({ success: e.args.success, actualGasCost: e.args.actualGasCost, actualGasUsed: e.args.actualGasUsed, nonce: e.args.nonce }));
  return { receipt, events };
}

module.exports = { pack128, buildUserOp, signUserOp, bundle, DEFAULT_GAS };
