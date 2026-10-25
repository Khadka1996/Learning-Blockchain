"use strict";
const { ethers } = require("hardhat");

/** Runs a tx; returns { ok, error } where error is the decoded custom error / reason name. */
async function attempt(promise, iface) {
  try {
    const tx = await promise;
    await tx.wait();
    return { ok: true };
  } catch (e) {
    const data = e?.data ?? e?.error?.data ?? e?.info?.error?.data;
    let name = e.reason || e.shortMessage || "revert";
    if (iface && typeof data === "string" && data.length >= 10) {
      try {
        name = iface.parseError(data).name;
      } catch {
        /* not a custom error of this contract */
      }
    }
    return { ok: false, error: name };
  }
}

async function fundedWallets(n, funder) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await funder.sendTransaction({ to: w.address, value: ethers.parseEther("10") });
    out.push(w);
  }
  return out;
}

module.exports = { attempt, fundedWallets };
