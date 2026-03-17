/**
 * NotificationContext.js
 *
 * Central notification system for CTU Danao Time Manager.
 *
 * NOTIFICATIONS HANDLED:
 * 1. Class Reminder        15 min before each class
 * 2. Deadline Warning      7 days, 3 days, 1 day, overdue
 * 3. Morning Briefing      every day at 7:00 AM
 * 4. Daily Time Audit      every day at 9:00 PM
 * 5. Sunday Planning       every Sunday at 6:00 PM
 * 6. Break Reminder        after 90 min of device app usage (when app is open)
 * 7. App Usage Check       after 30 min: "Is what you're doing study-related?"
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Alert, AppState, NativeModules, Platform } from "react-native";
import { auth, db } from "../config/firebase";
import { findBestScheduleDoc } from "../utils/scheduleMatcher";
import { CACHE_KEYS, loadFromCache, saveToCache } from "./OfflineContext";

const IS_EXPO_GO = Constants.appOwnership === "expo";
let Notifications = null;

try {
  const NotificationsHandler = require("expo-notifications/build/NotificationsHandler");
  const NotificationPermissions = require("expo-notifications/build/NotificationPermissions");
  const scheduleNotificationAsyncModule = require("expo-notifications/build/scheduleNotificationAsync");
  const cancelAllScheduledNotificationsAsyncModule = require("expo-notifications/build/cancelAllScheduledNotificationsAsync");
  const setNotificationChannelAsyncModule = require("expo-notifications/build/setNotificationChannelAsync");
  const NotificationChannelTypes = require("expo-notifications/build/NotificationChannelManager.types");

  Notifications = {
    setNotificationHandler: NotificationsHandler.setNotificationHandler,
    requestPermissionsAsync: NotificationPermissions.requestPermissionsAsync,
    scheduleNotificationAsync: scheduleNotificationAsyncModule.default,
    cancelAllScheduledNotificationsAsync:
      cancelAllScheduledNotificationsAsyncModule.default,
    setNotificationChannelAsync: setNotificationChannelAsyncModule.default,
    AndroidImportance: NotificationChannelTypes.AndroidImportance,
  };
} catch {
  console.warn(
    "Notifications module unavailable - running in Expo Go or notifications not installed"
  );
  Notifications = null;
}

const NOTIFICATIONS_AVAILABLE =
  Boolean(Notifications) &&
  typeof Notifications.scheduleNotificationAsync === "function" &&
  typeof Notifications.requestPermissionsAsync === "function" &&
  typeof Notifications.cancelAllScheduledNotificationsAsync === "function" &&
  typeof Notifications.setNotificationChannelAsync === "function";

const AppUsageModule = NativeModules?.AppUsageModule;
const DEVICE_USAGE_AVAILABLE =
  Platform.OS === "android" &&
  typeof AppUsageModule?.isUsagePermissionGranted === "function" &&
  typeof AppUsageModule?.getUsageStats === "function";

//  Notification handler  show alert even when app is open
if (NOTIFICATIONS_AVAILABLE) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

//  Storage keys
const KEYS = {
  appStartTime: "notif_app_start_time",
  lastBreakPrompt: "notif_last_break_prompt",
  lastUsagePrompt: "notif_last_usage_prompt",
  lastAuditDate: "notif_last_audit_date",
  lastBriefingDate: "notif_last_briefing_date",
  scheduledIds: "notif_scheduled_ids",
  settings: "notif_settings",
  times: "notif_times", // custom times for each notification
  customNotifs: "notif_custom", // user-created custom notifications
  usageDaily: "notif_usage_daily", // { 'YYYY-MM-DD': minutes }
  usageGuard: "notif_usage_guard", // warning/limit config
  usageWarnedDate: "notif_usage_warned_date",
  usageUnlockUntil: "notif_usage_unlock_until",
  usageActiveMs: "notif_usage_active_ms", // { dayKey: ms } for unsaved active usage
  seenAnnouncements: (uid) => `notif_seen_announcements_${uid}`,
};
const ANDROID_CHANNEL_ID = "study-reminders";
const ENV_NOTIF_DEBUG =
  typeof process !== "undefined" && process?.env?.EXPO_PUBLIC_NOTIF_DEBUG;
const NOTIF_DEBUG =
  ENV_NOTIF_DEBUG === "1" ||
  ENV_NOTIF_DEBUG === "true" ||
  (typeof __DEV__ !== "undefined" && __DEV__);
const ANNOUNCEMENT_FETCH_LIMIT = 40;
const ANNOUNCEMENT_POLL_MS = 2 * 60 * 1000;
const ANNOUNCEMENT_TRACK_LIMIT = 200;

function debugNotif(event, payload = {}) {
  if (!NOTIF_DEBUG) return;
  const ts = new Date().toISOString();
  let detail = "";
  if (payload !== undefined) {
    if (typeof payload === "string") detail = payload;
    else {
      try {
        detail = JSON.stringify(payload);
      } catch {
        detail = String(payload);
      }
    }
  }
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[Notif] [${ts}] ${event}${suffix}`);
}

function toDateKey(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeUsageGuard(input = {}) {
  const warnMinutes = Math.max(
    15,
    Math.min(12 * 60, Number(input.warnMinutes) || 120)
  );
  const limitMinutes = Math.max(
    30,
    Math.min(16 * 60, Number(input.limitMinutes) || 180)
  );
  return {
    warnMinutes,
    limitEnabled: Boolean(input.limitEnabled),
    limitMinutes: Math.max(limitMinutes, warnMinutes),
  };
}

function normalizeUsageDailyMap(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  Object.keys(raw).forEach((key) => {
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < 0) return;
    out[key] = Math.round(value);
  });
  return out;
}

function pruneUsageDailyMap(map, keepDays = 45) {
  const keys = Object.keys(map || {}).sort();
  if (keys.length <= keepDays) return map;
  const keep = new Set(keys.slice(-keepDays));
  const next = {};
  keys.forEach((k) => {
    if (keep.has(k)) next[k] = map[k];
  });
  return next;
}

function getWeekUsageMinutes(map, dateInput = new Date()) {
  const base = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(base.getTime())) return 0;

  let total = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(base);
    day.setDate(base.getDate() - i);
    total += Number(map?.[toDateKey(day)] || 0);
  }
  return total;
}

function parseFirestoreDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function buildNotificationContent(title, body, extra = {}) {
  return {
    title,
    body,
    ...extra,
    ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
  };
}

//  Default times for editable notifications
export const DEFAULT_TIMES = {
  morningBriefing: { hour: 7, minute: 0 }, // 7:00 AM
  dailyAudit: { hour: 21, minute: 0 }, // 9:00 PM
  sundayPlanning: { hour: 18, minute: 0 }, // 6:00 PM
  classReminder: { minutesBefore: 15 }, // 15 min before class
};

//  Default settings (user can toggle each one)
export const DEFAULT_SETTINGS = {
  classReminder: true,
  deadlineWarning: true,
  announcementAlert: true,
  morningBriefing: true,
  dailyAudit: true,
  sundayPlanning: true,
  breakReminder: true,
  appUsageCheck: true,
};

export const DEFAULT_USAGE_GUARD = {
  warnMinutes: 120,
  limitEnabled: false,
  limitMinutes: 180,
};

//  Context
const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [times, setTimes] = useState(DEFAULT_TIMES);
  const [customNotifs, setCustomNotifs] = useState([]);
  const [usageGuard, setUsageGuard] = useState(DEFAULT_USAGE_GUARD);
  const [usageDaily, setUsageDaily] = useState({});
  const [permission, setPermission] = useState(false);
  const [appUsageMin, setAppUsageMin] = useState(0);
  const [weekUsageMin, setWeekUsageMin] = useState(0);
  const [usageLimitLocked, setUsageLimitLocked] = useState(false);
  const [usageUnlockUntil, setUsageUnlockUntil] = useState(0);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const appStartTime = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const usageTimer = useRef(null);
  const activeUsageMs = useRef(0);
  const usageLogRef = useRef({ lastLoggedMinute: -1 });
  const usageDayKeyRef = useRef(toDateKey(new Date()));
  const usageDayBaseMinRef = useRef(0);
  const lastSavedTodayMinRef = useRef(-1);
  const usageDailyRef = useRef({});
  const usageGuardRef = useRef(DEFAULT_USAGE_GUARD);
  const usageUnlockUntilRef = useRef(0);
  const usageWarnedDateRef = useRef("");
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const scheduleGateRef = useRef({ inFlight: false, lastKey: "", lastAt: 0 });
  const usageMilestones = useRef({
    usage30: false,
    usage60: false,
    usage90: false,
    break90: false,
  });
  const deviceUsageCheckRef = useRef({ lastCheck: 0, inFlight: false });

  //  On mount
  // Intentionally mount-only for one-time hydration + app-state subscription.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const init = async () => {
      requestPermission();
      await loadSettings();
      // await recordAppOpen(); // Disabled usage tracking reset
    };
    init();

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      sub.remove();
      if (usageTimer.current) clearInterval(usageTimer.current);
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    usageGuardRef.current = usageGuard;
  }, [usageGuard]);

  const checkAnnouncementNotifications = async (uid) => {
    if (!NOTIFICATIONS_AVAILABLE) return;
    if (settingsRef.current.announcementAlert === false) return;
    if (!permission) return;

    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) return;

      const userData = userSnap.data();
      if ((userData.role || "student") === "admin") return;

      const studentInfo = userData.studentInfo || {};
      const { college, course, year, section } = studentInfo;
      const normCollege = String(college ?? "")
        .trim()
        .toLowerCase();
      const normCourse = String(course ?? "")
        .trim()
        .toLowerCase();
      const normYear = String(year ?? "").trim();
      const normSection = String(section ?? "")
        .trim()
        .toLowerCase();

      const annSnap = await getDocs(
        query(
          collection(db, "announcements"),
          orderBy("createdAt", "desc"),
          limit(ANNOUNCEMENT_FETCH_LIMIT)
        )
      );

      const relevant = annSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          if (a.audience === "all") return true;
          const annYear = String(a.year ?? "").trim();
          if (a.audience === "year" && annYear === normYear) {
            if (!a.college) return true;
            const annCollege = String(a.college ?? "")
              .trim()
              .toLowerCase();
            return annCollege === normCollege;
          }
          if (a.audience === "course") {
            const annCourse = String(a.course ?? "")
              .trim()
              .toLowerCase();
            const annSection = String(a.section ?? "")
              .trim()
              .toLowerCase();
            if (
              annCourse !== normCourse ||
              annYear !== normYear ||
              annSection !== normSection
            )
              return false;
            if (!a.college) return true;
            const annCollege = String(a.college ?? "")
              .trim()
              .toLowerCase();
            return annCollege === normCollege;
          }
          return false;
        });

      const seenKey = KEYS.seenAnnouncements(uid);
      const rawSeen = await AsyncStorage.getItem(seenKey);
      let seenIds = null;
      if (rawSeen) {
        try {
          seenIds = JSON.parse(rawSeen);
        } catch {
          seenIds = null;
        }
      }

      // First run baseline: mark current items as seen to avoid old-notification spam.
      if (!Array.isArray(seenIds)) {
        await AsyncStorage.setItem(
          seenKey,
          JSON.stringify(
            relevant.map((a) => a.id).slice(0, ANNOUNCEMENT_TRACK_LIMIT)
          )
        );
        debugNotif("announcement.prime", { count: relevant.length });
        return;
      }

      const seenSet = new Set(seenIds);
      const newItems = relevant
        .filter((a) => !seenSet.has(a.id))
        .sort((a, b) => {
          const aTs = parseFirestoreDate(a.createdAt)?.getTime() || 0;
          const bTs = parseFirestoreDate(b.createdAt)?.getTime() || 0;
          return aTs - bTs;
        });

      for (const ann of newItems.slice(0, 5)) {
        const bodySource =
          ann.message || "Your admin posted a new announcement.";
        const body =
          bodySource.length > 120
            ? `${bodySource.slice(0, 117)}...`
            : bodySource;
        await Notifications.scheduleNotificationAsync({
          content: buildNotificationContent("New Announcement", body, {
            data: { type: "announcement", announcementId: ann.id },
          }),
          trigger: null,
        });
      }

      const mergedSeen = Array.from(
        new Set([...relevant.map((a) => a.id), ...seenIds])
      ).slice(0, ANNOUNCEMENT_TRACK_LIMIT);

      await AsyncStorage.setItem(seenKey, JSON.stringify(mergedSeen));
      if (newItems.length) {
        debugNotif("announcement.notified", { total: newItems.length });
      }
    } catch (_err) {
      debugNotif("announcement.error", {
        error: _err?.message || String(_err),
      });
    }
  };

  // Schedule notifications when user logs in
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let retryTimeout = null;

    const scheduleWithRetry = async (user, retryCount = 0) => {
      const maxRetries = 3;
      const retryDelay = 2000; // 2 seconds

      if (!permission) {
        debugNotif("auth.schedule.skip", { reason: "permission_denied" });
        return;
      }

      if (!settingsLoaded && retryCount < maxRetries) {
        debugNotif("auth.schedule.retry", {
          retryCount,
          maxRetries,
          willRetryIn: retryDelay,
        });
        retryTimeout = setTimeout(() => {
          scheduleWithRetry(user, retryCount + 1);
        }, retryDelay);
        return;
      }

      if (!settingsLoaded) {
        debugNotif("auth.schedule.skip", {
          reason: "settings_not_loaded_after_retries",
          retryCount,
        });
        return;
      }

      let scheduleKey = "";
      try {
        scheduleKey = JSON.stringify({
          uid: user.uid,
          settings,
          times,
          customNotifs,
        });
      } catch {
        scheduleKey = `${user.uid}:${Date.now()}`;
      }

      const now = Date.now();
      if (scheduleGateRef.current.inFlight) {
        debugNotif("auth.schedule.skip", { reason: "schedule_in_flight" });
        return;
      }
      if (
        scheduleGateRef.current.lastKey === scheduleKey &&
        now - scheduleGateRef.current.lastAt < 1500
      ) {
        debugNotif("auth.schedule.skip", { reason: "schedule_duplicate" });
        return;
      }

      scheduleGateRef.current.inFlight = true;
      scheduleGateRef.current.lastKey = scheduleKey;
      scheduleGateRef.current.lastAt = now;

      try {
        debugNotif("auth.schedule.start", {
          uid: user.uid,
          settingsLoaded,
          permission,
          settingsUsed: JSON.stringify(settings),
          timesUsed: JSON.stringify(times),
          customNotifsCount: customNotifs?.length || 0,
        });

        await scheduleAllNotifications(user.uid, settings, times, customNotifs);
        debugNotif("auth.schedule.done", { uid: user.uid });
      } finally {
        scheduleGateRef.current.inFlight = false;
      }
    };

    const unsub = auth.onAuthStateChanged(async (user) => {
      // Clear any pending retry
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }

      debugNotif("auth.state.change", {
        hasUser: !!user,
        uid: user?.uid,
        permission,
        settingsLoaded,
        customNotifsCount: customNotifs?.length || 0,
        settingsKeys: Object.keys(settings)
          .filter((k) => settings[k])
          .join(","),
      });

      if (!user) {
        scheduleGateRef.current = { inFlight: false, lastKey: "", lastAt: 0 };
        debugNotif("auth.schedule.skip", { reason: "no_user" });
        return;
      }

      await scheduleWithRetry(user, 0);
    });

    return () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      unsub();
    };
  }, [permission, settingsLoaded, settings, times, customNotifs]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Poll for new announcements and show local notification to students.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!permission || !settingsLoaded) return undefined;
    if (settings.announcementAlert === false) return undefined;
    if (!NOTIFICATIONS_AVAILABLE) return undefined;

    let active = true;
    let pollId = null;

    const runCheck = async () => {
      const user = auth.currentUser;
      if (!active || !user) return;
      await checkAnnouncementNotifications(user.uid);
    };

    runCheck();
    pollId = setInterval(runCheck, ANNOUNCEMENT_POLL_MS);

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") runCheck();
    });

    return () => {
      active = false;
      if (pollId) clearInterval(pollId);
      appStateSub.remove();
    };
  }, [permission, settingsLoaded, settings.announcementAlert]);
  /* eslint-enable react-hooks/exhaustive-deps */

  //  Save settings to Firestore for cross-device sync
  const saveSettingsToFirestore = async (uid, settingsData) => {
    try {
      await setDoc(
        doc(db, "users", uid, "settings", "notification"),
        settingsData,
        { merge: true }
      );
      debugNotif("firestore.settings.saved", { uid });
    } catch (err) {
      debugNotif("firestore.settings.saveError", { error: err?.message });
    }
  };

  //  Load settings from Firestore as fallback
  const loadSettingsFromFirestore = async (uid) => {
    try {
      const snap = await getDoc(
        doc(db, "users", uid, "settings", "notification")
      );
      if (snap.exists()) {
        const data = snap.data();
        debugNotif("firestore.settings.loaded", { uid });
        return {
          settings: { ...DEFAULT_SETTINGS, ...data.settings },
          times: { ...DEFAULT_TIMES, ...data.times },
          customNotifs: Array.isArray(data.customNotifs)
            ? data.customNotifs
            : [],
          usageGuard: normalizeUsageGuard(data.usageGuard),
        };
      }
    } catch (err) {
      debugNotif("firestore.settings.loadError", { error: err?.message });
    }
    return null;
  };

  //  Request permission
  const requestPermission = async () => {
    if (!NOTIFICATIONS_AVAILABLE) {
      setPermission(false);
      debugNotif("permission.skipped", {
        reason: IS_EXPO_GO ? "expo_go" : "notifications_module_unavailable",
      });
      return false;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "Study Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#007bff",
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    const granted = status === "granted";
    setPermission(granted);
    debugNotif("permission.result", { status, granted });
    return granted;
  };

  //  Load saved settings, times, and custom notifications
  const loadSettings = async () => {
    let loadedSettings = DEFAULT_SETTINGS;
    let loadedTimes = DEFAULT_TIMES;
    let loadedCustom = [];
    let loadedUsageGuard = DEFAULT_USAGE_GUARD;
    let loadedUsageDaily = {};
    let loadedActiveUsage = {};
    let loadedWarnedDate = "";
    let loadedUnlockUntil = 0;
    let loadedFromFirestore = false;

    // Try to load from Firestore first (for cross-device sync)
    const user = auth.currentUser;
    if (user) {
      const firestoreData = await loadSettingsFromFirestore(user.uid);
      if (firestoreData) {
        loadedSettings = firestoreData.settings;
        loadedTimes = firestoreData.times;
        loadedCustom = firestoreData.customNotifs;
        loadedUsageGuard = firestoreData.usageGuard;
        loadedFromFirestore = true;
        // Save to AsyncStorage for offline access
        await AsyncStorage.setItem(
          KEYS.settings,
          JSON.stringify(loadedSettings)
        );
        await AsyncStorage.setItem(KEYS.times, JSON.stringify(loadedTimes));
        await AsyncStorage.setItem(
          KEYS.customNotifs,
          JSON.stringify(loadedCustom)
        );
        await AsyncStorage.setItem(
          KEYS.usageGuard,
          JSON.stringify(loadedUsageGuard)
        );
        debugNotif("settings.hydrated.fromFirestore", { uid: user.uid });
      }
    }

    // Fallback to AsyncStorage if not from Firestore
    if (!loadedFromFirestore) {
      try {
        const raw = await AsyncStorage.getItem(KEYS.settings);
        if (raw) loadedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };

        const rawTimes = await AsyncStorage.getItem(KEYS.times);
        if (rawTimes)
          loadedTimes = { ...DEFAULT_TIMES, ...JSON.parse(rawTimes) };

        const rawCustom = await AsyncStorage.getItem(KEYS.customNotifs);
        if (rawCustom) loadedCustom = JSON.parse(rawCustom);

        const rawUsageGuard = await AsyncStorage.getItem(KEYS.usageGuard);
        if (rawUsageGuard)
          loadedUsageGuard = normalizeUsageGuard(JSON.parse(rawUsageGuard));

        const rawUsageDaily = await AsyncStorage.getItem(KEYS.usageDaily);
        if (rawUsageDaily)
          loadedUsageDaily = normalizeUsageDailyMap(JSON.parse(rawUsageDaily));

        const rawActiveUsage = await AsyncStorage.getItem(KEYS.usageActiveMs);
        if (rawActiveUsage) {
          try {
            loadedActiveUsage = JSON.parse(rawActiveUsage);
          } catch {}
        }

        const rawWarnedDate = await AsyncStorage.getItem(KEYS.usageWarnedDate);
        if (rawWarnedDate) loadedWarnedDate = String(rawWarnedDate);

        const rawUnlockUntil = await AsyncStorage.getItem(
          KEYS.usageUnlockUntil
        );
        if (rawUnlockUntil) loadedUnlockUntil = Number(rawUnlockUntil) || 0;
      } catch {}
    }

    const cleanedUsageDaily = pruneUsageDailyMap(loadedUsageDaily);
    const todayKey = toDateKey(new Date());
    const todayMinutes = Number(cleanedUsageDaily[todayKey] || 0);
    const weekMinutes = getWeekUsageMinutes(cleanedUsageDaily, new Date());

    // Load active usage for today
    const todayActiveMs = Number(loadedActiveUsage[todayKey] || 0);
    activeUsageMs.current = todayActiveMs;

    setSettings(loadedSettings);
    setTimes(loadedTimes);
    setCustomNotifs(Array.isArray(loadedCustom) ? loadedCustom : []);
    setUsageGuard(loadedUsageGuard);
    setUsageDaily(cleanedUsageDaily);
    setUsageUnlockUntil(loadedUnlockUntil);
    setAppUsageMin(todayMinutes);
    setWeekUsageMin(weekMinutes);
    setUsageLimitLocked(
      loadedUsageGuard.limitEnabled &&
        todayMinutes >= loadedUsageGuard.limitMinutes &&
        loadedUnlockUntil <= Date.now()
    );

    usageGuardRef.current = loadedUsageGuard;
    usageDailyRef.current = cleanedUsageDaily;
    usageWarnedDateRef.current = loadedWarnedDate;
    usageUnlockUntilRef.current = loadedUnlockUntil;
    usageDayKeyRef.current = todayKey;
    usageDayBaseMinRef.current = todayMinutes;
    lastSavedTodayMinRef.current = todayMinutes;

    setSettingsLoaded(true);
    debugNotif("settings.hydrated", {
      settings: loadedSettings,
      times: loadedTimes,
      customCount: Array.isArray(loadedCustom) ? loadedCustom.length : 0,
      usageGuard: loadedUsageGuard,
      usageDays: Object.keys(cleanedUsageDaily).length,
      todayMinutes,
    });
  };

  //  Save settings and reschedule
  const updateSettings = async (newSettings) => {
    try {
      const merged = { ...settings, ...newSettings };
      setSettings(merged);
      await AsyncStorage.setItem(KEYS.settings, JSON.stringify(merged));
      const user = auth.currentUser;
      if (user) {
        await scheduleAllNotifications(user.uid, merged, times, customNotifs);
        // Sync to Firestore for cross-device continuity
        await saveSettingsToFirestore(user.uid, {
          settings: merged,
          times,
          customNotifs,
          usageGuard,
        });
      }
    } catch {}
  };

  const updateUsageGuard = async (nextConfig) => {
    try {
      const merged = normalizeUsageGuard({
        ...usageGuardRef.current,
        ...nextConfig,
      });
      setUsageGuard(merged);
      usageGuardRef.current = merged;
      await AsyncStorage.setItem(KEYS.usageGuard, JSON.stringify(merged));
      refreshUsageLockState(appUsageMin, toDateKey(new Date()));
      // Sync to Firestore
      const user = auth.currentUser;
      if (user) {
        await saveSettingsToFirestore(user.uid, {
          settings,
          times,
          customNotifs,
          usageGuard: merged,
        });
      }
    } catch {}
  };

  const extendUsageUnlock = async (minutes = 15) => {
    const safeMinutes = Math.max(5, Math.min(120, Number(minutes) || 15));
    const unlockUntilTs = Date.now() + safeMinutes * 60000;
    usageUnlockUntilRef.current = unlockUntilTs;
    setUsageUnlockUntil(unlockUntilTs);
    setUsageLimitLocked(false);
    try {
      await AsyncStorage.setItem(KEYS.usageUnlockUntil, String(unlockUntilTs));
    } catch (err) {
      console.error(
        "NotificationContext: Failed to save usage unlock time:",
        err
      );
    }
    debugNotif("usage.unlock.extend", { safeMinutes, unlockUntilTs });
  };

  //  Record app open time
  const resetUsageMilestones = () => {
    usageMilestones.current = {
      usage30: false,
      usage60: false,
      usage90: false,
      break90: false,
    };
  };

  const markUsageCheckDone = (minutes) => {
    if (minutes >= 90) {
      usageMilestones.current.usage30 = true;
      usageMilestones.current.usage60 = true;
      usageMilestones.current.usage90 = true;
      return;
    }
    if (minutes >= 60) {
      usageMilestones.current.usage30 = true;
      usageMilestones.current.usage60 = true;
      return;
    }
    if (minutes >= 30) {
      usageMilestones.current.usage30 = true;
    }
  };

  const persistUsageDaily = async (nextMap) => {
    try {
      await AsyncStorage.setItem(KEYS.usageDaily, JSON.stringify(nextMap));
    } catch (err) {
      console.error("NotificationContext: Failed to persist usage daily:", err);
    }
  };

  const refreshUsageLockState = (
    todayMinutes,
    dayKey = toDateKey(new Date())
  ) => {
    const guard = usageGuardRef.current;
    const unlockUntil = usageUnlockUntilRef.current;
    const unlocked = unlockUntil > Date.now();
    const shouldLock =
      guard.limitEnabled && todayMinutes >= guard.limitMinutes && !unlocked;
    setUsageLimitLocked(shouldLock);
    if (
      !shouldLock &&
      usageWarnedDateRef.current === dayKey &&
      todayMinutes < guard.warnMinutes
    ) {
      usageWarnedDateRef.current = "";
    }
  };

  const maybeWarnUsageThreshold = async (todayMinutes, dayKey) => {
    const guard = usageGuardRef.current;
    if (todayMinutes < guard.warnMinutes) return;
    if (usageWarnedDateRef.current === dayKey) return;

    usageWarnedDateRef.current = dayKey;
    try {
      await AsyncStorage.setItem(KEYS.usageWarnedDate, dayKey);
    } catch (err) {
      console.error(
        "NotificationContext: Failed to save usage warned date:",
        err
      );
    }

    Alert.alert(
      "Usage Warning",
      `You have spent ${todayMinutes} minutes in the app today. Take a short break or focus on your top tasks.`
    );
  };

  const checkDeviceUsageBreak = async () => {
    if (settingsRef.current.breakReminder === false) return;
    if (!DEVICE_USAGE_AVAILABLE) {
      debugNotif("usage.device.skipped", { reason: "module_unavailable" });
      return;
    }

    const now = Date.now();
    const guard = deviceUsageCheckRef.current;
    if (guard.inFlight || now - guard.lastCheck < 10 * 60 * 1000) return;
    guard.inFlight = true;
    guard.lastCheck = now;

    try {
      const granted = await AppUsageModule.isUsagePermissionGranted();
      debugNotif("usage.device.permission", { granted });
      if (!granted) return;
      const raw = await AppUsageModule.getUsageStats(1, 25);
      const list = Array.isArray(raw) ? raw : [];
      const otherApps = list.filter((item) => !item?.isCurrentApp);
      if (!otherApps.length) return;

      otherApps.sort(
        (a, b) =>
          Number(b?.totalTimeForegroundMs || 0) -
          Number(a?.totalTimeForegroundMs || 0)
      );

      // Sum total usage across ALL other apps (not just the top one)
      const totalMs = otherApps.reduce(
        (sum, a) => sum + Number(a?.totalTimeForegroundMs || 0),
        0
      );
      const minutes = Math.round(totalMs / 60000);
      const appName = String(
        otherApps[0]?.appName || otherApps[0]?.packageName || "other apps"
      );
      debugNotif("usage.device.stats", {
        apps: list.length,
        otherApps: otherApps.length,
        totalMinutes: minutes,
        topApp: appName,
      });
      if (minutes < 90) return;
      await triggerBreakReminder(appName, minutes);
    } catch (err) {
      debugNotif("usage.device.error", { error: err?.message || String(err) });
    } finally {
      guard.inFlight = false;
    }
  };

  const syncUsageTotals = (sessionMinutes, now = new Date()) => {
    const dayKey = toDateKey(now);
    if (dayKey && usageDayKeyRef.current !== dayKey) {
      usageDayKeyRef.current = dayKey;
      usageDayBaseMinRef.current = Number(usageDailyRef.current[dayKey] || 0);
      activeUsageMs.current = 0;
      appStartTime.current = Date.now();
      lastSavedTodayMinRef.current = usageDayBaseMinRef.current;
      resetUsageMilestones();
      // Clear old active usage on day change
      AsyncStorage.removeItem(KEYS.usageActiveMs);
    }

    const totalToday = usageDayBaseMinRef.current + sessionMinutes;
    setAppUsageMin(totalToday);
    refreshUsageLockState(totalToday, dayKey);

    if (dayKey && lastSavedTodayMinRef.current !== totalToday) {
      lastSavedTodayMinRef.current = totalToday;
      const nextMap = pruneUsageDailyMap({
        ...usageDailyRef.current,
        [dayKey]: totalToday,
      });
      usageDailyRef.current = nextMap;
      setUsageDaily(nextMap);
      setWeekUsageMin(getWeekUsageMinutes(nextMap, now));
      persistUsageDaily(nextMap);
      maybeWarnUsageThreshold(totalToday, dayKey);
    }

    return totalToday;
  };

  const updateUsageProgress = () => {
    if (!appStartTime.current) return;

    const mins = Math.floor(
      (activeUsageMs.current + (Date.now() - appStartTime.current)) / 60000
    );
    const totalToday = syncUsageTotals(mins, new Date());
    const appUsageCheckEnabled = settingsRef.current.appUsageCheck !== false;
    if (
      mins > 0 &&
      mins % 15 === 0 &&
      usageLogRef.current.lastLoggedMinute !== mins
    ) {
      usageLogRef.current.lastLoggedMinute = mins;
      debugNotif("usage.tick", { sessionMinutes: mins, totalToday });
    }

    // Trigger at or beyond thresholds, never only at exact minutes.
    if (
      appUsageCheckEnabled &&
      mins >= 90 &&
      !usageMilestones.current.usage90
    ) {
      markUsageCheckDone(90);
      debugNotif("usage.threshold", { threshold: 90, mins });
      checkUsageRelevance(90);
    } else if (
      appUsageCheckEnabled &&
      mins >= 60 &&
      !usageMilestones.current.usage60
    ) {
      markUsageCheckDone(60);
      debugNotif("usage.threshold", { threshold: 60, mins });
      checkUsageRelevance(60);
    } else if (
      appUsageCheckEnabled &&
      mins >= 30 &&
      !usageMilestones.current.usage30
    ) {
      markUsageCheckDone(30);
      debugNotif("usage.threshold", { threshold: 30, mins });
      checkUsageRelevance(30);
    }

    if (settingsRef.current.breakReminder !== false) {
      checkDeviceUsageBreak();
    }
  };

  const recordAppOpen = async () => {
    const now = Date.now();
    const dayKey = toDateKey(new Date(now));
    activeUsageMs.current = 0;
    resetUsageMilestones();
    usageDayKeyRef.current = dayKey;
    usageDayBaseMinRef.current = Number(usageDailyRef.current[dayKey] || 0);
    lastSavedTodayMinRef.current = usageDayBaseMinRef.current;
    setAppUsageMin(usageDayBaseMinRef.current);
    setWeekUsageMin(getWeekUsageMinutes(usageDailyRef.current, new Date(now)));
    refreshUsageLockState(usageDayBaseMinRef.current, dayKey);
    appStartTime.current = now;
    await AsyncStorage.setItem(KEYS.appStartTime, String(now));
    startUsageTracking();
    checkDeviceUsageBreak();
    debugNotif("usage.session.reset", {
      startAt: now,
      dayKey,
      baseMinutes: usageDayBaseMinRef.current,
    });
  };

  //  Track app usage time
  const startUsageTracking = () => {
    if (usageTimer.current) clearInterval(usageTimer.current);
    updateUsageProgress();
    usageTimer.current = setInterval(updateUsageProgress, 60000); // check every minute
  };

  const pauseUsageTracking = () => {
    if (appStartTime.current) {
      updateUsageProgress();
      activeUsageMs.current += Date.now() - appStartTime.current;
      appStartTime.current = null;
      debugNotif("usage.paused", {
        activeMinutes: Math.floor(activeUsageMs.current / 60000),
      });
      // Persist active usage
      const dayKey = usageDayKeyRef.current;
      if (dayKey) {
        const activeMap = { [dayKey]: activeUsageMs.current };
        AsyncStorage.setItem(KEYS.usageActiveMs, JSON.stringify(activeMap));
      }
    }
    if (usageTimer.current) clearInterval(usageTimer.current);
  };

  const resumeUsageTracking = async () => {
    if (appStartTime.current) return;
    const now = Date.now();
    appStartTime.current = now;
    await AsyncStorage.setItem(KEYS.appStartTime, String(now));
    startUsageTracking();
    checkDeviceUsageBreak();
    debugNotif("usage.resumed", {
      resumeAt: now,
      activeMinutes: Math.floor(activeUsageMs.current / 60000),
    });
  };

  //  Handle app going to background/foreground
  const handleAppStateChange = async (nextState) => {
    if (appStateRef.current === "active" && nextState !== "active") {
      // App going to background  pause timer
      pauseUsageTracking();
    }
    if (appStateRef.current !== "active" && nextState === "active") {
      // App coming to foreground  resume timer without resetting accumulated usage
      await resumeUsageTracking();
    }
    appStateRef.current = nextState;
  };

  //  In-app usage relevance check
  const checkUsageRelevance = async (minutes) => {
    if (settingsRef.current.appUsageCheck === false) return;
    const raw = await AsyncStorage.getItem(KEYS.lastUsagePrompt);
    const lastPrompt = raw ? parseInt(raw, 10) : 0;
    const hoursSince = (Date.now() - lastPrompt) / 3600000;

    // Do not prompt more than once every 2 hours.
    if (hoursSince < 2) return;

    await AsyncStorage.setItem(KEYS.lastUsagePrompt, String(Date.now()));

    Alert.alert(
      `${minutes} Minutes on App`,
      "You have been in the app for a while. Is what you are doing now related to your studies?",
      [
        {
          text: "Yes, studying",
          onPress: () => {
            // No reset needed, just continue tracking
          },
        },
        {
          text: "Not right now",
          onPress: () => {
            Alert.alert(
              "Time to Refocus",
              "Try opening Tasks or Schedule to get back on track.",
              [{ text: "Got it" }]
            );
          },
        },
      ]
    );
  };

  //  In-app break reminder
  const triggerBreakReminder = async (appName, minutes) => {
    if (settingsRef.current.breakReminder === false) return;
    const raw = await AsyncStorage.getItem(KEYS.lastBreakPrompt);
    const lastPrompt = raw ? parseInt(raw, 10) : 0;
    const hoursSince = (Date.now() - lastPrompt) / 3600000;
    if (hoursSince < 1.5) return;

    await AsyncStorage.setItem(KEYS.lastBreakPrompt, String(Date.now()));
    const safeMinutes = Math.max(1, Number(minutes) || 90);
    const label = appName ? `on ${appName}` : "on other apps";

    Alert.alert(
      "Time for a Short Break",
      `You have spent about ${safeMinutes} minutes ${label}. Take a 10 to 15 minute break to reset focus.`,
      [
        {
          text: "Take a break",
          onPress: () => {
            recordAppOpen();
          },
        },
        { text: "Keep going", style: "cancel" },
      ]
    );
  };

  //  Schedule ALL push notifications
  const scheduleAllNotifications = async (
    uid,
    currentSettings,
    currentTimes = times,
    currentCustom = customNotifs
  ) => {
    try {
      if (!NOTIFICATIONS_AVAILABLE) {
        debugNotif("schedule.skipped", {
          uid,
          reason: IS_EXPO_GO ? "expo_go" : "notifications_module_unavailable",
        });
        return;
      }

      const summary = {
        morningBriefing: 0,
        dailyAudit: 0,
        sundayPlanning: 0,
        custom: 0,
        classReminders: 0,
        deadlineWarnings: 0,
      };

      debugNotif("schedule.begin", {
        uid,
        permission,
        settingsLoaded,
        settingsSummary: {
          classReminder: currentSettings.classReminder,
          deadlineWarning: currentSettings.deadlineWarning,
          morningBriefing: currentSettings.morningBriefing,
          dailyAudit: currentSettings.dailyAudit,
          sundayPlanning: currentSettings.sundayPlanning,
        },
        timesSummary: JSON.stringify(currentTimes),
        customNotifsCount: currentCustom?.length || 0,
      });

      // Cancel all previously scheduled notifications first.
      await Notifications.cancelAllScheduledNotificationsAsync();

      if (!permission) {
        debugNotif("schedule.skipped", { reason: "permission_not_granted" });
        return;
      }

      const scheduled = [];

      // 1. Morning Briefing - time from settings (default 7:00 AM)
      if (currentSettings.morningBriefing) {
        const t = currentTimes.morningBriefing || DEFAULT_TIMES.morningBriefing;
        const id = await scheduleDailyNotification(
          "Morning Briefing",
          "Review today's classes, tasks, and deadlines.",
          t.hour,
          t.minute
        );
        if (id) {
          scheduled.push(id);
          summary.morningBriefing += 1;
        }
      }

      // 2. Daily Time Audit - time from settings (default 9:00 PM)
      if (currentSettings.dailyAudit) {
        const t = currentTimes.dailyAudit || DEFAULT_TIMES.dailyAudit;
        const id = await scheduleDailyNotification(
          "Daily Time Audit",
          "Take one minute to review your progress and plan tomorrow.",
          t.hour,
          t.minute
        );
        if (id) {
          scheduled.push(id);
          summary.dailyAudit += 1;
        }
      }

      // 3. Sunday Planning - time from settings (default 6:00 PM)
      if (currentSettings.sundayPlanning) {
        const t = currentTimes.sundayPlanning || DEFAULT_TIMES.sundayPlanning;
        const id = await scheduleWeeklyNotification(
          "Sunday Planning",
          "Plan your key study blocks and deadlines for the coming week.",
          0,
          t.hour,
          t.minute
        );
        if (id) {
          scheduled.push(id);
          summary.sundayPlanning += 1;
        }
      }

      // 4. Custom notifications
      for (const cn of currentCustom) {
        if (!cn.enabled) continue;
        try {
          if (cn.repeat === "daily") {
            const id = await scheduleDailyNotification(
              cn.title,
              cn.body,
              cn.hour,
              cn.minute
            );
            if (id) {
              scheduled.push(id);
              summary.custom += 1;
            }
          } else if (cn.repeat === "weekly" && cn.weekday !== undefined) {
            const id = await scheduleWeeklyNotification(
              cn.title,
              cn.body,
              cn.weekday,
              cn.hour,
              cn.minute
            );
            if (id) {
              scheduled.push(id);
              summary.custom += 1;
            }
          } else {
            // One-time notification
            const now = new Date();
            let triggerDate = null;

            if (cn.date) {
              const parsed = new Date(cn.date);
              if (!Number.isNaN(parsed.getTime())) {
                triggerDate = parsed;
              }
            }

            if (!triggerDate) {
              triggerDate = new Date();
            }

            triggerDate.setHours(cn.hour, cn.minute, 0, 0);

            if (cn.date) {
              // If the selected date already passed, skip scheduling
              if (triggerDate <= now) continue;
            } else if (triggerDate <= now) {
              triggerDate.setDate(triggerDate.getDate() + 1);
            }

            try {
              const id = await Notifications.scheduleNotificationAsync({
                content: buildNotificationContent(cn.title, cn.body),
                trigger: {
                  type: "date",
                  timestamp: triggerDate.getTime(),
                  channelId: ANDROID_CHANNEL_ID,
                },
              });
              if (id) {
                scheduled.push(id);
                summary.custom += 1;
              }
            } catch (err) {
              debugNotif("customNotif.error", {
                title: cn.title,
                error: err?.message || String(err),
              });
            }
          }
        } catch {}
      }

      // 5. Class reminders + deadline warnings (need Firestore data)
      const userSnap = await getDoc(doc(db, "users", uid));
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const studentInfo = userData.studentInfo || {};

        if (currentSettings.classReminder && studentInfo.course) {
          const ids = await scheduleClassReminders(
            uid,
            studentInfo,
            currentTimes
          );
          scheduled.push(...ids);
          summary.classReminders += ids.length;
        }

        if (currentSettings.deadlineWarning) {
          const ids = await scheduleDeadlineWarnings(uid);
          scheduled.push(...ids);
          summary.deadlineWarnings += ids.length;
        }
      }

      await AsyncStorage.setItem(KEYS.scheduledIds, JSON.stringify(scheduled));
      debugNotif("schedule.complete", {
        uid,
        totalScheduled: scheduled.length,
        summary,
      });
      if (
        typeof Notifications.getAllScheduledNotificationsAsync === "function"
      ) {
        try {
          const all = await Notifications.getAllScheduledNotificationsAsync();
          debugNotif("schedule.list", { total: all.length });
        } catch (err) {
          debugNotif("schedule.list.error", {
            error: err?.message || String(err),
          });
        }
      }
    } catch (err) {
      console.warn("Schedule notifications error:", err);
      debugNotif("schedule.error", {
        uid,
        error: err?.message || String(err),
      });
    }
  };

  //  Schedule class reminders for the week
  const scheduleClassReminders = async (
    uid,
    studentInfo,
    currentTimes = times
  ) => {
    const ids = [];
    try {
      const { college, course, year, section, scheduleType } = studentInfo;

      debugNotif("classReminder.lookup.start", {
        college,
        course,
        year,
        section,
        scheduleType,
      });

      if (!course || !year || !section) {
        debugNotif("classReminder.skipped", {
          reason: "missing_student_info",
          hasCourse: !!course,
          hasYear: !!year,
          hasSection: !!section,
        });
        return ids;
      }

      const minutesBefore = Math.max(
        1,
        Number(
          currentTimes?.classReminder?.minutesBefore ??
            DEFAULT_TIMES.classReminder.minutesBefore
        )
      );

      const cacheKey = `${CACHE_KEYS.schedule(uid)}_week`;
      let weekSchedule = {};

      try {
        const scheduleMatch = await findBestScheduleDoc(db, {
          college,
          course,
          year,
          section,
          scheduleType,
        });
        if (scheduleMatch?.doc) {
          weekSchedule = scheduleMatch.doc.data().weekSchedule || {};
          await saveToCache(cacheKey, weekSchedule);
          debugNotif("classReminder.source", {
            source: "firestore",
            matchSource: scheduleMatch.source,
            scheduleDocId: scheduleMatch.doc.id,
            weekScheduleDays: Object.keys(weekSchedule).join(","),
          });
        } else {
          debugNotif("classReminder.source", {
            source: "firestore_not_found",
            course,
            year,
            section,
          });
        }
      } catch (err) {
        debugNotif("classReminder.firestore_error", { error: err?.message });
        // Fallback to cache below.
      }

      if (!Object.keys(weekSchedule).length) {
        const cached = await loadFromCache(cacheKey);
        if (cached?.data) {
          weekSchedule = cached.data;
          debugNotif("classReminder.source", { source: "cache" });
        }
      }

      if (!Object.keys(weekSchedule).length) {
        debugNotif("classReminder.skipped", {
          reason: "no_schedule_data",
          hasWeekSchedule: Object.keys(weekSchedule).length > 0,
        });
        return ids;
      }

      const dayMap = {
        Sunday: 0,
        Monday: 1,
        Tuesday: 2,
        Wednesday: 3,
        Thursday: 4,
        Friday: 5,
        Saturday: 6,
      };

      const parseTimeChunk = (chunk) => {
        const match = String(chunk || "")
          .trim()
          .match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
        if (!match) return null;

        let hour = Number(match[1]);
        const minute = Number(match[2]);
        const suffix = (match[3] || "").toUpperCase();
        if (suffix === "PM" && hour < 12) hour += 12;
        if (suffix === "AM" && hour === 12) hour = 0;
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        return { hour, minute };
      };

      const parseClassRange = (cls) => {
        const startIso = parseFirestoreDate(cls?.start);
        const endIso = parseFirestoreDate(cls?.end);
        let startMeta = startIso
          ? { hour: startIso.getHours(), minute: startIso.getMinutes() }
          : null;
        let endMeta = endIso
          ? { hour: endIso.getHours(), minute: endIso.getMinutes() }
          : null;

        const timeDisplay = String(cls?.timeDisplay || "").trim();
        if (timeDisplay.includes("-")) {
          const [left, right] = timeDisplay
            .split("-")
            .map((part) => part.trim());
          if (!startMeta) startMeta = parseTimeChunk(left);
          if (!endMeta) endMeta = parseTimeChunk(right);
        } else if (!startMeta && timeDisplay) {
          startMeta = parseTimeChunk(timeDisplay);
        }

        if (!startMeta) return null;
        if (!endMeta) {
          // Default to +60 minutes when end time is missing.
          let total = startMeta.hour * 60 + startMeta.minute + 60;
          total = Math.min(total, 23 * 60 + 59);
          endMeta = {
            hour: Math.floor(total / 60),
            minute: total % 60,
          };
        }

        const startLabelDate = new Date();
        startLabelDate.setHours(startMeta.hour, startMeta.minute, 0, 0);
        const endTotalMinutes = endMeta.hour * 60 + endMeta.minute;

        return {
          startHour: startMeta.hour,
          startMinute: startMeta.minute,
          endHour: endMeta.hour,
          endMinute: endMeta.minute,
          endTotalMinutes,
          startLabel: startLabelDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
      };

      const lastClassEndByDay = {};

      for (const [dayName, classes] of Object.entries(weekSchedule)) {
        const dayOfWeek = dayMap[dayName];
        if (dayOfWeek === undefined || !Array.isArray(classes)) continue;

        for (const cls of classes) {
          const parsed = parseClassRange(cls);
          if (!parsed) continue;

          let reminderHour = parsed.startHour;
          let reminderMinute = parsed.startMinute - minutesBefore;
          let reminderWeekday = dayOfWeek;

          while (reminderMinute < 0) {
            reminderMinute += 60;
            reminderHour -= 1;
          }

          if (reminderHour < 0) {
            reminderHour += 24;
            reminderWeekday = reminderWeekday === 0 ? 6 : reminderWeekday - 1;
          }

          const id = await scheduleWeeklyNotification(
            `Class in ${minutesBefore} minutes`,
            `${cls.subject || "Your class"} starts at ${parsed.startLabel}`,
            reminderWeekday,
            reminderHour,
            reminderMinute
          );
          if (id) ids.push(id);

          const existingEnd = lastClassEndByDay[dayOfWeek];
          if (
            !existingEnd ||
            parsed.endTotalMinutes > existingEnd.endTotalMinutes
          ) {
            lastClassEndByDay[dayOfWeek] = {
              endHour: parsed.endHour,
              endMinute: parsed.endMinute,
              endTotalMinutes: parsed.endTotalMinutes,
            };
          }
        }
      }

      // Add one weekly post-class planning reminder per class day.
      for (const [dayOfWeekRaw, endMeta] of Object.entries(lastClassEndByDay)) {
        const dayOfWeek = Number(dayOfWeekRaw);
        let hour = endMeta.endHour;
        let minute = endMeta.endMinute + 5;
        while (minute >= 60) {
          minute -= 60;
          hour += 1;
        }
        if (hour >= 24) hour = 23;

        const wrapId = await scheduleWeeklyNotification(
          "Classes finished for today",
          "Review your pending tasks and update your day plan.",
          dayOfWeek,
          hour,
          minute
        );
        if (wrapId) ids.push(wrapId);
      }

      debugNotif("classReminder.scheduled", {
        total: ids.length,
        minutesBefore,
      });
    } catch (err) {
      console.warn("Class reminder error:", err);
    }
    return ids;
  };

  //  Schedule deadline warnings for upcoming tasks
  const scheduleDeadlineWarnings = async (uid) => {
    const ids = [];
    try {
      const snap = await getDocs(
        query(
          collection(db, "assignments"),
          where("userId", "==", uid),
          where("completed", "==", false)
        )
      );

      const now = new Date();

      for (const d of snap.docs) {
        const task = d.data();
        if (task?.plannerArchived) continue;
        const due = parseFirestoreDate(task?.dueAt);
        if (!due) continue;

        // Schedule warnings at 7 days, 3 days, 1 day before + exact due time.
        const warnings = [
          {
            days: 7,
            title: "Task due in 7 days",
            atDueTime: false,
            urgency: "due in 7 days",
          },
          {
            days: 3,
            title: "Task due in 3 days",
            atDueTime: false,
            urgency: "due in 3 days",
          },
          {
            days: 1,
            title: "Task due tomorrow",
            atDueTime: false,
            urgency: "due tomorrow",
          },
          {
            days: 0,
            title: "Task due now",
            atDueTime: true,
            urgency: "due now",
          },
        ];

        for (const w of warnings) {
          const triggerDate = new Date(due);

          if (!w.atDueTime) {
            triggerDate.setDate(due.getDate() - w.days);
            triggerDate.setHours(8, 0, 0, 0); // 8:00 AM on warning day
          }

          if (triggerDate <= now) continue;

          try {
            const dueStr = due.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const body = w.atDueTime
              ? `"${task.title}" (${task.subject || "No subject"}) is due now (${dueStr}). Submit it as soon as possible.`
              : `"${task.title}" (${task.subject || "No subject"}) is ${w.urgency} (${dueStr}). Start now to avoid a rush.`;

            const id = await Notifications.scheduleNotificationAsync({
              content: buildNotificationContent(w.title, body, {
                data: { type: "deadline", taskId: d.id },
                ...(w.atDueTime && { sound: true, priority: "max" }),
              }),
              trigger: {
                type: "date",
                timestamp: triggerDate.getTime(),
                channelId: ANDROID_CHANNEL_ID,
              },
            });
            ids.push(id);
          } catch {}
        }
      }
    } catch (err) {
      console.warn("Deadline warning error:", err);
    }
    return ids;
  };

  //  Helper: schedule daily repeating notification
  const scheduleDailyNotification = async (title, body, hour, minute) => {
    if (!NOTIFICATIONS_AVAILABLE) {
      debugNotif("scheduleDaily.skipped", {
        reason: IS_EXPO_GO ? "expo_go" : "notifications_module_unavailable",
        title,
      });
      return null;
    }
    try {
      return await Notifications.scheduleNotificationAsync({
        content: buildNotificationContent(title, body),
        trigger: {
          type: "daily",
          hour,
          minute,
          channelId: ANDROID_CHANNEL_ID,
        },
      });
    } catch (err) {
      debugNotif("scheduleDaily.error", {
        title,
        hour,
        minute,
        error: err?.message || String(err),
      });
      return null;
    }
  };

  //  Helper: schedule weekly repeating notification
  const scheduleWeeklyNotification = async (
    title,
    body,
    weekday,
    hour,
    minute
  ) => {
    if (!NOTIFICATIONS_AVAILABLE) {
      debugNotif("scheduleWeekly.skipped", {
        reason: IS_EXPO_GO ? "expo_go" : "notifications_module_unavailable",
        title,
      });
      return null;
    }
    try {
      return await Notifications.scheduleNotificationAsync({
        content: buildNotificationContent(title, body),
        trigger: {
          type: "weekly",
          weekday: weekday + 1,
          hour,
          minute,
          channelId: ANDROID_CHANNEL_ID,
        },
        // expo-notifications weekday: 1=Sunday, 2=Monday ... 7=Saturday
      });
    } catch (err) {
      debugNotif("scheduleWeekly.error", {
        title,
        weekday,
        hour,
        minute,
        error: err?.message || String(err),
      });
      return null;
    }
  };

  //  Update notification times
  const updateTimes = async (newTimes) => {
    try {
      const merged = { ...times, ...newTimes };
      setTimes(merged);
      await AsyncStorage.setItem(KEYS.times, JSON.stringify(merged));
      const user = auth.currentUser;
      if (user)
        await scheduleAllNotifications(
          user.uid,
          settings,
          merged,
          customNotifs
        );
    } catch {}
  };

  //  Add a custom notification
  const addCustomNotif = async (notif) => {
    // notif = { id, title, body, hour, minute, days (array of weekdays or "daily"), enabled }
    try {
      const newList = [
        ...customNotifs,
        { ...notif, id: `custom_${Date.now()}`, enabled: true },
      ];
      setCustomNotifs(newList);
      await AsyncStorage.setItem(KEYS.customNotifs, JSON.stringify(newList));
      const user = auth.currentUser;
      if (user)
        await scheduleAllNotifications(user.uid, settings, times, newList);
    } catch {}
  };

  //  Toggle/delete a custom notification
  const updateCustomNotif = async (id, changes) => {
    try {
      const newList = customNotifs.map((n) =>
        n.id === id ? { ...n, ...changes } : n
      );
      setCustomNotifs(newList);
      await AsyncStorage.setItem(KEYS.customNotifs, JSON.stringify(newList));
      const user = auth.currentUser;
      if (user)
        await scheduleAllNotifications(user.uid, settings, times, newList);
    } catch {}
  };

  const deleteCustomNotif = async (id) => {
    try {
      const newList = customNotifs.filter((n) => n.id !== id);
      setCustomNotifs(newList);
      await AsyncStorage.setItem(KEYS.customNotifs, JSON.stringify(newList));
      const user = auth.currentUser;
      if (user)
        await scheduleAllNotifications(user.uid, settings, times, newList);
    } catch {}
  };

  //  Manual reschedule (call after schedule/assignments change)
  const rescheduleAll = async () => {
    const user = auth.currentUser;
    if (user)
      await scheduleAllNotifications(user.uid, settings, times, customNotifs);
  };

  const sendTestNotification = async () => {
    if (!NOTIFICATIONS_AVAILABLE) {
      debugNotif("test.skipped", {
        reason: IS_EXPO_GO ? "expo_go" : "notifications_module_unavailable",
      });
      return { ok: false, reason: "Notifications engine unavailable." };
    }
    if (!permission) {
      debugNotif("test.skipped", { reason: "permission_not_granted" });
      return { ok: false, reason: "Notification permission not granted." };
    }
    try {
      await Notifications.scheduleNotificationAsync({
        content: buildNotificationContent(
          "Test Notification",
          "If you see this, reminders are working."
        ),
        trigger: null,
      });
      debugNotif("test.sent");
      return { ok: true };
    } catch (err) {
      const message = err?.message || String(err);
      debugNotif("test.error", { error: message });
      return { ok: false, reason: message };
    }
  };

  //  Diagnostic function to help debug notification issues
  const getNotificationDiagnostics = async () => {
    const user = auth.currentUser;
    const diagnostics = {
      notificationsAvailable: NOTIFICATIONS_AVAILABLE,
      isExpoGo: IS_EXPO_GO,
      permission,
      settingsLoaded,
      settings: settings
        ? Object.keys(settings).filter((k) => settings[k])
        : [],
      times: times ? Object.keys(times) : [],
      customNotifsCount: customNotifs?.length || 0,
      userId: user?.uid || null,
      hasUser: !!user,
    };

    // Try to get student info if user exists
    if (user) {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const studentInfo = userData?.studentInfo || {};
          diagnostics.studentInfo = {
            hasCourse: !!studentInfo.course,
            hasYear: !!studentInfo.year,
            hasSection: !!studentInfo.section,
            course: studentInfo.course,
            year: studentInfo.year,
            section: studentInfo.section,
            college: studentInfo.college,
            scheduleType: studentInfo.scheduleType,
          };
        }
      } catch (err) {
        diagnostics.studentInfoError = err?.message;
      }
    }

    return diagnostics;
  };

  return (
    <NotificationContext.Provider
      value={{
        settings,
        updateSettings,
        times,
        updateTimes,
        customNotifs,
        addCustomNotif,
        updateCustomNotif,
        deleteCustomNotif,
        permission,
        requestPermission,
        notificationsAvailable: NOTIFICATIONS_AVAILABLE,
        isExpoGo: IS_EXPO_GO,
        appUsageMin,
        weekUsageMin,
        usageGuard,
        updateUsageGuard,
        usageDaily,
        usageLimitLocked,
        usageUnlockUntil,
        extendUsageUnlock,
        rescheduleAll,
        sendTestNotification,
        getNotificationDiagnostics,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx)
    return {
      settings: DEFAULT_SETTINGS,
      updateSettings: async () => {},
      times: DEFAULT_TIMES,
      updateTimes: async () => {},
      customNotifs: [],
      addCustomNotif: async () => {},
      updateCustomNotif: async () => {},
      deleteCustomNotif: async () => {},
      permission: false,
      requestPermission: async () => {},
      notificationsAvailable: false,
      isExpoGo: false,
      appUsageMin: 0,
      weekUsageMin: 0,
      usageGuard: DEFAULT_USAGE_GUARD,
      updateUsageGuard: async () => {},
      usageDaily: {},
      usageLimitLocked: false,
      usageUnlockUntil: 0,
      extendUsageUnlock: async () => {},
      rescheduleAll: async () => {},
      sendTestNotification: async () => ({
        ok: false,
        reason: "Notifications unavailable.",
      }),
      getNotificationDiagnostics: async () => ({}),
    };
  return ctx;
}
