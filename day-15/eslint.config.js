"use strict";

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "no-unused-vars": "error", eqeqeq: "error", "prefer-const": "error" },
  },
  {
    files: ["frontend/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
    rules: { "no-restricted-properties": ["error", { property: "innerHTML", message: "Untrusted on-chain text: use textContent." }] },
  },
  { files: ["test/**/*.js"], languageOptions: { globals: { ...globals.mocha } } },
  { ignores: ["node_modules/", "card/", "artifacts/", "cache/", "coverage/", "frontend/vendor/", "screenshots/"] },
];
