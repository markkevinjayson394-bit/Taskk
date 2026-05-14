// config/firebase.js
// Firebase initialization only. The WeeklySchedule admin UI has been moved
// to app/(admin)/WeeklySchedule.js to keep this file clean.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  // @ts-ignore
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import {
  disableNetwork,
  enableNetwork,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
} from "firebase/firestore";
import { AppState, Platform } from "react-native";

/** @typedef {import("firebase/app").FirebaseApp} FirebaseApp */
/** @typedef {import("firebase/auth").Auth} Auth */
/** @typedef {import("firebase/firestore").Firestore} Firestore */

const requiredFirebaseKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const normalizeFirebaseValue = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  if (unquoted.startsWith("${") && unquoted.endsWith("}")) return "";
  if (unquoted === "undefined" || unquoted === "null") return "";
  return unquoted;
};

const sanitizeFirebaseConfig = (input = {}) => ({
  apiKey: normalizeFirebaseValue(input?.apiKey),
  authDomain: normalizeFirebaseValue(input?.authDomain),
  projectId: normalizeFirebaseValue(input?.projectId),
  storageBucket: normalizeFirebaseValue(input?.storageBucket),
  messagingSenderId: normalizeFirebaseValue(input?.messagingSenderId),
  appId: normalizeFirebaseValue(input?.appId),
});

const pickBestFirebaseCandidate = (...candidates) => {
  let best = {};
  let bestCount = -1;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const sanitized = sanitizeFirebaseConfig(candidate);
    const presentCount = requiredFirebaseKeys.filter(
      (key) => sanitized[key]
    ).length;
    if (presentCount > bestCount) {
      best = sanitized;
      bestCount = presentCount;
    }
  }
  return best;
};

const expoConfig = /** @type {any} */ (Constants?.expoConfig);
const legacyManifest = /** @type {any} */ (Constants?.manifest);
const modernManifest = /** @type {any} */ (Constants?.manifest2);
const updateManifest = /** @type {any} */ (Updates?.manifest);

const firebaseFromManifest = pickBestFirebaseCandidate(
  expoConfig?.extra?.firebase,
  legacyManifest?.extra?.firebase,
  modernManifest?.extra?.firebase,
  modernManifest?.extra?.expoClient?.extra?.firebase,
  updateManifest?.extra?.firebase,
  updateManifest?.extra?.expoClient?.extra?.firebase
);

const runtimeEnv = /** @type {any} */ (globalThis)?.process?.env || {};

// In React Native/Expo, only EXPO_PUBLIC_* variables are available at runtime.
// The manifest/expoConfig is the primary source for public config values.
// Runtime env vars should only be used as a fallback if manifest is empty.
const firebaseFromEnv = sanitizeFirebaseConfig({
  apiKey: runtimeEnv.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: runtimeEnv.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: runtimeEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: runtimeEnv.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: runtimeEnv.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: runtimeEnv.EXPO_PUBLIC_FIREBASE_APP_ID,
});

const firebaseConfig = requiredFirebaseKeys.reduce((acc, key) => {
  acc[key] = firebaseFromManifest[key] || firebaseFromEnv[key] || "";
  return acc;
}, {});

const missingFirebaseKeys = requiredFirebaseKeys.filter(
  (key) => !String(firebaseConfig?.[key] ?? "").trim()
);
const isFirebaseConfigured = missingFirebaseKeys.length === 0;
const firebaseConfigError = isFirebaseConfigured
  ? null
  : `Missing Firebase config keys: ${missingFirebaseKeys.join(", ")}`;

if (!isFirebaseConfigured) {
  console.error("❌ Firebase config is missing or invalid:", {
    firebaseConfig,
    missingFirebaseKeys,
    firebaseFromManifest: {
      ...firebaseFromManifest,
      // Redact sensitive values in logs
      apiKey: firebaseFromManifest.apiKey ? "***" : undefined,
    },
    firebaseFromEnv: {
      ...firebaseFromEnv,
      apiKey: firebaseFromEnv.apiKey ? "***" : undefined,
    },
  });
} else {
  console.log("✅ Firebase config loaded successfully");
}

/**
 * Always initialize/export Firebase services so consumers don't crash on null.
 * `isFirebaseConfigured` should still be used to block auth/DB operations
 * when required keys are missing.
 * @type {FirebaseApp}
 */
const app = getApps()[0] || initializeApp(firebaseConfig);

/** @type {Auth} */
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  if (error?.code === "auth/already-initialized") {
    auth = getAuth(app);
  } else {
    throw error;
  }
}

function buildFirestoreSettings() {
  const settings = {};

  // React Native does not provide the browser IndexedDB + multi-tab APIs that
  // Firestore's persistentLocalCache() relies on. Using it in release builds
  // can fail during app startup and leave the app on a blank/gray screen.
  if (Platform.OS !== "web") {
    settings.experimentalForceLongPolling = true;
  }

  if (typeof memoryLocalCache === "function") {
    settings.localCache = memoryLocalCache();
  }

  return settings;
}

/**
 * Firestore for the React Native runtime. Avoid browser-only persistence
 * primitives and fall back to the default instance if custom initialization
 * fails so release builds can still boot.
 * @type {Firestore}
 */
let db;
try {
  db = initializeFirestore(app, buildFirestoreSettings());
} catch (error) {
  console.warn(
    "Firestore initialization with custom settings failed; falling back to the default instance.",
    error
  );
  db = getFirestore(app);
}

let disableNetworkTimer = null;

// Handle app state changes to avoid Firestore stream errors
// when the app goes to background and comes back to foreground
AppState.addEventListener("change", async (state) => {
  try {
    if (state === "background") {
      // Wait 3s before disabling — avoids killing requests on brief interruptions
      // (e.g. permission dialogs, system overlays, quick app switches)
      disableNetworkTimer = setTimeout(async () => {
        await disableNetwork(db);
      }, 3000);
    } else if (state === "active") {
      if (disableNetworkTimer) {
        clearTimeout(disableNetworkTimer);
        disableNetworkTimer = null;
      }
      await enableNetwork(db);
      // Give Firestore ~500ms to re-establish streams before new requests land
      await new Promise(res => setTimeout(res, 500));
    }
  } catch (e) {
    console.warn("Firestore network toggle warning:", e);
  }
});

export { app, auth, db, firebaseConfigError, isFirebaseConfigured };
