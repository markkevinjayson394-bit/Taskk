const {
  getSentryExpoConfig,
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Firebase Auth + Expo Router compatibility:
// force Metro to resolve Firebase modules using legacy behavior.
config.resolver.unstable_enablePackageExports = false;
if (!config.resolver.sourceExts.includes("cjs")) {
  config.resolver.sourceExts.push("cjs");
}

// Export/build stability on constrained or locked-down Windows environments:
// Metro only spawns jest-worker child processes when maxWorkers > 1.
// Keeping this at 1 avoids child-process spawn failures (EPERM/SIGTERM).
config.maxWorkers = 1;

module.exports = config;
