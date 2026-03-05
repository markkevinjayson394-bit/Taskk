/**
 * NotificationContext.js
 *
 * Central notification system for CTU Danao Time Manager.
 *
 * NOTIFICATIONS HANDLED:
 * 1. Class Reminder       — 15 min before each class
 * 2. Deadline Warning     — 7 days, 3 days, 1 day, overdue
 * 3. Morning Briefing     — every day at 7:00 AM
 * 4. Daily Time Audit     — every day at 9:00 PM
 * 5. Sunday Planning      — every Sunday at 6:00 PM
 * 6. Break Reminder       — after 90 min continuous app use
 * 7. App Usage Check      — after 30 min: "Is what you're doing study-related?"
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
    collection, doc, getDoc, getDocs, query, where,
} from "firebase/firestore";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import { auth, db } from "../config/firebase";

// ── Notification handler — show alert even when app is open ──────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// ── Storage keys ─────────────────────────────────────────────────────────────
const KEYS = {
  appStartTime:     "notif_app_start_time",
  lastBreakPrompt:  "notif_last_break_prompt",
  lastUsagePrompt:  "notif_last_usage_prompt",
  lastAuditDate:    "notif_last_audit_date",
  lastBriefingDate: "notif_last_briefing_date",
  scheduledIds:     "notif_scheduled_ids",
  settings:         "notif_settings",
  times:            "notif_times",       // custom times for each notification
  customNotifs:     "notif_custom",      // user-created custom notifications
};

// ── Default times for editable notifications ─────────────────────────────────
export const DEFAULT_TIMES = {
  morningBriefing: { hour: 7,  minute: 0  }, // 7:00 AM
  dailyAudit:      { hour: 21, minute: 0  }, // 9:00 PM
  sundayPlanning:  { hour: 18, minute: 0  }, // 6:00 PM
  classReminder:   { minutesBefore: 15      }, // 15 min before class
};

// ── Default settings (user can toggle each one) ───────────────────────────────
export const DEFAULT_SETTINGS = {
  classReminder:    true,
  deadlineWarning:  true,
  morningBriefing:  true,
  dailyAudit:       true,
  sundayPlanning:   true,
  breakReminder:    true,
  appUsageCheck:    true,
};

// ── Context ───────────────────────────────────────────────────────────────────
const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [settings,     setSettings]     = useState(DEFAULT_SETTINGS);
  const [times,        setTimes]        = useState(DEFAULT_TIMES);
  const [customNotifs, setCustomNotifs] = useState([]);
  const [permission,   setPermission]   = useState(false);
  const [appUsageMin,  setAppUsageMin]  = useState(0);

  const appStartTime   = useRef(null);
  const appStateRef    = useRef(AppState.currentState);
  const usageTimer     = useRef(null);
  const usageCheckRef  = useRef(null);

  // ── On mount ────────────────────────────────────────────────────────────────
  useEffect(() => {
    requestPermission();
    loadSettings();
    recordAppOpen();

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      sub.remove();
      if (usageTimer.current)    clearInterval(usageTimer.current);
      if (usageCheckRef.current) clearTimeout(usageCheckRef.current);
    };
  }, []);

  // Schedule notifications when user logs in
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user && permission) {
        await scheduleAllNotifications(user.uid, settings);
      }
    });
    return unsub;
  }, [permission, settings]);

  // ── Request permission ───────────────────────────────────────────────────────
  const requestPermission = async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "CTU Danao Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#007bff",
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    setPermission(status === "granted");
    return status === "granted";
  };

  // ── Load saved settings, times, and custom notifications ────────────────────
  const loadSettings = async () => {
    try {
      const raw = await AsyncStorage.getItem(KEYS.settings);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });

      const rawTimes = await AsyncStorage.getItem(KEYS.times);
      if (rawTimes) setTimes({ ...DEFAULT_TIMES, ...JSON.parse(rawTimes) });

      const rawCustom = await AsyncStorage.getItem(KEYS.customNotifs);
      if (rawCustom) setCustomNotifs(JSON.parse(rawCustom));
    } catch {}
  };

  // ── Save settings and reschedule ─────────────────────────────────────────────
  const updateSettings = async (newSettings) => {
    try {
      const merged = { ...settings, ...newSettings };
      setSettings(merged);
      await AsyncStorage.setItem(KEYS.settings, JSON.stringify(merged));
      const user = auth.currentUser;
      if (user) await scheduleAllNotifications(user.uid, merged);
    } catch {}
  };

  // ── Record app open time ─────────────────────────────────────────────────────
  const recordAppOpen = async () => {
    const now = Date.now();
    appStartTime.current = now;
    await AsyncStorage.setItem(KEYS.appStartTime, String(now));
    startUsageTracking();
  };

  // ── Track app usage time ─────────────────────────────────────────────────────
  const startUsageTracking = () => {
    if (usageTimer.current) clearInterval(usageTimer.current);

    // Update usage counter every minute
    usageTimer.current = setInterval(() => {
      if (!appStartTime.current) return;
      const mins = Math.floor((Date.now() - appStartTime.current) / 60000);
      setAppUsageMin(mins);

      // After 30 min — ask if usage is study-related
      if (mins === 30 || mins === 60 || mins === 90) {
        checkUsageRelevance(mins);
      }

      // After 90 min — break reminder
      if (mins === 90) {
        triggerBreakReminder();
      }
    }, 60000); // check every minute
  };

  // ── Handle app going to background/foreground ────────────────────────────────
  const handleAppStateChange = async (nextState) => {
    if (appStateRef.current === "active" && nextState !== "active") {
      // App going to background — pause timer
      if (usageTimer.current) clearInterval(usageTimer.current);
    }
    if (appStateRef.current !== "active" && nextState === "active") {
      // App coming to foreground — resume timer from where we left off
      recordAppOpen();
    }
    appStateRef.current = nextState;
  };

  // ── In-app usage relevance check ─────────────────────────────────────────────
  const checkUsageRelevance = async (minutes) => {
    const raw = await AsyncStorage.getItem(KEYS.lastUsagePrompt);
    const lastPrompt = raw ? parseInt(raw) : 0;
    const hoursSince = (Date.now() - lastPrompt) / 3600000;

    // Don't prompt more than once every 2 hours
    if (hoursSince < 2) return;

    await AsyncStorage.setItem(KEYS.lastUsagePrompt, String(Date.now()));

    Alert.alert(
      `📱 ${minutes} Minutes on App`,
      "You've been using this app for a while. Is what you're doing right now related to your studies?",
      [
        {
          text: "✅ Yes, studying",
          onPress: () => {
            // Reset timer — they're being productive
            appStartTime.current = Date.now();
          },
        },
        {
          text: "😅 Not really",
          onPress: () => {
            Alert.alert(
              "Time to Refocus 💪",
              "No worries! Try switching to your Tasks or Schedule to get back on track.",
              [{ text: "Got it" }]
            );
          },
        },
      ]
    );
  };

  // ── In-app break reminder ────────────────────────────────────────────────────
  const triggerBreakReminder = async () => {
    const raw = await AsyncStorage.getItem(KEYS.lastBreakPrompt);
    const lastPrompt = raw ? parseInt(raw) : 0;
    const hoursSince = (Date.now() - lastPrompt) / 3600000;
    if (hoursSince < 1.5) return;

    await AsyncStorage.setItem(KEYS.lastBreakPrompt, String(Date.now()));

    Alert.alert(
      "☕ Time for a Break!",
      "You've been studying for 90 minutes straight. Research shows taking a 10–15 minute break improves focus and memory retention.",
      [
        { text: "Take a Break 😌", onPress: () => { appStartTime.current = Date.now(); } },
        { text: "Keep Going 💪",   style: "cancel" },
      ]
    );
  };

  // ── Schedule ALL push notifications ─────────────────────────────────────────
  const scheduleAllNotifications = async (uid, currentSettings, currentTimes = times, currentCustom = customNotifs) => {
    try {
      // Cancel all previously scheduled notifications first
      await Notifications.cancelAllScheduledNotificationsAsync();

      if (!permission) return;

      const scheduled = [];

      // 1. Morning Briefing — time from settings (default 7:00 AM)
      if (currentSettings.morningBriefing) {
        const t = currentTimes.morningBriefing || DEFAULT_TIMES.morningBriefing;
        const id = await scheduleDailyNotification(
          "☀️ Good Morning!",
          "Check your classes and tasks for today. You've got this!",
          t.hour, t.minute,
        );
        if (id) scheduled.push(id);
      }

      // 2. Daily Time Audit — time from settings (default 9:00 PM)
      if (currentSettings.dailyAudit) {
        const t = currentTimes.dailyAudit || DEFAULT_TIMES.dailyAudit;
        const id = await scheduleDailyNotification(
          "📝 How was your day?",
          "Take 1 minute to reflect on how you used your time today.",
          t.hour, t.minute,
        );
        if (id) scheduled.push(id);
      }

      // 3. Sunday Planning — time from settings (default 6:00 PM)
      if (currentSettings.sundayPlanning) {
        const t = currentTimes.sundayPlanning || DEFAULT_TIMES.sundayPlanning;
        const id = await scheduleWeeklyNotification(
          "📅 Plan Your Week",
          "Take 5 minutes to plan your study schedule for the week ahead.",
          0, t.hour, t.minute, // Sunday = 0
        );
        if (id) scheduled.push(id);
      }

      // 4. Custom notifications
      for (const cn of currentCustom) {
        if (!cn.enabled) continue;
        try {
          if (cn.repeat === "daily") {
            const id = await scheduleDailyNotification(cn.title, cn.body, cn.hour, cn.minute);
            if (id) scheduled.push(id);
          } else if (cn.repeat === "weekly" && cn.weekday !== undefined) {
            const id = await scheduleWeeklyNotification(cn.title, cn.body, cn.weekday, cn.hour, cn.minute);
            if (id) scheduled.push(id);
          } else {
            // One-time notification
            const triggerDate = new Date();
            triggerDate.setHours(cn.hour, cn.minute, 0, 0);
            if (triggerDate <= new Date()) triggerDate.setDate(triggerDate.getDate() + 1);
            const id = await Notifications.scheduleNotificationAsync({
              content: { title: cn.title, body: cn.body },
              trigger: { date: triggerDate },
            });
            if (id) scheduled.push(id);
          }
        } catch {}
      }

      // 4. Class Reminders + Deadline Warnings (need Firestore data)
      const userSnap = await getDoc(doc(db, "users", uid));
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const studentInfo = userData.studentInfo || {};

        // Class reminders
        if (currentSettings.classReminder && studentInfo.course) {
          const ids = await scheduleClassReminders(studentInfo);
          scheduled.push(...ids);
        }

        // Deadline warnings
        if (currentSettings.deadlineWarning) {
          const ids = await scheduleDeadlineWarnings(uid);
          scheduled.push(...ids);
        }
      }

      await AsyncStorage.setItem(KEYS.scheduledIds, JSON.stringify(scheduled));
    } catch (err) {
      console.warn("Schedule notifications error:", err);
    }
  };

  // ── Schedule class reminders for the week ────────────────────────────────────
  const scheduleClassReminders = async (studentInfo) => {
    const ids = [];
    try {
      const { course, year, section, scheduleType } = studentInfo;
      const snap = await getDocs(query(
        collection(db, "schedules"),
        where("course", "==", course), where("year", "==", year),
        where("section", "==", section), where("scheduleType", "==", scheduleType),
      ));
      if (snap.empty) return ids;

      const weekSchedule = snap.docs[0].data().weekSchedule || {};
      const dayMap = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };

      for (const [dayName, classes] of Object.entries(weekSchedule)) {
        const dayOfWeek = dayMap[dayName];
        if (dayOfWeek === undefined) continue;

        for (const cls of classes) {
          if (!cls.start) continue;
          try {
            const startDate = new Date(cls.start);
            const reminderHour   = startDate.getHours();
            const reminderMinute = startDate.getMinutes() - 15;

            // Adjust if reminder crosses the hour boundary
            const adjustedHour   = reminderMinute < 0 ? reminderHour - 1 : reminderHour;
            const adjustedMinute = reminderMinute < 0 ? 60 + reminderMinute : reminderMinute;
            if (adjustedHour < 0) continue;

            const id = await scheduleWeeklyNotification(
              `🔔 Class in 15 minutes`,
              `${cls.subject} starts at ${startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
              dayOfWeek,
              adjustedHour,
              adjustedMinute,
            );
            if (id) ids.push(id);
          } catch {}
        }
      }
    } catch (err) {
      console.warn("Class reminder error:", err);
    }
    return ids;
  };

  // ── Schedule deadline warnings for upcoming tasks ────────────────────────────
  const scheduleDeadlineWarnings = async (uid) => {
    const ids = [];
    try {
      const snap = await getDocs(query(
        collection(db, "assignments"),
        where("userId", "==", uid),
        where("completed", "==", false),
      ));

      const now = new Date();

      for (const d of snap.docs) {
        const task = d.data();
        if (!task.dueAt) continue;
        const due = task.dueAt.toDate();

        // Schedule warnings at 7 days, 3 days, 1 day before + exact due time
        const warnings = [
          { days: 7, emoji: "📌", urgency: "due in 7 days",  atDueTime: false },
          { days: 3, emoji: "⚠️",  urgency: "due in 3 days",  atDueTime: false },
          { days: 1, emoji: "🔴", urgency: "due TOMORROW",   atDueTime: false },
          { days: 0, emoji: "⏰", urgency: "is due RIGHT NOW",  atDueTime: true  },
        ];

        for (const w of warnings) {
          const triggerDate = new Date(due);

          if (!w.atDueTime) {
            triggerDate.setDate(due.getDate() - w.days);
            triggerDate.setHours(8, 0, 0, 0); // 8am on warning day
          }
          // atDueTime: triggerDate stays as exact due date/time

          if (triggerDate <= now) continue; // already passed

          try {
            const id = await Notifications.scheduleNotificationAsync({
              content: {
                title: w.atDueTime ? "⏰ Task Overdue!" : `${w.emoji} Task Reminder`,
                body:  w.atDueTime
                  ? `"${task.title}" is due RIGHT NOW. Submit it before it's too late!`
                  : `"${task.title}" is ${w.urgency}. Don't leave it to the last minute!`,
                data:  { type: "deadline", taskId: d.id },
                ...(w.atDueTime && { sound: true, priority: "max" }),
              },
              trigger: { date: triggerDate },
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

  // ── Helper: schedule daily repeating notification ────────────────────────────
  const scheduleDailyNotification = async (title, body, hour, minute) => {
    try {
      return await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { hour, minute, repeats: true },
      });
    } catch { return null; }
  };

  // ── Helper: schedule weekly repeating notification ───────────────────────────
  const scheduleWeeklyNotification = async (title, body, weekday, hour, minute) => {
    try {
      return await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { weekday: weekday + 1, hour, minute, repeats: true },
        // expo-notifications weekday: 1=Sunday, 2=Monday ... 7=Saturday
      });
    } catch { return null; }
  };

  // ── Update notification times ────────────────────────────────────────────────
  const updateTimes = async (newTimes) => {
    try {
      const merged = { ...times, ...newTimes };
      setTimes(merged);
      await AsyncStorage.setItem(KEYS.times, JSON.stringify(merged));
      const user = auth.currentUser;
      if (user) await scheduleAllNotifications(user.uid, settings, merged, customNotifs);
    } catch {}
  };

  // ── Add a custom notification ─────────────────────────────────────────────────
  const addCustomNotif = async (notif) => {
    // notif = { id, title, body, hour, minute, days (array of weekdays or "daily"), enabled }
    try {
      const newList = [...customNotifs, { ...notif, id: `custom_${Date.now()}`, enabled: true }];
      setCustomNotifs(newList);
      await AsyncStorage.setItem(KEYS.customNotifs, JSON.stringify(newList));
      const user = auth.currentUser;
      if (user) await scheduleAllNotifications(user.uid, settings, times, newList);
    } catch {}
  };

  // ── Toggle/delete a custom notification ──────────────────────────────────────
  const updateCustomNotif = async (id, changes) => {
    try {
      const newList = customNotifs.map((n) => n.id === id ? { ...n, ...changes } : n);
      setCustomNotifs(newList);
      await AsyncStorage.setItem(KEYS.customNotifs, JSON.stringify(newList));
      const user = auth.currentUser;
      if (user) await scheduleAllNotifications(user.uid, settings, times, newList);
    } catch {}
  };

  const deleteCustomNotif = async (id) => {
    try {
      const newList = customNotifs.filter((n) => n.id !== id);
      setCustomNotifs(newList);
      await AsyncStorage.setItem(KEYS.customNotifs, JSON.stringify(newList));
      const user = auth.currentUser;
      if (user) await scheduleAllNotifications(user.uid, settings, times, newList);
    } catch {}
  };

  // ── Manual reschedule (call after schedule/assignments change) ───────────────
  const rescheduleAll = async () => {
    const user = auth.currentUser;
    if (user) await scheduleAllNotifications(user.uid, settings, times, customNotifs);
  };

  return (
    <NotificationContext.Provider value={{
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
      appUsageMin,
      rescheduleAll,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) return {
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
    appUsageMin: 0,
    rescheduleAll: async () => {},
  };
  return ctx;
}
