import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { auth } from "../config/firebase";

// ── Cache key helpers ────────────────────────────────────────────────────────
// Each key is prefixed with the user's uid so cached data is user-specific
export const CACHE_KEYS = {
  schedule:      (uid) => `cache_schedule_${uid}`,
  assignments:   (uid) => `cache_assignments_${uid}`,
  announcements: (uid) => `cache_announcements_${uid}`,
  profile:       (uid) => `cache_profile_${uid}`,
  lastSync:      (uid) => `cache_lastsync_${uid}`,
};

// ── Save to cache ────────────────────────────────────────────────────────────
export async function saveToCache(key, data) {
  try {
    const payload = {
      data,
      savedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn("Cache save failed:", err);
  }
}

// ── Load from cache ──────────────────────────────────────────────────────────
export async function loadFromCache(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload; // { data, savedAt }
  } catch (err) {
    console.warn("Cache load failed:", err);
    return null;
  }
}

// ── Clear all cache for a user ───────────────────────────────────────────────
export async function clearUserCache(uid) {
  try {
    const keys = Object.values(CACHE_KEYS).map((fn) => fn(uid));
    await AsyncStorage.multiRemove(keys);
  } catch (err) {
    console.warn("Cache clear failed:", err);
  }
}

// ── Format "last synced" timestamp ───────────────────────────────────────────
export function formatSyncTime(isoString) {
  if (!isoString) return "Never";
  try {
    const date = new Date(isoString);
    const now  = new Date();
    const diff = Math.floor((now - date) / 1000); // seconds ago
    if (diff < 60)   return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "Unknown";
  }
}

// ── Context ──────────────────────────────────────────────────────────────────
const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const [isOnline, setIsOnline]   = useState(true);
  const [lastSync, setLastSync]   = useState(null);
  const [checking, setChecking]   = useState(true);
  const appState = useRef(AppState.currentState);

  // Check connectivity on mount and whenever app comes to foreground
  useEffect(() => {
    // Initial check
    checkConnectivity();

    // Subscribe to real-time network changes
    const unsubNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(online);
    });

    // Re-check when app comes back from background
    const unsubApp = AppState.addEventListener("change", (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        checkConnectivity();
      }
      appState.current = nextState;
    });

    return () => {
      unsubNet();
      unsubApp.remove();
    };
  }, []);

  // Load last sync time from storage whenever user changes
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const cached = await loadFromCache(CACHE_KEYS.lastSync(user.uid));
        if (cached?.data) setLastSync(cached.data);
      }
    });
    return unsub;
  }, []);

  const checkConnectivity = async () => {
    setChecking(true);
    try {
      const state = await NetInfo.fetch();
      setIsOnline(state.isConnected && state.isInternetReachable !== false);
    } catch {
      setIsOnline(false);
    } finally {
      setChecking(false);
    }
  };

  // Called by screens after a successful Firestore fetch
  const markSynced = async () => {
    const now = new Date().toISOString();
    setLastSync(now);
    const user = auth.currentUser;
    if (user) {
      await saveToCache(CACHE_KEYS.lastSync(user.uid), now);
    }
  };

  return (
    <OfflineContext.Provider value={{
      isOnline,
      lastSync,
      checking,
      markSynced,
      checkConnectivity,
    }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used inside OfflineProvider");
  return ctx;
}