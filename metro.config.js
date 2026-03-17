const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Firebase Auth + Expo Router compatibility:
// force Metro to resolve Firebase modules using legacy behavior.
config.resolver.unstable_enablePackageExports = false;
if (!config.resolver.sourceExts.includes("cjs")) {
  config.resolver.sourceExts.push("cjs");
}

module.exports = config;
