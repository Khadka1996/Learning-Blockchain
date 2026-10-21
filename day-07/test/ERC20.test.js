const { ethers } = require("hardhat");
const { shouldBehaveLikeERC20 } = require("./helpers/erc20-behaviour");

const SUPPLY = ethers.parseEther("1000");
const CAP = ethers.parseEther("1000000");

// One behaviour suite, three implementations: if MiniToken, OpenZeppelin and LearningToken all
// pass the SAME checks, those checks describe "ERC-20", not one particular contract.
const implementations = {
  "MiniToken (hand-written)": async () => {
    const [holder] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MiniToken")).deploy("Mini Token", "MINI", SUPPLY);
    await token.waitForDeployment();
    return { token, holder, supply: SUPPLY };
  },
  "OZReference (plain OpenZeppelin ERC20)": async () => {
    const [holder] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("OZReference")).deploy("Reference", "REF", SUPPLY);
    await token.waitForDeployment();
    return { token, holder, supply: SUPPLY };
  },
  "LearningToken (OpenZeppelin + cap + permit + owner)": async () => {
    const [holder] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("LearningToken")).deploy(holder.address, SUPPLY, CAP);
    await token.waitForDeployment();
    return { token, holder, supply: SUPPLY };
  },
};

for (const [name, deploy] of Object.entries(implementations)) {
  describe(`ERC-20 behaviour: ${name}`, function () {
    shouldBehaveLikeERC20(deploy);
  });
}
