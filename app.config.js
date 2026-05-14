// Load local env files for local EAS Update/Build runs.
// On EAS cloud, use `eas env` variables for each environment.
try {
  const fs = require("fs");
  const path = require("path");
  const dotenv = require("dotenv");

  // Try multiple root paths
  const possibleRoots = [
    path.dirname(__filename),
    process.cwd(),
    path.resolve(__dirname),
  ];

  const envFiles = [".env.local", ".env"];

  for (const root of possibleRoots) {
    for (const file of envFiles) {
      const fullPath = path.resolve(root, file);
      if (fs.existsSync(fullPath)) {
        dotenv.config({ path: fullPath, override: false });
      }
    }
  }
} catch {
  // Best effort only; config continues with existing process.env values.
}

const normalizeFirebaseValue = (value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  if (unquoted.startsWith("${") && unquoted.endsWith("}")) {
    return "";
  }
  if (unquoted === "undefined" || unquoted === "null") {
    return "";
  }
  return unquoted;
};

const getEnv = (key) => normalizeFirebaseValue(process.env[key]);
const getExtra = (extra, key) => normalizeFirebaseValue(extra?.firebase?.[key]);
const getFirstEnv = (...keys) => {
  for (const key of keys) {
    const value = getEnv(key);
    if (value) {
      return value;
    }
  }
  return "";
};

const FIREBASE_ENV_MAP = {
  apiKey: ["EXPO_PUBLIC_FIREBASE_API_KEY", "FIREBASE_API_KEY"],
  authDomain: ["EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "FIREBASE_AUTH_DOMAIN"],
  projectId: ["EXPO_PUBLIC_FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID"],
  storageBucket: [
    "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "FIREBASE_STORAGE_BUCKET",
  ],
  messagingSenderId: [
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_MESSAGING_SENDER_ID",
  ],
  appId: ["EXPO_PUBLIC_FIREBASE_APP_ID", "FIREBASE_APP_ID"],
};

module.exports = ({ config }) => {
  const base = config || {};
  const baseExtra = base.extra || {};
  const sentryDsn =
    getEnv("SENTRY_DSN") || normalizeFirebaseValue(baseExtra?.sentryDsn);
  const buildProfile =
    normalizeFirebaseValue(process.env.EAS_BUILD_PROFILE) ||
    normalizeFirebaseValue(baseExtra?.buildProfile) ||
    "development";
  const startupOtaEnabled = buildProfile === "production";
  const easProjectId =
    normalizeFirebaseValue(process.env.EAS_PROJECT_ID) ||
    normalizeFirebaseValue(baseExtra?.eas?.projectId);

  const firebase = {
    apiKey:
      getFirstEnv(...FIREBASE_ENV_MAP.apiKey) || getExtra(baseExtra, "apiKey"),
    authDomain:
      getFirstEnv(...FIREBASE_ENV_MAP.authDomain) ||
      getExtra(baseExtra, "authDomain"),
    projectId:
      getFirstEnv(...FIREBASE_ENV_MAP.projectId) ||
      getExtra(baseExtra, "projectId"),
    storageBucket:
      getFirstEnv(...FIREBASE_ENV_MAP.storageBucket) ||
      getExtra(baseExtra, "storageBucket"),
    messagingSenderId:
      getFirstEnv(...FIREBASE_ENV_MAP.messagingSenderId) ||
      getExtra(baseExtra, "messagingSenderId"),
    appId:
      getFirstEnv(...FIREBASE_ENV_MAP.appId) || getExtra(baseExtra, "appId"),
  };

  return {
    ...base,
    name: "CTU Academic Task Manager",
    slug: "taskmanagement",
    version: "1.0.3",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "ctuacademictaskmanager",
    owner: "ikema2004",
    userInterfaceStyle: "automatic",
    androidStatusBar: {
      barStyle: "light-content",
      translucent: true,
      backgroundColor: "#0057D9",
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      softwareKeyboardLayoutMode: "pan",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0057D9",
      },
      predictiveBackGestureEnabled: true,
      package: "com.ctudanao.timemanager",
      permissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.CAMERA",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.RECORD_AUDIO",
        "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
        "android.permission.SCHEDULE_EXACT_ALARM",
        "android.permission.USE_FULL_SCREEN_INTENT",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.WAKE_LOCK",
      ],
    },
    notification: {
      icon: "./assets/images/android-icon-monochrome.png",
      color: "#0057D9",
    },
    web: {
      output: "static",
      favicon: "./assets/icon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#0057D9",
          dark: {
            backgroundColor: "#001A4D",
          },
        },
      ],
      "expo-web-browser",
      [
        "expo-notifications",
        {
          sounds: [
            "./assets/sounds/ctu_alarm.wav",
            "./assets/sounds/ctu_reminder.wav",
          ],
        },
      ],
      "expo-task-manager",
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 36, // ✅ changed from 34
            targetSdkVersion: 35, // ✅ changed from 34
            minSdkVersion: 24,
          },
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission:
            "CTU Academic Task Manager needs access to your photos to set a profile picture.",
          cameraPermission:
            "CTU Academic Task Manager needs access to your camera to take a profile picture.",
        },
      ],
      "@react-native-community/datetimepicker",
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: "react-native",
          organization: "mark-kevin-jayson",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
    },
    extra: {
      ...baseExtra,
      sentryDsn,
      buildProfile,
      startupOtaEnabled,
      router: {},
      eas: {
        ...(baseExtra?.eas || {}),
        projectId: easProjectId,
      },
      firebase,
    },
    runtimeVersion: "1.0.3",
    updates: {
      url: `https://u.expo.dev/${easProjectId}`,
      checkAutomatically: "NEVER",
    },
  };
};
