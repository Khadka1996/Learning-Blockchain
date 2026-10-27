"use strict";
// npm run check:env — validate .env for Sepolia WITHOUT deploying and without printing the key.
try { process.loadEnvFile(".env"); } catch { /* no .env file */ }
const { checkSepoliaEnv } = require("./env");
const r = checkSepoliaEnv(process.env);
if (r.ok) console.log("Sepolia settings look valid (key not shown).");
else {
  console.log("Sepolia is not ready:\n - " + r.problems.join("\n - "));
  process.exitCode = 1;
}
