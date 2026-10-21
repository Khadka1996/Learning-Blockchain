const { ethers } = require("hardhat");

/** Sign an EIP-2612 Permit for `token` (a Day 03 signature, now used to approve spending). */
async function signPermit(token, owner, spender, value, deadline, nonceOverride) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = nonceOverride ?? (await token.nonces(owner.address));
  const domain = {
    name: await token.name(),
    version: "1",
    chainId,
    verifyingContract: await token.getAddress(),
  };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const signature = await owner.signTypedData(domain, types, {
    owner: owner.address,
    spender,
    value,
    nonce,
    deadline,
  });
  const { v, r, s } = ethers.Signature.from(signature);
  return { v, r, s, domain, types };
}

async function latestTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

module.exports = { signPermit, latestTimestamp };
