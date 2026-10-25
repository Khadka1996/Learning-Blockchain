const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@openzeppelin/hardhat-upgrades"); // deployProxy / upgradeProxy + storage-layout checks

// Use the solc package installed in node_modules. This keeps compilation offline
// after npm dependencies have been installed, matching the repository's Day 05 setup.
// outputSelection adds storageLayout so hardhat-upgrades can compare V1 and V2 slot by slot.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args) => {
  const solc = require("solc");
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: args.solcVersion,
    longVersion: solc.version(),
  };
});

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["storageLayout"] } },
    },
  },
};
