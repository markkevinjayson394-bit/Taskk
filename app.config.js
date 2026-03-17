// Note: dotenv is NOT used here because:
// 1. Expo configs run in a non-Node.js environment
// 2. Environment variables should be provided via EAS Secrets or app.extra
// 3. The actual Firebase config is read from Constants.expoConfig.extra.firebase

const normalizeFirebaseValue = (value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  // Remove surrounding quotes if present
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

module.exports = ({ config }) => {
  const base = config || {};
  const baseExtra = base.extra || {};
  const firebase = {
    apiKey: getEnv("FIREBASE_API_KEY") || getExtra(baseExtra, "apiKey") || "",
    authDomain:
      getEnv("FIREBASE_AUTH_DOMAIN") || getExtra(baseExtra, "authDomain") || "",
    projectId:
      getEnv("FIREBASE_PROJECT_ID") || getExtra(baseExtra, "projectId") || "",
    storageBucket:
      getEnv("FIREBASE_STORAGE_BUCKET") ||
      getExtra(baseExtra, "storageBucket") ||
      "",
    messagingSenderId:
      getEnv("FIREBASE_MESSAGING_SENDER_ID") ||
      getExtra(baseExtra, "messagingSenderId") ||
      "",
    appId: getEnv("FIREBASE_APP_ID") || getExtra(baseExtra, "appId") || "",
  };

  return {
    ...base,
    name: "CTU Time Manager",
    slug: "time-management-app",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "ctutimemanager",
    owner: "haahahe",
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
      predictiveBackGestureEnabled: false,
      package: "com.ctudanao.timemanager",
      permissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.CAMERA",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.PACKAGE_USAGE_STATS",
        "android.permission.RECORD_AUDIO",
      ],
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
      "expo-notifications",
      [
        "expo-image-picker",
        {
          photosPermission:
            "CTU Time Manager needs access to your photos to set a profile picture.",
          cameraPermission:
            "CTU Time Manager needs access to your camera to take a profile picture.",
        },
      ],
      "@react-native-community/datetimepicker",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
    },
    extra: {
      ...baseExtra,
      router: {},
      eas: {
        projectId: "e044163a-3db8-4577-9ca5-a70fb2634898",
      },
      firebase,
    },
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      url: "https://u.expo.dev/e044163a-3db8-4577-9ca5-a70fb2634898",
    },
  };
};
