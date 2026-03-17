const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "scripts/*"],
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
]);
