const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

// Offline compiler: use the solcjs bundled in node_modules/solc instead of downloading one
// (compiler downloads are blocked in this environment — see tools/README.md).
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args) => {
  const solc = require("solc");
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: args.solcVersion,
    longVersion: solc.version(),
  };
});

// Secrets come from a local .env file that is NEVER committed (.gitignore has it).
// Copy .env.example to .env and fill it in only when you deploy to Sepolia.
try {
  process.loadEnvFile(".env"); // Node >= 20.12, no dotenv dependency needed
} catch {
  /* no .env: fine for local work */
}
const { checkSepoliaEnv } = require("./scripts/env");

const networks = { localhost: { url: "http://127.0.0.1:8545" } };
const sepolia = checkSepoliaEnv(process.env);
if (sepolia.ok) {
  networks.sepolia = { url: sepolia.url, accounts: [sepolia.key], chainId: 11155111 };
} else if (process.argv.includes("sepolia")) {
  // Explain WHY instead of Hardhat's generic "network not found". Never prints the key.
  console.error("Sepolia is not configured: " + sepolia.problems.join("; ") + ". See .env.example.");
  process.exit(1);
}

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks,
};
