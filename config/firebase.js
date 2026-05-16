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

/** @type {FirebaseApp} */
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
  if (Platform.OS !== "web") {
    settings.experimentalForceLongPolling = true;
  }
  if (typeof memoryLocalCache === "function") {
    settings.localCache = memoryLocalCache();
  }
  return settings;
}

/** @type {Firestore} */
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

/**
 * Always returns the current Firestore instance, even if it was
 * reinitialized after a corruption. Use this instead of importing
 * `db` directly in files that run after app state changes.
 * @returns {Firestore}
 */
export const getDb = () => db;

// Tracks whether we successfully disabled the network so we only
// call enableNetwork() if disableNetwork() actually ran.
let firestoreNetworkEnabled = true;
let disableNetworkTimer = null;
// Prevents concurrent enable/disable calls from overlapping.
let networkToggleInProgress = false;

AppState.addEventListener("change", async (nextState) => {
  try {
    if (nextState === "background") {
      // Clear any previous pending disable timer
      if (disableNetworkTimer) {
        clearTimeout(disableNetworkTimer);
        disableNetworkTimer = null;
      }

      // Wait 3s before disabling — avoids killing active requests during
      // brief interruptions (permission dialogs, system overlays, quick switches)
      disableNetworkTimer = setTimeout(async () => {
        if (networkToggleInProgress || !firestoreNetworkEnabled) return;
        networkToggleInProgress = true;
        try {
          await disableNetwork(db);
          firestoreNetworkEnabled = false;
          console.log("🔴 Firestore network disabled (background)");
        } catch (e) {
          console.warn("Firestore disableNetwork warning:", e);
        } finally {
          networkToggleInProgress = false;
          disableNetworkTimer = null;
        }
      }, 3000);
    } else if (nextState === "active") {
      // Cancel the pending disable if the user came back before it fired
      if (disableNetworkTimer) {
        clearTimeout(disableNetworkTimer);
        disableNetworkTimer = null;
      }

      // Nothing to re-enable if we never disabled
      if (firestoreNetworkEnabled) return;
      if (networkToggleInProgress) return;

      networkToggleInProgress = true;
      try {
        await enableNetwork(db);
        firestoreNetworkEnabled = true;
        console.log("🟢 Firestore network enabled (foreground)");
      } catch (e) {
        console.warn(
          "Firestore enableNetwork failed, reinitializing instance:",
          e
        );
        // The Firestore instance is corrupted — reinitialize it so future
        // calls (via getDb()) get a fresh, working instance.
        try {
          db = initializeFirestore(app, buildFirestoreSettings());
          firestoreNetworkEnabled = true;
          console.log("🔄 Firestore reinitialized after corruption");
        } catch (reinitError) {
          console.error("Firestore reinitialization failed:", reinitError);
        }
      } finally {
        networkToggleInProgress = false;
      }
    }
  } catch (e) {
    console.warn("Firestore AppState handler error:", e);
    networkToggleInProgress = false;
  }
});

export { app, auth, db, firebaseConfigError, isFirebaseConfigured };

