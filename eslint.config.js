const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");
const globals = require("globals");

// Jest globals for test files
const jestGlobals = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  jest: "readonly",
  fit: "readonly",
  xdescribe: "readonly",
  xit: "readonly",
  xtest: "readonly",
};

// Custom globals used in the app
const customGlobals = {
  warnIfDev: "readonly",
  errorIfDev: "readonly",
  __d: "readonly", // Metro bundler internal function
  __filename: "readonly", // Node.js global (may be used in some contexts)
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist*/**",
      "dist-*/**",
      "scripts/**",
      "**/node_modules/**",
      "**/*.generated.js",
      "**/*.bundle.js",
      "**/metro-cache/**",
      "**/.expo/**",
      "coverage/**",
      "docs/**",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...jestGlobals,
        ...customGlobals,
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "no-unused-expressions": "off", // Disable for JSX files
      "no-var": "error", // Enforce let/const instead of var
      eqeqeq: ["error", "always"], // Enforce strict equality
      "import/namespace": ["error", { allowComputed: true }],
    },
  },
  {
    files: ["jest.setup.js", "**/*.test.js", "__tests__/**/*.js"],
    languageOptions: {
      globals: { ...jestGlobals },
    },
  },
  {
    files: ["Playground/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]);
