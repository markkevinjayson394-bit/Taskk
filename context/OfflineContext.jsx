import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { auth } from "../config/firebase";
import { reportWarning, warnIfDev } from "../utils/logger";

export const CACHE_KEYS = {
  schedule: (uid) => `cache_schedule_${uid}`,
  assignments: (uid) => `cache_assignments_${uid}`,
  announcements: (uid) => `cache_announcements_${uid}`,
  profile: (uid) => `cache_profile_${uid}`,
  lastSync: (uid) => `cache_lastsync_${uid}`,
};

export const OFFLINE_QUEUE_KEYS = {
  createAssignments: (uid) => `pending_create_${uid}`,
  completeAssignments: (uid) => `pending_complete_${uid}`,
};

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    warnIfDev("OfflineContext: failed to parse JSON array:", err);
    return [];
  }
}

export async function saveToCache(key, data) {
  try {
    const payload = {
      data,
      savedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    reportWarning(err, {
      message: "Cache save failed.",
      tags: { location: "offline_cache_save", cacheKey: key },
    });
  }
}

export async function loadFromCache(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload;
  } catch (err) {
    reportWarning(err, {
      message: "Cache load failed.",
      tags: { location: "offline_cache_load", cacheKey: key },
    });
    return null;
  }
}

export async function clearUserCache(uid) {
  try {
    const keys = Object.values(CACHE_KEYS).map((fn) => fn(uid));
    await AsyncStorage.multiRemove(keys);
  } catch (err) {
    reportWarning(err, {
      message: "User cache clear failed.",
      tags: { location: "offline_cache_clear" },
      extra: { userId: uid },
    });
  }
}

export function formatSyncTime(isoString) {
  if (!isoString) return "Never";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch (err) {
    warnIfDev("OfflineContext: failed to format sync time:", err);
    return "Unknown";
  }
}

const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const [isOnline, setIsOnline] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [checking, setChecking] = useState(true);
  const [pendingSyncSummary, setPendingSyncSummary] = useState({
    create: 0,
    complete: 0,
    total: 0,
  });
  const appState = useRef(AppState.currentState);

  const refreshPendingSyncSummary = useCallback(async (uid) => {
    if (!uid) {
      warnIfDev("OfflineContext: refreshPendingSyncSummary requires a uid.");
      const summary = { create: 0, complete: 0, total: 0 };
      setPendingSyncSummary(summary);
      return summary;
    }

    try {
      const [createRaw, completeRaw] = await Promise.all([
        AsyncStorage.getItem(OFFLINE_QUEUE_KEYS.createAssignments(uid)),
        AsyncStorage.getItem(OFFLINE_QUEUE_KEYS.completeAssignments(uid)),
      ]);
      const create = parseJsonArray(createRaw).length;
      const complete = parseJsonArray(completeRaw).length;
      const summary = {
        create,
        complete,
        total: create + complete,
      };
      setPendingSyncSummary(summary);
      return summary;
    } catch (error) {
      reportWarning(error, {
        message: "Failed to refresh pending offline sync summary.",
        tags: { location: "offline_refresh_pending_summary" },
        extra: { userId: uid },
      });
      const summary = { create: 0, complete: 0, total: 0 };
      setPendingSyncSummary(summary);
      return summary;
    }
  }, []);

  const checkConnectivity = useCallback(async () => {
    setChecking(true);
    try {
      const state = await NetInfo.fetch();
      setIsOnline(state.isConnected && state.isInternetReachable !== false);
    } catch (error) {
      reportWarning(error, {
        message: "Connectivity check failed.",
        tags: { location: "offline_connectivity_check" },
      });
      setIsOnline(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const initialUser = auth.currentUser;
    if (initialUser) {
      refreshPendingSyncSummary(initialUser.uid);
    }

    const unsubNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(online);
      setChecking(false);

      const netUser = auth.currentUser;
      if (netUser) {
        refreshPendingSyncSummary(netUser.uid);
      }
    });

    const unsubApp = AppState.addEventListener("change", (nextState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextState === "active"
      ) {
        checkConnectivity();
        const appUser = auth.currentUser;
        if (appUser) {
          refreshPendingSyncSummary(appUser.uid);
        }
      }
      appState.current = nextState;
    });

    return () => {
      unsubNet();
      unsubApp.remove();
    };
  }, [checkConnectivity, refreshPendingSyncSummary]);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const cached = await loadFromCache(CACHE_KEYS.lastSync(user.uid));
        if (cached?.data) setLastSync(cached.data);
        await refreshPendingSyncSummary(user.uid);
      } else {
        setPendingSyncSummary({ create: 0, complete: 0, total: 0 });
      }
    });
    return unsub;
  }, [refreshPendingSyncSummary]);

  const markSynced = useCallback(
    async (uid, queueKeys = null) => {
      if (!uid) {
        warnIfDev("OfflineContext: markSynced requires a uid.");
        return;
      }

      const now = new Date().toISOString();
      setLastSync(now);

      const keysToClear =
        Array.isArray(queueKeys) && queueKeys.length > 0
          ? queueKeys
          : [
              OFFLINE_QUEUE_KEYS.createAssignments(uid),
              OFFLINE_QUEUE_KEYS.completeAssignments(uid),
            ];

      try {
        await AsyncStorage.multiRemove(keysToClear);
      } catch (error) {
        reportWarning(error, {
          message: "Failed to clear offline queue keys after sync.",
          tags: { location: "offline_clear_queue_after_sync" },
          extra: { userId: uid, queueKeyCount: keysToClear.length },
        });
      }

      await saveToCache(CACHE_KEYS.lastSync(uid), now);
      await refreshPendingSyncSummary(uid);
    },
    [refreshPendingSyncSummary]
  );

  const contextValue = useMemo(
    () => ({
      isOnline,
      lastSync,
      checking,
      markSynced,
      checkConnectivity,
      pendingSyncSummary,
      refreshPendingSyncSummary,
    }),
    [
      isOnline,
      lastSync,
      checking,
      markSynced,
      checkConnectivity,
      pendingSyncSummary,
      refreshPendingSyncSummary,
    ]
  );

  return (
    <OfflineContext.Provider value={contextValue}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used inside OfflineProvider");
  return ctx;
}
