/**
 * NotificationContext.js
 *
 * Central notification system for CTU Academic Task Manager.
 *
 * NOTIFICATIONS HANDLED:
 * 1. Class Reminder        X min before each class
 * 2. Study Session Reminder before planner study blocks
 * 3. Deadline Warning      7d, 3d, 1d, 12h, 6h, 3h, 2h, 1h, 30m, 15m, due-time follow-ups, daily overdue
 * 4. Morning Briefing      every day at 7:00 AM
 * 5. Daily Time Audit      every day at 9:00 PM
 * 6. Sunday Planning       every Sunday at 6:00 PM
 *
 * FIXES APPLIED:
 * - [FIX 1] scheduleClassReminders: Added getNextWeekdayTime() helper and skip logic
 *   so class reminders whose weekly slot has already passed this week are NOT
 *   scheduled immediately (which caused all-at-once firing). They will fire on
 *   the correct day next week instead.
 * - [FIX 2] requestPermission / handlePermission: After granting permission,
 *   rescheduleAll() is called immediately so settings take effect without restart.
 * - [FIX 3] Removed ackPrompt overlay entirely. DeadlineAlarmModal is the sole
 *   popup for deadline/alarm acknowledgment. maybeShowAckPrompt,
 *   maybePromptOverdueAlarmTask, handleAcknowledgePrompt, handleMarkDoneFromPrompt,
 *   and the vibration effect have all been removed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
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
import { AppState, Platform } from "react-native";
import { auth, db } from "../config/firebase";
import {
  BACKGROUND_ALARM_TASK,
  enableBackgroundAlarms,
} from "../utils/backgroundAlarmChecker";
import {
  loadLocalClassSchedule,
  saveLocalClassSchedule,
} from "../utils/classScheduleCache";
import {
  cancelDeadlineAlarms,
  rescheduleAllDeadlineAlarms,
} from "../utils/deadlineAlarmBackground";
import { formatDeadlineCountdown } from "../utils/deadlineTime";
import { reportError, reportWarning, warnIfDev } from "../utils/logger";
import {
  cancelNativeAlarmByScheduledId,
  canPickNativeAlarmAudioFile,
  canPickNativeAlarmTone,
  canScheduleExactAlarms,
  isIgnoringBatteryOptimizations,
  isNativeAlarmScheduledId,
  isNativeAlarmSupported,
  openExactAlarmSettings,
  pickNativeAlarmAudioFile,
  pickNativeAlarmTone,
  requestIgnoreBatteryOptimizations,
  scheduleNativeAlarm,
  stopActiveNativeAlarm,
  toNativeAlarmScheduledId,
} from "../utils/nativeAlarm";
import {
  buildManagedNotificationData,
  buildNotificationId,
} from "../utils/notificationIds";
import { findBestScheduleDoc } from "../utils/scheduleMatcher";
import { isPlannerTask } from "../utils/taskFilters";

const IS_EXPO_GO = Constants.appOwnership === "expo";
let TaskManager = null;
try {
  TaskManager = require("expo-task-manager");
} catch (error) {
  warnIfDev(
    "TaskManager module unavailable - background alarm checks disabled for this binary",
    error
  );
  TaskManager = null;
}
const isTaskManagerTaskDefined = (taskName) => {
  if (!TaskManager || typeof TaskManager.isTaskDefined !== "function") {
    return false;
  }
  try {
    return TaskManager.isTaskDefined(taskName);
  } catch (err) {
    warnIfDev("NotificationContext: TaskManager.isTaskDefined failed:", err);
    return false;
  }
};
let Notifications = null;
try {
  Notifications = require("expo-notifications");
} catch (err) {
  warnIfDev(
    "Notifications module unavailable - running in Expo Go or notifications not installed",
    err
  );
}
const NOTIFICATIONS_AVAILABLE =
  Boolean(Notifications) &&
  typeof Notifications.scheduleNotificationAsync === "function" &&
  typeof Notifications.requestPermissionsAsync === "function" &&
  typeof Notifications.setNotificationChannelAsync === "function";
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
const keyForUser = (base, uid) => (uid ? `${base}_${uid}` : base);
const KEYS = {
  lastAuditDate: (uid) => keyForUser("notif_last_audit_date", uid),
  lastBriefingDate: (uid) => keyForUser("notif_last_briefing_date", uid),
  scheduledIds: (uid) => keyForUser("notif_scheduled_ids", uid),
  settings: (uid) => keyForUser("notif_settings", uid),
  times: (uid) => keyForUser("notif_times", uid),
  customNotifs: (uid) => keyForUser("notif_custom", uid),
  ackSuppress: (uid) => keyForUser("notif_ack_suppress_until", uid),
  seenAnnouncements: (uid) => `notif_seen_announcements_${uid}`,
  batteryPromptDismiss: (uid) => keyForUser("notif_battery_prompt_dismiss", uid),
};
const ANDROID_CHANNEL_ID = "study-reminders-v4";
const ANDROID_NOTIFICATION_SOUND = "ctu_alarm.wav";
const ALARM_ACK_CATEGORY_ID = "deadline_alarm_ack";
const ACTION_NOT_DONE = "not_done_deadline_alarm";
const ACTION_MARK_DONE = "mark_done_deadline_alarm";
const LAST_HANDLED_RESPONSE_KEY = "last_handled_notif_response_id";
const ENV_NOTIF_DEBUG =
  typeof process !== "undefined" && process?.env?.EXPO_PUBLIC_NOTIF_DEBUG;
const NOTIF_DEBUG = ENV_NOTIF_DEBUG === "1" || ENV_NOTIF_DEBUG === "true";
const ANNOUNCEMENT_FETCH_LIMIT = 40;
const ANNOUNCEMENT_POLL_MS = 2 * 60 * 1000;
const ANNOUNCEMENT_TRACK_LIMIT = 200;
const DAILY_TRIGGER_LOOKAHEAD_DAYS = 7;
const WEEKLY_TRIGGER_LOOKAHEAD_WEEKS = 4;
const TOMORROW_DIGEST_HOUR = 19;
const TOMORROW_DIGEST_MINUTE = 0;
const TOMORROW_DIGEST_PREVIEW_LIMIT = 3;
const SCHEDULE_REBUILD_COOLDOWN_MS = 5 * 60 * 1000;
const MANUAL_RESCHEDULE_DEBOUNCE_MS = 750;
const STUDY_SESSION_LOOKAHEAD_DAYS = 14;
const MAX_STUDY_SESSION_REMINDERS = 48;

//
// [FIX 1] Helper: returns the next Date for a given weekday/hour/minute.
// If this week's slot has already passed, returns next week's occurrence.
// This prevents Android from firing the reminder immediately as "catch-up"
// when a weekly trigger is scheduled for a time that already passed.
//
function getNextWeekdayTime(weekday, hour, minute, baseDate = new Date()) {
  const result = new Date(baseDate);
  result.setHours(hour, minute, 0, 0);
  const currentDay = result.getDay(); // 0=Sun  6=Sat
  let daysUntil = weekday - currentDay;
  if (daysUntil < 0 || (daysUntil === 0 && result <= baseDate)) {
    daysUntil += 7;
  }
  result.setDate(result.getDate() + daysUntil);
  return result;
}
function debugNotif(event, payload = {}) {
  if (!NOTIF_DEBUG) return;
  const ts = new Date().toISOString();
  let detail = "";
  if (payload !== undefined) {
    if (typeof payload === "string") detail = payload;
    else {
      try {
        detail = JSON.stringify(payload);
      } catch (err) {
        warnIfDev(
          "NotificationContext: failed to stringify debug payload:",
          err
        );
        detail = String(payload);
      }
    }
  }
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[Notif] [${ts}] ${event}${suffix}`);
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
function isPlannerAssignment(task = {}) {
  return isPlannerTask(task);
}
function formatLeadLabel(minutesBefore) {
  if (!Number.isFinite(minutesBefore) || minutesBefore <= 0) return "soon";
  if (minutesBefore % (24 * 60) === 0) {
    const days = minutesBefore / (24 * 60);
    return days === 1 ? "tomorrow" : `in ${days} days`;
  }
  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }
  return `in ${minutesBefore} minutes`;
}
function startOfLocalDay(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}
function isDueToday(dueDate, baseDate = new Date()) {
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime()))
    return false;
  const todayStart = startOfLocalDay(baseDate);
  if (!todayStart) return false;
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  return dueDate >= todayStart && dueDate < tomorrowStart;
}
function isDueTomorrow(dueDate, baseDate = new Date()) {
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime()))
    return false;
  const todayStart = startOfLocalDay(baseDate);
  if (!todayStart) return false;
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterStart = new Date(tomorrowStart);
  dayAfterStart.setDate(dayAfterStart.getDate() + 1);
  return dueDate >= tomorrowStart && dueDate < dayAfterStart;
}
function formatClockTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
function formatEstimatedWorkLabel(value) {
  const mins = Math.round(Number(value));
  if (!Number.isFinite(mins) || mins <= 0) return "";
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours > 0 && rem > 0) return `Est. ${hours}h ${rem}m`;
  if (hours > 0) return `Est. ${hours}h`;
  return `Est. ${rem}m`;
}
function shouldScheduleTodayDigest(tasks = [], now = new Date()) {
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  if (tasks.length > 1) return true;
  const [task] = tasks;
  const minutesUntilDue = Math.round(
    (task.due.getTime() - now.getTime()) / 60000
  );
  const estimatedMinutes = Number(task?.estimatedMinutes) || 0;
  return (
    task?.priority === "high" ||
    task?.due?.getHours?.() < 10 ||
    estimatedMinutes >= 90 ||
    minutesUntilDue <= 120
  );
}
function buildTodayDigestContent(tasks = [], now = new Date()) {
  const ordered = [...tasks].sort((a, b) => a.due.getTime() - b.due.getTime());
  if (ordered.length === 1) {
    const [task] = ordered;
    const minutesLeft = Math.round(
      (task.due.getTime() - now.getTime()) / 60000
    );
    const urgency =
      minutesLeft <= 60
        ? "Finish it now."
        : minutesLeft <= 120
          ? "Wrap it up soon."
          : "Plan your work block now.";
    return {
      title: "Task due today",
      body: `"${task.title}" (${task.subject}) is due today at ${formatClockTime(task.due)}. ${urgency}`,
    };
  }
  const preview = ordered
    .slice(0, 3)
    .map((task) => `${task.title} ${formatClockTime(task.due)}`)
    .join("; ");
  const extra = ordered.length > 3 ? `; +${ordered.length - 3} more` : "";
  return {
    title: `${ordered.length} tasks due today`,
    body: `${preview}${extra}. First due at ${formatClockTime(ordered[0].due)}.`,
  };
}
function buildTodayDigestTrigger(now = new Date()) {
  const trigger = new Date(now);
  trigger.setHours(8, 0, 0, 0);
  if (trigger > now) return trigger;

  const latestSameDay = new Date(now);
  latestSameDay.setHours(21, 0, 0, 0);
  if (now < latestSameDay) {
    const soon = new Date(now.getTime() + 2 * 60 * 1000);
    soon.setSeconds(0, 0);
    return soon;
  }

  return null;
}
function getTodayDigestScheduledIds(scheduled = []) {
  if (!Array.isArray(scheduled)) return [];
  return scheduled
    .map((item) => item?.request?.identifier || item?.identifier || "")
    .filter(
      (id) => typeof id === "string" && id.includes("deadline-digest-today")
    );
}
async function isTodayDigestAlreadyScheduled(scheduled = null) {
  if (Array.isArray(scheduled)) {
    return getTodayDigestScheduledIds(scheduled).length > 0;
  }
  if (
    !NOTIFICATIONS_AVAILABLE ||
    typeof Notifications.getAllScheduledNotificationsAsync !== "function"
  ) {
    return false;
  }
  try {
    const allScheduled =
      await Notifications.getAllScheduledNotificationsAsync();
    return getTodayDigestScheduledIds(allScheduled).length > 0;
  } catch {
    return false;
  }
}
function shouldScheduleTomorrowDigest(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  if (tasks.length > 1) return true;
  const [task] = tasks;
  const estimatedMinutes = Number(task?.estimatedMinutes) || 0;
  return (
    task?.priority === "high" ||
    task?.due?.getHours?.() < 10 ||
    estimatedMinutes >= 90
  );
}
function buildDueTomorrowDigestTrigger(now = new Date()) {
  const trigger = new Date(now);
  trigger.setHours(TOMORROW_DIGEST_HOUR, TOMORROW_DIGEST_MINUTE, 0, 0);
  if (trigger > now) return trigger;
  const latestSameEvening = new Date(now);
  latestSameEvening.setHours(22, 0, 0, 0);
  if (now < latestSameEvening) {
    const soon = new Date(now.getTime() + 2 * 60 * 1000);
    soon.setSeconds(0, 0);
    return soon;
  }
  return null;
}
function buildTomorrowDigestContent(tasks = []) {
  const priorityRank = { high: 0, medium: 1, low: 2, none: 3 };
  const ordered = [...tasks].sort((a, b) => {
    const aRank =
      priorityRank[String(a?.priority || "medium").toLowerCase()] ?? 1;
    const bRank =
      priorityRank[String(b?.priority || "medium").toLowerCase()] ?? 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.due.getTime() - b.due.getTime();
  });
  if (ordered.length === 1) {
    const [task] = ordered;
    const estimate = formatEstimatedWorkLabel(task.estimatedMinutes);
    const actionText =
      task.due.getHours() < 10
        ? "Finish it tonight if you can."
        : "Set aside a block tonight.";
    return {
      title: "Task due tomorrow",
      body: `"${task.title}" (${task.subject}) is due tomorrow at ${formatClockTime(task.due)}.${estimate ? ` ${estimate}.` : ""} ${actionText}`,
    };
  }
  const preview = ordered
    .slice(0, TOMORROW_DIGEST_PREVIEW_LIMIT)
    .map((task) => `${task.title} ${formatClockTime(task.due)}`)
    .join("; ");
  const extraCount = Math.max(
    ordered.length - TOMORROW_DIGEST_PREVIEW_LIMIT,
    0
  );
  const extraText = extraCount > 0 ? `; +${extraCount} more` : "";
  const totalEstimated = ordered.reduce(
    (sum, task) => sum + (Number(task.estimatedMinutes) || 0),
    0
  );
  const estimate =
    totalEstimated > 0
      ? ` ${formatEstimatedWorkLabel(totalEstimated)} total.`
      : "";
  return {
    title: `${ordered.length} tasks due tomorrow`,
    body: `${preview}${extraText}. First due ${formatClockTime(ordered[0].due)}.${estimate} Plan your first task tonight.`,
  };
}
function getAlarmStyleContentOptions({
  includeActions = false,
  dueNow = false,
  sticky = true,
} = {}) {
  const base = includeActions
    ? { categoryIdentifier: ALARM_ACK_CATEGORY_ID }
    : {};
  if (Platform.OS !== "android") return base;
  return {
    ...base,
    sound: ANDROID_NOTIFICATION_SOUND,
    priority: dueNow ? "max" : "high",
    autoDismiss: sticky ? false : true,
    sticky,
  };
}
function buildAckKey(prefix = "notif") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function getGlobalAcknowledgeContentOptions(
  forceAcknowledgeAll,
  data = {},
  options = {}
) {
  if (!forceAcknowledgeAll) return {};
  const safeData = data && typeof data === "object" ? data : {};
  const typePrefix =
    typeof safeData.type === "string" && safeData.type.trim()
      ? safeData.type.trim()
      : "notif";
  const ackKey =
    typeof safeData.ackKey === "string" && safeData.ackKey.trim()
      ? safeData.ackKey.trim()
      : buildAckKey(typePrefix);
  return {
    data: {
      ...safeData,
      acknowledgeRequired: true,
      ackKey,
    },
    ...getAlarmStyleContentOptions({
      includeActions: true,
      dueNow: Boolean(options?.dueNow),
      sticky: true,
    }),
  };
}
function buildNotificationContent(title, body, extra = {}) {
  return {
    title,
    body,
    ...extra,
    ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
  };
}
function toScheduledIdArray(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (item) => typeof item === "string" && item
  );
}
function extractAckPayloadFromNotification(notification) {
  const request = notification?.request;
  const content = request?.content || {};
  const data = content?.data || {};
  if (!data?.acknowledgeRequired) return null;
  const taskId =
    typeof data?.taskId === "string" && data.taskId.trim()
      ? data.taskId.trim()
      : null;
  const ackKey =
    typeof data?.ackKey === "string" && data.ackKey.trim()
      ? data.ackKey.trim()
      : null;
  const rawDueAtMs = Number(data?.dueAtMs);
  const fallbackDueAtMs =
    Number.isFinite(rawDueAtMs) || typeof data?.dueAt !== "string"
      ? NaN
      : new Date(data.dueAt).getTime();
  const dueAtMs = Number.isFinite(rawDueAtMs)
    ? rawDueAtMs
    : Number.isFinite(fallbackDueAtMs)
      ? fallbackDueAtMs
      : null;
  if (!taskId && !ackKey) return null;
  return {
    taskId,
    ackKey,
    dueAtMs,
    notificationType:
      typeof data?.notificationType === "string" && data.notificationType.trim()
        ? data.notificationType.trim()
        : typeof data?.type === "string" && data.type.trim()
          ? data.type.trim()
          : null,
    title:
      typeof content?.title === "string" && content.title.trim()
        ? content.title.trim()
        : "Task reminder",
    body:
      typeof content?.body === "string" && content.body.trim()
        ? content.body.trim()
        : "Please review this pending task.",
    notificationId:
      typeof request?.identifier === "string" ? request.identifier : null,
  };
}
export const DEFAULT_TIMES = {
  morningBriefing: { hour: 7, minute: 0 },
  dailyAudit: { hour: 21, minute: 0 },
  sundayPlanning: { hour: 18, minute: 0 },
  classReminder: { minutesBefore: 15 },
  studySessionReminder: { minutesBefore: 10 },
};
export const DEFAULT_SETTINGS = {
  classReminder: true,
  studySessionReminder: true,
  deadlineWarning: true,
  announcementAlert: true,
  morningBriefing: true,
  dailyAudit: true,
  sundayPlanning: true,
  taskAlarmSoundUri: "",
  taskAlarmSoundLabel: "App Alarm",
  forceAcknowledgeAll: true,
};
const LOCAL_ONLY_NOTIFICATION_SETTING_KEYS = [
  "taskAlarmSoundUri",
  "taskAlarmSoundLabel",
];
const normalizeTaskAlarmSoundSettings = (settings = {}) => ({
  taskAlarmSoundUri:
    typeof settings?.taskAlarmSoundUri === "string"
      ? settings.taskAlarmSoundUri.trim()
      : DEFAULT_SETTINGS.taskAlarmSoundUri,
  taskAlarmSoundLabel:
    typeof settings?.taskAlarmSoundLabel === "string" &&
    settings.taskAlarmSoundLabel.trim()
      ? settings.taskAlarmSoundLabel.trim()
      : DEFAULT_SETTINGS.taskAlarmSoundLabel,
});
const stripLocalOnlyNotificationSettings = (settings = {}) => {
  const next = { ...settings };
  LOCAL_ONLY_NOTIFICATION_SETTING_KEYS.forEach((key) => {
    delete next[key];
  });
  return next;
};
const mergeLocalOnlyNotificationSettings = (
  baseSettings = {},
  localSettings = {}
) => ({
  ...baseSettings,
  ...normalizeTaskAlarmSoundSettings(localSettings),
});
const NotificationContext = createContext(null);
export function NotificationProvider({ children }) {
  const router = useRouter();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [times, setTimes] = useState(DEFAULT_TIMES);
  const [customNotifs, setCustomNotifs] = useState([]);
  const [permission, setPermission] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const settingsRef = useRef(DEFAULT_SETTINGS);
  const timesRef = useRef(DEFAULT_TIMES);
  const customNotifsRef = useRef([]);
  const permissionRef = useRef(false);
  const settingsLoadedRef = useRef(false);
  const notificationResponsePendingRef = useRef(false);
  const suppressPromptUntilRef = useRef({});
  const scheduleGateRef = useRef({ inFlight: false, lastKey: "", lastAt: 0 });
  const scheduleRunRef = useRef(false);
  const lastScheduleStateRef = useRef({ key: "", at: 0 });
  const bypassCooldownTaskIdsRef = useRef(new Set());
  const manualRescheduleRef = useRef({ timer: null, waiters: [] });
  const exactAlarmPermissionMissingLoggedRef = useRef(false);
  const mountedRef = useRef(true);
  const batteryOptimizationCheckedRef = useRef(false);
  const [showBatteryOptimizationPrompt, setShowBatteryOptimizationPrompt] = useState(false);

  const persistPromptSuppressionMap = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await AsyncStorage.setItem(
        KEYS.ackSuppress(uid),
        JSON.stringify(suppressPromptUntilRef.current)
      );
    } catch (err) {
      warnIfDev(
        "NotificationContext: failed to persist ack suppression state:",
        err
      );
    }
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const init = async () => {
      requestPermission();
      await loadSettings();
    };
    init();
    return () => {
      if (manualRescheduleRef.current.timer) {
        clearTimeout(manualRescheduleRef.current.timer);
        manualRescheduleRef.current.timer = null;
      }
      const pending = manualRescheduleRef.current.waiters.splice(
        0,
        manualRescheduleRef.current.waiters.length
      );
      pending.forEach((resolve) => resolve());
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    permissionRef.current = permission;
  }, [permission]);
  useEffect(() => {
    settingsLoadedRef.current = settingsLoaded;
  }, [settingsLoaded]);
  useEffect(() => {
    timesRef.current = times;
  }, [times]);
  useEffect(() => {
    customNotifsRef.current = customNotifs;
  }, [customNotifs]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!NOTIFICATIONS_AVAILABLE) return undefined;

    let appState = AppState.currentState;
    let checkingPermission = false;

    const handleAppActivated = async () => {
      if (checkingPermission) return;
      checkingPermission = true;

      try {
        const permissionStatus = await getNotificationPermissionStatus();
        const granted = permissionStatus?.status === "granted";
        const previouslyGranted = permissionRef.current;

        if (granted !== previouslyGranted) {
          setPermission(granted);
        }

        if (!previouslyGranted && granted) {
          exactAlarmPermissionMissingLoggedRef.current = false;
          await enableBackgroundAlarms();
          if (auth.currentUser && settingsLoadedRef.current) {
            await rescheduleAll();
          }
        }
      } catch (err) {
        warnIfDev(
          "NotificationContext: failed to refresh permission on foreground:",
          err
        );
      } finally {
        checkingPermission = false;
      }
    };

    const sub = AppState.addEventListener("change", (nextState) => {
      const wasBackgrounded =
        appState === "background" || appState === "inactive";
      appState = nextState;
      if (wasBackgrounded && nextState === "active") {
        void handleAppActivated();
      }
    });

    return () => {
      sub.remove();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const scheduleNativeExactAlarm = async ({
    alarmId,
    triggerDate,
    title,
    body,
    payload,
  }) => {
    if (!isNativeAlarmSupported || Platform.OS !== "android") return null;

    const triggerAt = triggerDate?.getTime?.();
    if (!Number.isFinite(triggerAt) || triggerAt <= Date.now()) return null;

    const exactAlarmResult = await canScheduleExactAlarms();
    if (exactAlarmResult?.status !== "success" || !exactAlarmResult.value) {
      if (!exactAlarmPermissionMissingLoggedRef.current) {
        debugNotif("nativeAlarm.permission_missing", {
          alarmId,
          status: exactAlarmResult?.status,
          reason: "exact_alarm_not_allowed",
        });
        exactAlarmPermissionMissingLoggedRef.current = true;
      }
      return null;
    }

    try {
      const result = await scheduleNativeAlarm({
        alarmId,
        triggerAt,
        title,
        body,
        payload,
      });
      const nativeId = result ? result : null;
      if (nativeId) {
        debugNotif("nativeAlarm.scheduled", { alarmId, triggerAt });
      }
      return nativeId || null;
    } catch (err) {
      debugNotif("nativeAlarm.schedule_error", {
        alarmId,
        error: err?.message || String(err),
      });
      return null;
    }
  };

  const buildManagedContentExtra = (identifier, contentExtra = {}) => {
    const extra =
      contentExtra && typeof contentExtra === "object" ? contentExtra : {};
    const extraData =
      extra.data && typeof extra.data === "object" ? extra.data : {};
    return {
      ...extra,
      data: buildManagedNotificationData(identifier, extraData),
    };
  };

  const scheduleManagedDateNotification = async ({
    identifier,
    title,
    body,
    triggerDate,
    contentExtra = {},
    preferExactAlarm = false,
  }) => {
    if (!NOTIFICATIONS_AVAILABLE) return null;
    if (!(triggerDate instanceof Date) || Number.isNaN(triggerDate.getTime())) {
      return null;
    }

    const resolvedIdentifier =
      typeof identifier === "string" && identifier.trim()
        ? identifier.trim()
        : buildNotificationId(
            "scheduled",
            Date.now(),
            Math.random().toString(36).slice(2, 8)
          );
    const managedContentExtra = buildManagedContentExtra(
      resolvedIdentifier,
      contentExtra
    );

    if (preferExactAlarm && Platform.OS === "android") {
      const nativeId = await scheduleNativeExactAlarm({
        alarmId: resolvedIdentifier,
        triggerDate,
        title,
        body,
        payload: managedContentExtra.data,
      });
      if (nativeId) return nativeId;
    }

    return Notifications.scheduleNotificationAsync({
      identifier: resolvedIdentifier,
      content: buildNotificationContent(title, body, managedContentExtra),
      trigger: {
        type: "date",
        date: triggerDate,
        channelId: ANDROID_CHANNEL_ID,
      },
    });
  };

  const isPromptSuppressed = (taskId) => {
    if (!taskId) return false;
    const until = suppressPromptUntilRef.current[taskId] || 0;
    if (until <= Date.now()) {
      delete suppressPromptUntilRef.current[taskId];
      void persistPromptSuppressionMap();
      return false;
    }
    return true;
  };

  const dismissPresentedNotification = async (notificationId) => {
    if (!notificationId) return;
    if (
      !NOTIFICATIONS_AVAILABLE ||
      typeof Notifications.dismissNotificationAsync !== "function"
    )
      return;
    try {
      await Notifications.dismissNotificationAsync(notificationId);
    } catch (err) {
      warnIfDev("NotificationContext: failed to dismiss notification:", err);
    }
  };

  const cancelAlarmNotificationsForTask = async (
    taskId,
    targetNotificationId = null
  ) => {
    if (!taskId) return 0;
    if (!NOTIFICATIONS_AVAILABLE) return 0;
    if (
      typeof Notifications.getAllScheduledNotificationsAsync !== "function" ||
      typeof Notifications.cancelScheduledNotificationAsync !== "function"
    ) {
      return 0;
    }
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const ids = [];
      for (const item of Array.isArray(scheduled) ? scheduled : []) {
        const request = item?.request || {};
        const content = request?.content || item?.content || {};
        const data = content?.data || {};
        const id =
          typeof request?.identifier === "string"
            ? request.identifier
            : typeof item?.identifier === "string"
              ? item.identifier
              : null;
        if (!id) continue;
        if (!data?.acknowledgeRequired) continue;
        const dataTaskId =
          typeof data.taskId === "string" ? data.taskId.trim() : "";
        if (dataTaskId !== taskId) continue;
        if (targetNotificationId && id !== targetNotificationId) continue;
        ids.push(id);
      }
      // Cancel the specific native alarm for the acknowledged notification
      if (targetNotificationId && isNativeAlarmSupported) {
        try {
          await cancelNativeAlarmByScheduledId(
            toNativeAlarmScheduledId(targetNotificationId)
          );
        } catch (err) {
          warnIfDev(
            "NotificationContext: failed to cancel native alarm for acknowledged notification:",
            err
          );
        }
      }
      await Promise.all(
        ids.map((id) =>
          Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
        )
      );
      // Also cancel the custom user-set reminder for this task
      try {
        const customId = buildNotificationId(
          "deadline-custom-reminder",
          taskId,
          "user"
        );
        if (isNativeAlarmSupported) {
          await cancelNativeAlarmByScheduledId(
            toNativeAlarmScheduledId(customId)
          ).catch(() => {});
        }
        if (NOTIFICATIONS_AVAILABLE) {
          await Notifications.cancelScheduledNotificationAsync(customId).catch(
            () => {}
          );
        }
      } catch (err) {
        warnIfDev(
          "NotificationContext: failed to cancel custom reminder:",
          err
        );
      }
      debugNotif("ack.cancel.task.notifications", {
        taskId,
        cancelled: ids.length,
        targetId: targetNotificationId,
      });
      return ids.length;
    } catch (err) {
      debugNotif("ack.cancel.task.notifications.error", {
        taskId,
        error: err?.message || String(err),
      });
      return 0;
    }
  };

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
        } catch (_err) {
          warnIfDev(
            "NotificationContext: failed to parse seen announcement IDs:",
            _err
          );
          seenIds = null;
        }
      }
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
        const data = { type: "announcement", announcementId: ann.id };
        const globalAckOptions = getGlobalAcknowledgeContentOptions(
          Boolean(settingsRef.current?.forceAcknowledgeAll),
          data
        );
        await Notifications.scheduleNotificationAsync({
          content: buildNotificationContent("New Announcement", body, {
            data,
            ...getAlarmStyleContentOptions(),
            ...globalAckOptions,
          }),
          trigger:
            Platform.OS === "android"
              ? {
                  type: "date",
                  date: new Date(Date.now() + 1000),
                  channelId: ANDROID_CHANNEL_ID,
                }
              : null,
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

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let retryTimeout = null;
    const scheduleWithRetry = async (user, retryCount = 0) => {
      const maxRetries = 3;
      const retryDelay = 2000;
      if (!mountedRef.current) return;
      if (!permission) {
        debugNotif("auth.schedule.skip", { reason: "permission_denied" });
        return;
      }
      if (!settingsLoaded && retryCount < maxRetries) {
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
      const currentSettings = settingsRef.current || DEFAULT_SETTINGS;
      const currentTimes = timesRef.current || DEFAULT_TIMES;
      const currentCustom = Array.isArray(customNotifsRef.current)
        ? customNotifsRef.current
        : [];
      let scheduleKey = "";
      try {
        scheduleKey = JSON.stringify({
          uid: user.uid,
          settings: currentSettings,
          times: currentTimes,
          customNotifs: currentCustom,
        });
      } catch (_err) {
        scheduleKey = `${user.uid}:${Date.now()}`;
      }
      const now = Date.now();
      if (scheduleGateRef.current.inFlight) return;
      if (
        scheduleGateRef.current.lastKey === scheduleKey &&
        now - scheduleGateRef.current.lastAt < 1500
      ) {
        return;
      }
      scheduleGateRef.current.inFlight = true;
      scheduleGateRef.current.lastKey = scheduleKey;
      scheduleGateRef.current.lastAt = now;
      try {
        if (!mountedRef.current) return;
        await scheduleAllNotifications(
          user.uid,
          currentSettings,
          currentTimes,
          currentCustom,
          { reason: "auth_state" }
        );
        if (!mountedRef.current) return;
        try {
          await enableBackgroundAlarms();
        } catch (bgErr) {
          debugNotif("backgroundTask.enable_error", { error: bgErr.message });
        }
      } finally {
        scheduleGateRef.current.inFlight = false;
      }
    };
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      if (!user) {
        scheduleGateRef.current = { inFlight: false, lastKey: "", lastAt: 0 };
        return;
      }
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          const studentInfo = userSnap.data()?.studentInfo || {};
          if (studentInfo.course) {
            await syncClassScheduleFromFirestore(user.uid, studentInfo);
          }
        }
      } catch (err) {
        warnIfDev(
          "onAuthStateChanged: class schedule sync failed (offline?):",
          err
        );
      }
      await scheduleWithRetry(user, 0);
    });
    return () => {
      mountedRef.current = false;
      if (retryTimeout) clearTimeout(retryTimeout);
      unsub();
    };
  }, [permission, settingsLoaded]);
  /* eslint-enable react-hooks/exhaustive-deps */

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

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!NOTIFICATIONS_AVAILABLE) return undefined;
    if (
      typeof Notifications.addNotificationResponseReceivedListener !==
      "function"
    )
      return undefined;

    const handleResponse = async (response) => {
      notificationResponsePendingRef.current = true;
      try {
        const payload = extractAckPayloadFromNotification(
          response?.notification
        );
        if (!payload) return;
        const action = response?.actionIdentifier;
        const notificationId =
          payload.notificationId || response?.notification?.request?.identifier;
        const resolvedPayload =
          notificationId && payload.notificationId !== notificationId
            ? { ...payload, notificationId }
            : payload;
        const payloadType =
          typeof resolvedPayload.notificationType === "string"
            ? resolvedPayload.notificationType.toLowerCase()
            : "";
        const isDeadlineAlarmPayload =
          typeof payloadType === "string" && payloadType.startsWith("deadline");

        const openTaskAlarm = async (pendingActionValue) => {
          if (!resolvedPayload.taskId) return false;
          await dismissPresentedNotification(notificationId);
          router.push({
            pathname: "/(tabs)/TaskManagerScreen",
            params: {
              focusTaskId: resolvedPayload.taskId,
              showAlarm: "1",
              ...(resolvedPayload.dueAtMs !== null
                ? { dueAtMs: String(resolvedPayload.dueAtMs) }
                : {}),
              ...(pendingActionValue
                ? { pendingAction: pendingActionValue }
                : {}),
            },
          });
          return true;
        };

        if (action === ACTION_MARK_DONE) {
          try {
            if (Platform.OS === "android") {
              await stopActiveNativeAlarm();
            }
            if (typeof Notifications.dismissNotificationAsync === "function") {
              await Notifications.dismissNotificationAsync(notificationId);
            }
          } catch (err) {
            warnIfDev(
              "handleResponse ACTION_MARK_DONE: failed to stop/dismiss:",
              err
            );
          }
          await openTaskAlarm("markdone");
          return;
        }

        if (action === ACTION_NOT_DONE) {
          try {
            if (Platform.OS === "android") {
              await stopActiveNativeAlarm();
            }
            if (typeof Notifications.dismissNotificationAsync === "function") {
              await Notifications.dismissNotificationAsync(notificationId);
            }
          } catch (err) {
            warnIfDev(
              "handleResponse ACTION_NOT_DONE: failed to stop/dismiss:",
              err
            );
          }
          await openTaskAlarm("notdone");
          return;
        }

        if (isDeadlineAlarmPayload) {
          await openTaskAlarm(null);
          return;
        }

        await dismissPresentedNotification(notificationId);
      } finally {
        notificationResponsePendingRef.current = false;
      }
    };

    const handleReceived = async (notification) => {
      const payload = extractAckPayloadFromNotification(notification);
      if (!payload) return;
      // If suppressed, dismiss silently — no overlay shown.
      if (payload.taskId && isPromptSuppressed(payload.taskId)) {
        await dismissPresentedNotification(payload.notificationId);
      }
    };

    const responseSub =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    const receiveSub =
      typeof Notifications.addNotificationReceivedListener === "function"
        ? Notifications.addNotificationReceivedListener(handleReceived)
        : null;

    if (typeof Notifications.getLastNotificationResponseAsync === "function") {
      notificationResponsePendingRef.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then(async (lastResponse) => {
          if (!lastResponse) return;
          const responseId = lastResponse?.notification?.request?.identifier;
          if (!responseId) return;
          const lastHandled = await AsyncStorage.getItem(
            LAST_HANDLED_RESPONSE_KEY
          );
          if (lastHandled === responseId) return;
          await AsyncStorage.setItem(LAST_HANDLED_RESPONSE_KEY, responseId);
          await new Promise((resolve) => setTimeout(resolve, 800));
          await handleResponse(lastResponse);
        })
        .catch(() => {})
        .finally(() => {
          notificationResponsePendingRef.current = false;
        });
    }

    return () => {
      responseSub?.remove?.();
      receiveSub?.remove?.();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const saveSettingsToFirestore = async (uid, settingsData) => {
    try {
      const payload = {
        ...settingsData,
        settings: stripLocalOnlyNotificationSettings(settingsData?.settings),
      };
      await setDoc(doc(db, "users", uid, "settings", "notification"), payload, {
        merge: true,
      });
    } catch (err) {
      reportWarning(err, {
        message: "Failed to sync notification settings to Firestore.",
        tags: { location: "notification_settings_firestore_save" },
        extra: { userId: uid || null },
      });
    }
  };

  const loadSettingsFromFirestore = async (uid) => {
    try {
      const snap = await getDoc(
        doc(db, "users", uid, "settings", "notification")
      );
      if (snap.exists()) {
        const data = snap.data();
        return {
          settings: { ...DEFAULT_SETTINGS, ...data.settings },
          times: { ...DEFAULT_TIMES, ...data.times },
          customNotifs: Array.isArray(data.customNotifs)
            ? data.customNotifs
            : [],
        };
      }
    } catch (err) {
      debugNotif("firestore.settings.loadError", { error: err?.message });
    }
    return null;
  };

  const configureAlarmActionCategory = async () => {
    if (!NOTIFICATIONS_AVAILABLE) return;
    if (typeof Notifications.setNotificationCategoryAsync !== "function")
      return;
    try {
      await Notifications.setNotificationCategoryAsync(ALARM_ACK_CATEGORY_ID, [
        {
          identifier: ACTION_MARK_DONE,
          buttonTitle: "Done",
          options: { opensAppToForeground: true },
        },
        {
          identifier: ACTION_NOT_DONE,
          buttonTitle: "Not Done",
          options: { opensAppToForeground: true },
        },
      ]);
    } catch (err) {
      debugNotif("ack.category.error", { error: err?.message || String(err) });
    }
  };

  const getNotificationPermissionStatus = async () => {
    if (!NOTIFICATIONS_AVAILABLE) return { status: "denied" };
    if (typeof Notifications.getPermissionsAsync === "function") {
      return Notifications.getPermissionsAsync();
    }
    return Notifications.requestPermissionsAsync();
  };

  const requestPermission = async () => {
    if (!NOTIFICATIONS_AVAILABLE) {
      setPermission(false);
      return false;
    }
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "Study Reminders",
        importance: Notifications.AndroidImportance.MAX,
        sound: ANDROID_NOTIFICATION_SOUND,
        vibrationPattern: [0, 900, 450, 900, 450, 1200],
        lightColor: "#007bff",
      });
    }
    await configureAlarmActionCategory();
    const currentPermission = await getNotificationPermissionStatus();
    let status = currentPermission?.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested?.status;
    }
    const granted = status === "granted";
    if (granted) {
      exactAlarmPermissionMissingLoggedRef.current = false;
      void enableBackgroundAlarms().catch((err) => {
        warnIfDev("NotificationContext: enableBackgroundAlarms failed:", err);
      });

      // Android 14+ requires explicit USE_FULL_SCREEN_INTENT permission for full-screen alarms
      if (Platform.OS === "android" && Platform.Version >= 34) {
        try {
          const { PermissionsAndroid } = require("react-native");
          await PermissionsAndroid.request(
            "android.permission.USE_FULL_SCREEN_INTENT"
          );
        } catch (err) {
          warnIfDev("USE_FULL_SCREEN_INTENT permission request failed:", err);
        }
      }
    }
    setPermission(granted);
    debugNotif("permission.result", { status, granted });

    // On first successful permission grant, check battery optimization status
    // and prompt the user to disable it for reliable background alarms.
    if (granted && Platform.OS === "android" && isNativeAlarmSupported) {
      const uid = auth.currentUser?.uid;
      if (uid && !batteryOptimizationCheckedRef.current) {
        batteryOptimizationCheckedRef.current = true;
        const dismissedKey = KEYS.batteryPromptDismiss(uid);
        const wasDismissed = await AsyncStorage.getItem(dismissedKey).catch(() => null);
        if (!wasDismissed) {
          const batteryResult = await isIgnoringBatteryOptimizations();
          if (batteryResult?.status === "success" && batteryResult.value === false) {
            await AsyncStorage.setItem(dismissedKey, "1").catch(() => {});
            setShowBatteryOptimizationPrompt(true);
          }
        }
      }
    }

    return granted;
  };

  const dismissBatteryPrompt = () => {
    setShowBatteryOptimizationPrompt(false);
  };

  const loadSettings = async () => {
    let loadedSettings = DEFAULT_SETTINGS;
    let loadedTimes = DEFAULT_TIMES;
    let loadedCustom = [];
    let loadedFromFirestore = false;
    let cachedSettings = DEFAULT_SETTINGS;
    let cachedTimes = DEFAULT_TIMES;
    let cachedCustom = [];
    const user = auth.currentUser;
    const uid = user?.uid;
    if (uid) {
      try {
        const rawSuppress = await AsyncStorage.getItem(KEYS.ackSuppress(uid));
        if (rawSuppress) {
          const parsed = JSON.parse(rawSuppress);
          if (parsed && typeof parsed === "object") {
            const nowTs = Date.now();
            const normalized = {};
            Object.entries(parsed).forEach(([taskId, until]) => {
              const ts = Number(until);
              if (!taskId || !Number.isFinite(ts) || ts <= nowTs) return;
              normalized[taskId] = ts;
            });
            suppressPromptUntilRef.current = normalized;
          }
        } else {
          suppressPromptUntilRef.current = {};
        }
      } catch (_error) {
        suppressPromptUntilRef.current = {};
      }
    } else {
      suppressPromptUntilRef.current = {};
    }
    try {
      const raw = await AsyncStorage.getItem(KEYS.settings(uid));
      if (raw) cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      const rawTimes = await AsyncStorage.getItem(KEYS.times(uid));
      if (rawTimes) cachedTimes = { ...DEFAULT_TIMES, ...JSON.parse(rawTimes) };
      const rawCustom = await AsyncStorage.getItem(KEYS.customNotifs(uid));
      if (rawCustom) cachedCustom = JSON.parse(rawCustom);
    } catch (error) {
      reportWarning(error, {
        message: "Failed to load cached notification settings.",
        tags: { location: "notification_settings_cache_load" },
        extra: { userId: uid },
      });
    }
    if (user) {
      const firestoreData = await loadSettingsFromFirestore(user.uid);
      if (firestoreData) {
        loadedSettings = mergeLocalOnlyNotificationSettings(
          firestoreData.settings,
          cachedSettings
        );
        loadedTimes = firestoreData.times;
        loadedCustom = firestoreData.customNotifs;
        loadedFromFirestore = true;
        await AsyncStorage.setItem(
          KEYS.settings(uid),
          JSON.stringify(loadedSettings)
        );
        await AsyncStorage.setItem(
          KEYS.times(uid),
          JSON.stringify(loadedTimes)
        );
        await AsyncStorage.setItem(
          KEYS.customNotifs(uid),
          JSON.stringify(loadedCustom)
        );
      }
    }
    if (!loadedFromFirestore) {
      loadedSettings = cachedSettings;
      loadedTimes = cachedTimes;
      loadedCustom = cachedCustom;
    }
    loadedSettings = {
      ...loadedSettings,
      ...normalizeTaskAlarmSoundSettings(loadedSettings),
    };
    setSettings(loadedSettings);
    setTimes(loadedTimes);
    setCustomNotifs(Array.isArray(loadedCustom) ? loadedCustom : []);
    setSettingsLoaded(true);
  };

  const scheduleAllNotifications = async (
    uid,
    currentSettings = settingsRef.current,
    currentTimes = timesRef.current,
    currentCustom = customNotifsRef.current,
    options = {}
  ) => {
    const {
      force = false,
      reason = "manual_refresh",
      bypassCooldownTaskIds = [],
    } = options;
    if (Array.isArray(bypassCooldownTaskIds)) {
      bypassCooldownTaskIds
        .filter((id) => typeof id === "string" && id)
        .forEach((id) => bypassCooldownTaskIdsRef.current.add(id));
    }
    currentSettings = currentSettings || DEFAULT_SETTINGS;
    currentTimes = currentTimes || DEFAULT_TIMES;
    currentCustom = Array.isArray(currentCustom) ? currentCustom : [];
    let scheduleKey = "";
    try {
      scheduleKey = JSON.stringify({
        uid,
        settings: currentSettings,
        times: currentTimes,
        customNotifs: currentCustom,
      });
    } catch (_err) {
      scheduleKey = `${uid}:${Date.now()}`;
    }
    const now = Date.now();
    const shouldApplyCooldown =
      reason === "auth_state" &&
      !force &&
      bypassCooldownTaskIdsRef.current.size === 0;
    if (
      shouldApplyCooldown &&
      lastScheduleStateRef.current.key === scheduleKey &&
      now - lastScheduleStateRef.current.at < SCHEDULE_REBUILD_COOLDOWN_MS
    ) {
      return;
    }
    if (scheduleRunRef.current && !force) return;
    scheduleRunRef.current = true;
    lastScheduleStateRef.current = { key: scheduleKey, at: now };
    try {
      if (!NOTIFICATIONS_AVAILABLE) return;
      if (!permissionRef.current) return;
      const scheduled = [];
      if (currentSettings.morningBriefing) {
        const t = currentTimes.morningBriefing || DEFAULT_TIMES.morningBriefing;
        const ids = await scheduleDailyNotification(
          "Morning Briefing",
          "Review today's classes, tasks, and deadlines.",
          t.hour,
          t.minute,
          {},
          "system-morning-briefing"
        );
        scheduled.push(...toScheduledIdArray(ids));
      }
      if (currentSettings.dailyAudit) {
        const t = currentTimes.dailyAudit || DEFAULT_TIMES.dailyAudit;
        const ids = await scheduleDailyNotification(
          "Daily Time Audit",
          "Take one minute to review your progress and plan tomorrow.",
          t.hour,
          t.minute,
          {},
          "system-daily-audit"
        );
        scheduled.push(...toScheduledIdArray(ids));
      }
      if (currentSettings.sundayPlanning) {
        const t = currentTimes.sundayPlanning || DEFAULT_TIMES.sundayPlanning;
        const ids = await scheduleWeeklyNotification(
          "Sunday Planning",
          "Plan your key study blocks and deadlines for the coming week.",
          0,
          t.hour,
          t.minute,
          {},
          "system-sunday-planning"
        );
        scheduled.push(...toScheduledIdArray(ids));
      }
      for (const cn of currentCustom) {
        if (!cn.enabled) continue;
        try {
          if (cn.repeat === "daily") {
            const ids = await scheduleDailyNotification(
              cn.title,
              cn.body,
              cn.hour,
              cn.minute,
              {},
              `custom-${cn.id}`
            );
            scheduled.push(...toScheduledIdArray(ids));
          } else if (cn.repeat === "weekly" && cn.weekday !== undefined) {
            const ids = await scheduleWeeklyNotification(
              cn.title,
              cn.body,
              cn.weekday,
              cn.hour,
              cn.minute,
              {},
              `custom-${cn.id}`
            );
            scheduled.push(...toScheduledIdArray(ids));
          } else {
            const nowDate = new Date();
            let triggerDate = null;
            if (cn.date) {
              const parsed = new Date(cn.date);
              if (!Number.isNaN(parsed.getTime())) triggerDate = parsed;
            }
            if (!triggerDate) triggerDate = new Date();
            triggerDate.setHours(cn.hour, cn.minute, 0, 0);
            if (cn.date) {
              if (triggerDate <= nowDate) continue;
            } else if (triggerDate <= nowDate) {
              triggerDate.setDate(triggerDate.getDate() + 1);
            }
            try {
              const id = await scheduleManagedDateNotification({
                identifier: buildNotificationId(
                  "custom",
                  cn.id,
                  triggerDate.toISOString()
                ),
                title: cn.title,
                body: cn.body,
                triggerDate,
                contentExtra: {
                  data: { type: "custom", customNotifId: cn.id },
                },
              });
              scheduled.push(...toScheduledIdArray(id));
            } catch (err) {
              debugNotif("customNotif.error", {
                title: cn.title,
                error: err?.message || String(err),
              });
            }
          }
        } catch (error) {
          reportWarning(error, {
            message: "Failed to schedule a custom notification.",
            tags: { location: "notification_custom_schedule", userId: uid },
          });
        }
      }
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
        }
        if (currentSettings.studySessionReminder) {
          const ids = await scheduleStudySessionReminders(uid, currentTimes);
          scheduled.push(...ids);
        }
        if (currentSettings.deadlineWarning) {
          const ids = await scheduleDeadlineWarnings(uid, currentSettings);
          scheduled.push(...toScheduledIdArray(ids));
        }
      }
      // Capture old IDs before overwriting
      const raw = await AsyncStorage.getItem(KEYS.scheduledIds(uid));
      const prevIds = raw ? JSON.parse(raw) : [];

      await AsyncStorage.setItem(
        KEYS.scheduledIds(uid),
        JSON.stringify(scheduled)
      );

      // Cancel old notifications after new ones are safely saved
      try {
        for (const id of prevIds) {
          if (!scheduled.includes(id)) {
            try {
              if (isNativeAlarmScheduledId(id)) {
                await cancelNativeAlarmByScheduledId(id);
              } else if (
                NOTIFICATIONS_AVAILABLE &&
                typeof Notifications.cancelScheduledNotificationAsync ===
                  "function"
              ) {
                await Notifications.cancelScheduledNotificationAsync(id);
              }
            } catch (_err) {}
          }
        }
      } catch (err) {
        warnIfDev("Failed to cancel stale notifications:", err);
      }

      debugNotif("schedule.complete", {
        uid,
        totalScheduled: scheduled.length,
      });
    } catch (err) {
      reportError(err, {
        message: "Failed to schedule notifications.",
        tags: { location: "notification_schedule_all", userId: uid },
      });
    } finally {
      if (Array.isArray(bypassCooldownTaskIds)) {
        bypassCooldownTaskIds
          .filter((id) => typeof id === "string" && id)
          .forEach((id) => bypassCooldownTaskIdsRef.current.delete(id));
      }
      scheduleRunRef.current = false;
    }
  };

  const rescheduleDeadlineAlarmsForTask = async (taskId) => {
    const user = auth.currentUser;
    if (!user || !taskId) return;

    bypassCooldownTaskIdsRef.current.add(taskId);
    try {
      await cancelAlarmNotificationsForTask(taskId);
      await cancelDeadlineAlarms({ id: taskId });
      await scheduleAllNotifications(
        user.uid,
        settingsRef.current,
        timesRef.current,
        customNotifsRef.current,
        {
          force: true,
          reason: `task_update_${taskId}`,
          bypassCooldownTaskIds: [taskId],
        }
      );
    } catch (err) {
      bypassCooldownTaskIdsRef.current.delete(taskId);
      warnIfDev("rescheduleDeadlineAlarmsForTask failed:", err);
    }
  };

  function queueBackgroundNotificationRefresh(
    uid,
    nextSettings = settingsRef.current,
    nextTimes = timesRef.current,
    nextCustomNotifs = customNotifsRef.current,
    {
      reason = "background_refresh",
      syncRemote = false,
      warningLocation = "notification_background_refresh",
    } = {}
  ) {
    if (!uid) return;
    Promise.resolve()
      .then(async () => {
        await scheduleAllNotifications(
          uid,
          nextSettings,
          nextTimes,
          nextCustomNotifs,
          { force: true, reason }
        );
        if (syncRemote) {
          await saveSettingsToFirestore(uid, {
            settings: nextSettings,
            times: nextTimes,
            customNotifs: nextCustomNotifs,
          });
        }
      })
      .catch((error) => {
        reportWarning(error, {
          message: "Failed to refresh notifications in the background.",
          tags: { location: warningLocation, reason },
          extra: { userId: uid },
        });
      });
  }

  const updateSettings = async (newSettings) => {
    try {
      const mergedBase = { ...settingsRef.current, ...newSettings };
      const merged = {
        ...mergedBase,
        ...normalizeTaskAlarmSoundSettings(mergedBase),
      };
      setSettings(merged);
      const uid = auth.currentUser?.uid;
      await AsyncStorage.setItem(KEYS.settings(uid), JSON.stringify(merged));
      queueBackgroundNotificationRefresh(
        uid,
        merged,
        timesRef.current,
        customNotifsRef.current,
        {
          reason: "settings_update",
          syncRemote: true,
          warningLocation: "notification_settings_persist",
        }
      );
    } catch (error) {
      reportWarning(error, {
        message: "Failed to persist notification settings.",
        tags: { location: "notification_settings_persist" },
        extra: { userId: auth.currentUser?.uid || null },
      });
    }
  };

  const syncClassScheduleFromFirestore = async (uid, studentInfo) => {
    if (!uid || !studentInfo) return false;
    const { college, course, year, section, scheduleType } = studentInfo;
    if (!course || !year || !section) return false;

    try {
      const scheduleMatch = await findBestScheduleDoc(db, {
        college,
        course,
        year,
        section,
        scheduleType,
      });

      if (!scheduleMatch?.doc) return false;

      const weekSchedule = scheduleMatch.doc.data().weekSchedule || {};
      if (!Object.keys(weekSchedule).length) return false;

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

      const parsedClasses = [];

      for (const [dayName, classes] of Object.entries(weekSchedule)) {
        const dayOfWeek = dayMap[dayName];
        if (dayOfWeek === undefined || !Array.isArray(classes)) continue;

        for (const cls of classes) {
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

          if (!startMeta) {
            warnIfDev(
              "syncClassSchedule: could not parse time for",
              cls?.subject
            );
            continue;
          }

          if (!endMeta) {
            let total = startMeta.hour * 60 + startMeta.minute + 60;
            total = Math.min(total, 23 * 60 + 59);
            endMeta = { hour: Math.floor(total / 60), minute: total % 60 };
          }

          const startLabelDate = new Date();
          startLabelDate.setHours(startMeta.hour, startMeta.minute, 0, 0);

          parsedClasses.push({
            subject: cls.subject || "Class",
            dayOfWeek,
            dayName,
            startHour: startMeta.hour,
            startMinute: startMeta.minute,
            endHour: endMeta.hour,
            endMinute: endMeta.minute,
            endTotalMinutes: endMeta.hour * 60 + endMeta.minute,
            startLabel: startLabelDate.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
        }
      }

      await saveLocalClassSchedule(uid, parsedClasses);
      debugNotif("classSchedule.synced", { count: parsedClasses.length, uid });
      return true;
    } catch (err) {
      warnIfDev("syncClassScheduleFromFirestore failed:", err);
      return false;
    }
  };

  //
  // [FIX 1] scheduleClassReminders — skip reminders whose weekly slot has
  // already passed this week to prevent Android catch-up firing all at once.
  //
  const scheduleClassReminders = async (
    uid,
    _studentInfo,
    currentTimes = times
  ) => {
    const ids = [];
    try {
      const cached = await loadLocalClassSchedule(uid);

      if (!cached?.classes?.length) {
        debugNotif("classReminder.skipped", { reason: "no_local_cache" });
        return ids;
      }

      const minutesBefore = Math.max(
        1,
        Number(
          currentTimes?.classReminder?.minutesBefore ??
            DEFAULT_TIMES.classReminder.minutesBefore
        )
      );

      const now = new Date();
      const lastClassEndByDay = {};

      for (const cls of cached.classes) {
        let reminderHour = cls.startHour;
        let reminderMinute = cls.startMinute - minutesBefore;
        let reminderWeekday = cls.dayOfWeek;

        while (reminderMinute < 0) {
          reminderMinute += 60;
          reminderHour -= 1;
        }
        if (reminderHour < 0) {
          reminderHour += 24;
          reminderWeekday = reminderWeekday === 0 ? 6 : reminderWeekday - 1;
        }

        const nextOccurrence = getNextWeekdayTime(
          reminderWeekday,
          reminderHour,
          reminderMinute,
          now
        );

        if (nextOccurrence <= now) {
          debugNotif("classReminder.skipped_past", {
            subject: cls.subject,
            nextOccurrence: nextOccurrence.toISOString(),
          });
          continue;
        }

        const WEEKS_AHEAD = 4;
        for (let week = 0; week < WEEKS_AHEAD; week++) {
          const baseDate = new Date(nextOccurrence);
          baseDate.setDate(baseDate.getDate() + week * 7);
          if (baseDate <= now) continue;

          const alarmId = buildNotificationId(
            "class-reminder",
            cls.subject || "class",
            reminderWeekday,
            reminderHour,
            reminderMinute,
            `w${week}`
          );

          const nativeId = await scheduleNativeAlarm({
            alarmId,
            triggerAt: baseDate.getTime(),
            title: `Class in ${minutesBefore} minutes`,
            body: `${cls.subject || "Your class"} starts at ${cls.startLabel}`,
            payload: buildManagedNotificationData(alarmId, {
              type: "class_reminder",
              subject: cls.subject,
              day: cls.dayName,
            }),
          });

          ids.push(...toScheduledIdArray(nativeId));
        }

        const existingEnd = lastClassEndByDay[cls.dayOfWeek];
        if (!existingEnd || cls.endTotalMinutes > existingEnd.endTotalMinutes) {
          lastClassEndByDay[cls.dayOfWeek] = {
            endHour: cls.endHour,
            endMinute: cls.endMinute,
            endTotalMinutes: cls.endTotalMinutes,
          };
        }
      }

      for (const [dayOfWeekRaw, endMeta] of Object.entries(lastClassEndByDay)) {
        const dayOfWeek = Number(dayOfWeekRaw);
        let hour = endMeta.endHour;
        let minute = endMeta.endMinute + 5;
        while (minute >= 60) {
          minute -= 60;
          hour += 1;
        }
        if (hour >= 24) hour = 23;

        const nextWrap = getNextWeekdayTime(dayOfWeek, hour, minute, now);
        if (nextWrap <= now) continue;

        const wrapId = await scheduleWeeklyNotification(
          "Classes finished for today",
          "Review your pending tasks and update your day plan.",
          dayOfWeek,
          hour,
          minute,
          {},
          `class-wrap-${dayOfWeek}`
        );
        ids.push(...toScheduledIdArray(wrapId));
      }

      debugNotif("classReminder.scheduled", {
        total: ids.length,
        minutesBefore,
        cachedAt: cached.savedAt,
      });
    } catch (err) {
      reportError(err, {
        message: "Failed to schedule class reminders from local cache.",
        tags: { location: "notification_class_reminders", userId: uid },
      });
    }

    return ids;
  };

  const scheduleStudySessionReminders = async (
    uid,
    currentTimes = timesRef.current
  ) => {
    const ids = [];
    try {
      const minutesBefore = Math.max(
        1,
        Number(
          currentTimes?.studySessionReminder?.minutesBefore ??
            DEFAULT_TIMES.studySessionReminder.minutesBefore
        )
      );
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
      const toDayKey = (dateInput) => {
        const date = new Date(dateInput);
        if (Number.isNaN(date.getTime())) return "";
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      };
      const parseDayKey = (dayKeyValue) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKeyValue || "").trim()))
          return null;
        const parsed = new Date(`${dayKeyValue}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + STUDY_SESSION_LOOKAHEAD_DAYS);
      const todayKey = toDayKey(today);
      const horizonKey = toDayKey(horizon);
      const plannerSnap = await getDocs(
        query(
          collection(db, "users", uid, "planner_days"),
          where("dayKey", ">=", todayKey),
          where("dayKey", "<=", horizonKey),
          orderBy("dayKey", "asc")
        )
      );
      for (const plannerDoc of plannerSnap.docs) {
        if (ids.length >= MAX_STUDY_SESSION_REMINDERS) break;
        const dayData = plannerDoc.data() || {};
        const dayKey =
          typeof dayData.dayKey === "string" && dayData.dayKey.trim()
            ? dayData.dayKey.trim()
            : plannerDoc.id;
        const dayDate = parseDayKey(dayKey);
        if (!dayDate) continue;
        const timeBlocks = Array.isArray(dayData.timeBlocks)
          ? dayData.timeBlocks
          : [];
        for (let idx = 0; idx < timeBlocks.length; idx += 1) {
          if (ids.length >= MAX_STUDY_SESSION_REMINDERS) break;
          const block = timeBlocks[idx] || {};
          const startMeta = parseTimeChunk(block.start);
          if (!startMeta) continue;
          const taskLabel =
            typeof block.task === "string" ? block.task.trim() : "";
          const blockLabel =
            typeof block.label === "string" ? block.label.trim() : "";
          const subjectLabel =
            typeof block.subject === "string" && block.subject.trim()
              ? block.subject.trim()
              : "Study";
          const skipByBreak =
            !taskLabel && /break/i.test(`${blockLabel} ${subjectLabel}`.trim());
          if (skipByBreak) continue;
          const startAt = new Date(dayDate);
          startAt.setHours(startMeta.hour, startMeta.minute, 0, 0);
          const triggerDate = new Date(
            startAt.getTime() - minutesBefore * 60 * 1000
          );
          if (triggerDate <= now) continue;
          const startLabel = startAt.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          const dayLabel = startAt.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          const title = `Study session ${formatLeadLabel(minutesBefore)}`;
          const timeLeftText = formatDeadlineCountdown(startAt, triggerDate, {
            style: "long",
          }).replace(/\s+left$/, "");
          const body = taskLabel
            ? `"${taskLabel}" (${subjectLabel}) starts in ${timeLeftText} (${startLabel} on ${dayLabel}).`
            : `${subjectLabel} study block starts in ${timeLeftText} (${startLabel} on ${dayLabel}).`;
          const payload = {
            type: "study_session",
            plannerDayKey: dayKey,
            plannerBlockId:
              typeof block.id === "string" ? block.id.trim() : `idx-${idx + 1}`,
            studyLabel: taskLabel || blockLabel || subjectLabel,
          };
          const globalAckOptions = getGlobalAcknowledgeContentOptions(
            Boolean(settingsRef.current?.forceAcknowledgeAll),
            payload
          );
          try {
            const id = await scheduleManagedDateNotification({
              identifier: buildNotificationId(
                "study-session",
                dayKey,
                payload.plannerBlockId,
                triggerDate.toISOString()
              ),
              title,
              body,
              triggerDate,
              contentExtra: {
                data: payload,
                ...getAlarmStyleContentOptions(),
                ...globalAckOptions,
              },
            });
            ids.push(...toScheduledIdArray(id));
          } catch (err) {
            debugNotif("studyReminder.schedule_error", {
              dayKey,
              error: err?.message || String(err),
            });
          }
        }
      }
    } catch (err) {
      debugNotif("studyReminder.error", { error: err?.message || String(err) });
    }
    return ids;
  };

  const scheduleDeadlineWarnings = async (
    uid,
    currentSettings = settingsRef.current
  ) => {
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
      const tomorrowTasks = [];
      const todayTasks = [];
      const pendingTasks = [];
      for (const d of snap.docs) {
        const task = { id: d.id, ...d.data() };
        if (task?.plannerArchived) continue;
        if (isPlannerAssignment(task)) continue;
        if (task.completed || task.status === "done") continue;
        const due = parseFirestoreDate(task?.dueAt);
        if (!due) continue;
        const taskTitle = task.title || "Task";
        const subjectLabel = task.subjectName || task.subject || "No subject";
        pendingTasks.push(task);
        if (isDueTomorrow(due, now)) {
          tomorrowTasks.push({
            id: d.id,
            title: taskTitle,
            subject: subjectLabel,
            due,
            priority: task?.priority,
            estimatedMinutes: Number(task?.estimatedMinutes) || 0,
          });
        }
        if (isDueToday(due, now)) {
          todayTasks.push({
            id: d.id,
            title: taskTitle,
            subject: subjectLabel,
            due,
            priority: task?.priority,
            estimatedMinutes: Number(task?.estimatedMinutes) || 0,
          });
        }
      }

      if (pendingTasks.length > 0) {
        const alarmIds = await rescheduleAllDeadlineAlarms(pendingTasks, {
          taskAlarmSoundUri: currentSettings?.taskAlarmSoundUri,
          taskAlarmSoundLabel: currentSettings?.taskAlarmSoundLabel,
        });
        ids.push(...toScheduledIdArray(alarmIds));
      }

      if (shouldScheduleTomorrowDigest(tomorrowTasks)) {
        const digestTrigger = buildDueTomorrowDigestTrigger(now);
        if (digestTrigger && digestTrigger > now) {
          try {
            const digest = buildTomorrowDigestContent(tomorrowTasks);
            const digestId = await scheduleManagedDateNotification({
              identifier: buildNotificationId(
                "deadline-digest",
                digestTrigger.toISOString()
              ),
              title: digest.title,
              body: digest.body,
              triggerDate: digestTrigger,
              contentExtra: {
                data: {
                  type: "deadline_tomorrow_digest",
                  taskIds: tomorrowTasks.slice(0, 8).map((item) => item.id),
                },
              },
            });
            ids.push(...toScheduledIdArray(digestId));
          } catch (err) {
            debugNotif("deadline.tomorrow_digest.error", {
              error: err?.message || String(err),
            });
          }
        }
      }
      if (shouldScheduleTodayDigest(todayTasks, now)) {
        const todayDigestTrigger = buildTodayDigestTrigger(now);
        if (todayDigestTrigger && todayDigestTrigger > now) {
          const scheduledNotifs =
            NOTIFICATIONS_AVAILABLE &&
            typeof Notifications.getAllScheduledNotificationsAsync ===
              "function"
              ? await Notifications.getAllScheduledNotificationsAsync().catch(
                  () => []
                )
              : [];
          const existingTodayDigestIds =
            getTodayDigestScheduledIds(scheduledNotifs);
          const alreadyScheduled =
            existingTodayDigestIds.length > 0 ||
            (await isTodayDigestAlreadyScheduled(scheduledNotifs));
          if (alreadyScheduled) {
            ids.push(...existingTodayDigestIds);
          } else {
            try {
              const digest = buildTodayDigestContent(todayTasks, now);
              const digestId = await scheduleManagedDateNotification({
                identifier: buildNotificationId(
                  "deadline-digest-today",
                  todayDigestTrigger.toISOString()
                ),
                title: digest.title,
                body: digest.body,
                triggerDate: todayDigestTrigger,
                contentExtra: {
                  data: {
                    type: "deadline_today_digest",
                    taskIds: todayTasks.slice(0, 8).map((item) => item.id),
                  },
                },
              });
              ids.push(...toScheduledIdArray(digestId));
            } catch (err) {
              debugNotif("deadline.today_digest.error", {
                error: err?.message || String(err),
              });
            }
          }
        }
      }
    } catch (err) {
      reportError(err, {
        message: "Failed to schedule deadline reminders.",
        tags: { location: "notification_deadline_warnings", userId: uid },
      });
    }
    return ids;
  };

  const scheduleDailyNotification = async (
    title,
    body,
    hour,
    minute,
    contentExtra = {},
    idBase = "daily"
  ) => {
    if (!NOTIFICATIONS_AVAILABLE) return [];
    try {
      const now = new Date();
      const firstTrigger = getNextWeekdayTime(now.getDay(), hour, minute, now);
      const ids = [];
      for (
        let dayOffset = 0;
        dayOffset < DAILY_TRIGGER_LOOKAHEAD_DAYS;
        dayOffset += 1
      ) {
        const triggerDate = new Date(firstTrigger);
        triggerDate.setDate(triggerDate.getDate() + dayOffset);
        const id = await scheduleManagedDateNotification({
          identifier: buildNotificationId(
            "daily",
            idBase,
            triggerDate.toISOString()
          ),
          title,
          body,
          triggerDate,
          contentExtra,
          preferExactAlarm: true,
        });
        ids.push(...toScheduledIdArray(id));
      }
      return ids;
    } catch (err) {
      debugNotif("scheduleDaily.error", {
        title,
        hour,
        minute,
        error: err?.message || String(err),
      });
      return [];
    }
  };

  const scheduleWeeklyNotification = async (
    title,
    body,
    weekday,
    hour,
    minute,
    contentExtra = {},
    idBase = "weekly"
  ) => {
    if (!NOTIFICATIONS_AVAILABLE) return [];
    try {
      const firstTrigger = getNextWeekdayTime(weekday, hour, minute);
      const ids = [];
      for (
        let weekOffset = 0;
        weekOffset < WEEKLY_TRIGGER_LOOKAHEAD_WEEKS;
        weekOffset += 1
      ) {
        const triggerDate = new Date(firstTrigger);
        triggerDate.setDate(triggerDate.getDate() + weekOffset * 7);
        const id = await scheduleManagedDateNotification({
          identifier: buildNotificationId(
            "weekly",
            idBase,
            triggerDate.toISOString()
          ),
          title,
          body,
          triggerDate,
          contentExtra,
          preferExactAlarm: true,
        });
        ids.push(...toScheduledIdArray(id));
      }
      return ids;
    } catch (err) {
      debugNotif("scheduleWeekly.error", {
        title,
        weekday,
        hour,
        minute,
        error: err?.message || String(err),
      });
      return [];
    }
  };

  const updateTimes = async (newTimes) => {
    try {
      const merged = { ...timesRef.current, ...newTimes };
      setTimes(merged);
      const uid = auth.currentUser?.uid;
      await AsyncStorage.setItem(KEYS.times(uid), JSON.stringify(merged));
      queueBackgroundNotificationRefresh(
        uid,
        settingsRef.current,
        merged,
        customNotifsRef.current,
        {
          reason: "times_update",
          syncRemote: true,
          warningLocation: "notification_times_update",
        }
      );
    } catch (error) {
      reportWarning(error, {
        message: "Failed to update notification times.",
        tags: { location: "notification_times_update" },
        extra: { userId: auth.currentUser?.uid || null },
      });
    }
  };

  const addCustomNotif = async (notif) => {
    try {
      const newList = [
        ...customNotifsRef.current,
        { ...notif, id: `custom_${Date.now()}`, enabled: true },
      ];
      setCustomNotifs(newList);
      const uid = auth.currentUser?.uid;
      await AsyncStorage.setItem(
        KEYS.customNotifs(uid),
        JSON.stringify(newList)
      );
      queueBackgroundNotificationRefresh(
        uid,
        settingsRef.current,
        timesRef.current,
        newList,
        {
          reason: "custom_notif_change",
          syncRemote: true,
          warningLocation: "notification_custom_add",
        }
      );
    } catch (error) {
      reportWarning(error, {
        message: "Failed to add custom notification.",
        tags: { location: "notification_custom_add" },
        extra: { userId: auth.currentUser?.uid || null },
      });
    }
  };

  const updateCustomNotif = async (id, changes) => {
    try {
      const newList = customNotifsRef.current.map((n) =>
        n.id === id ? { ...n, ...changes } : n
      );
      setCustomNotifs(newList);
      const uid = auth.currentUser?.uid;
      await AsyncStorage.setItem(
        KEYS.customNotifs(uid),
        JSON.stringify(newList)
      );
      queueBackgroundNotificationRefresh(
        uid,
        settingsRef.current,
        timesRef.current,
        newList,
        {
          reason: "custom_notif_change",
          syncRemote: true,
          warningLocation: "notification_custom_update",
        }
      );
    } catch (error) {
      reportWarning(error, {
        message: "Failed to update custom notification.",
        tags: { location: "notification_custom_update", notificationId: id },
        extra: { userId: auth.currentUser?.uid || null },
      });
    }
  };

  const deleteCustomNotif = async (id) => {
    try {
      const newList = customNotifsRef.current.filter((n) => n.id !== id);
      setCustomNotifs(newList);
      const uid = auth.currentUser?.uid;
      await AsyncStorage.setItem(
        KEYS.customNotifs(uid),
        JSON.stringify(newList)
      );
      queueBackgroundNotificationRefresh(
        uid,
        settingsRef.current,
        timesRef.current,
        newList,
        {
          reason: "custom_notif_change",
          syncRemote: true,
          warningLocation: "notification_custom_delete",
        }
      );
    } catch (error) {
      reportWarning(error, {
        message: "Failed to delete custom notification.",
        tags: { location: "notification_custom_delete", notificationId: id },
        extra: { userId: auth.currentUser?.uid || null },
      });
    }
  };

  /**
   * Reschedules deadline alarms immediately — no debounce.
   * Deadline alarms fetch fresh task data from Firestore and should not
   * be delayed since task due dates are time-sensitive.
   */
  const rescheduleDeadlineAlarmsImmediate = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const pendingTasksSnap = await getDocs(
        query(
          collection(db, "assignments"),
          where("userId", "==", user.uid),
          where("completed", "==", false)
        )
      );
      const pendingTasks = pendingTasksSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      await rescheduleAllDeadlineAlarms(pendingTasks, {
        taskAlarmSoundUri: settingsRef.current.taskAlarmSoundUri,
        taskAlarmSoundLabel: settingsRef.current.taskAlarmSoundLabel,
      });
    } catch (err) {
      warnIfDev("rescheduleDeadlineAlarmsImmediate failed:", err);
    }
  };

  /**
   * Reschedules all notifications (class reminders, study sessions, deadlines, etc.)
   * Debounced to avoid hammering the scheduler on rapid setting changes.
   */
  const rescheduleAll = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) {
        const studentInfo = userSnap.data()?.studentInfo || {};
        if (studentInfo.course) {
          await syncClassScheduleFromFirestore(user.uid, studentInfo);
        }
      }
    } catch (err) {
      warnIfDev("rescheduleAll: class schedule sync failed (offline?):", err);
    }

    return new Promise((resolve, reject) => {
      manualRescheduleRef.current.waiters.push({ resolve, reject });
      if (manualRescheduleRef.current.timer) {
        clearTimeout(manualRescheduleRef.current.timer);
      }
      manualRescheduleRef.current.timer = setTimeout(async () => {
        manualRescheduleRef.current.timer = null;
        let scheduleError = null;
        try {
          await scheduleAllNotifications(
            user.uid,
            settingsRef.current,
            timesRef.current,
            customNotifsRef.current,
            { force: true, reason: "manual_reschedule" }
          );
        } catch (err) {
          scheduleError = err;
          warnIfDev("rescheduleAll: scheduleAllNotifications failed:", err);
        } finally {
          const waiters = manualRescheduleRef.current.waiters.splice(
            0,
            manualRescheduleRef.current.waiters.length
          );
          waiters.forEach((done) => {
            if (scheduleError) done.reject?.(scheduleError);
            else done.resolve();
          });
        }
      }, MANUAL_RESCHEDULE_DEBOUNCE_MS);
    });
  };

  const clearTaskAlarmSuppression = async (taskId) => {
    if (!taskId) return;
    if (suppressPromptUntilRef.current[taskId]) {
      delete suppressPromptUntilRef.current[taskId];
      await persistPromptSuppressionMap();
    }
  };

  const sendTestNotification = async ({ alarmStyle = true } = {}) => {
    if (!NOTIFICATIONS_AVAILABLE)
      return { ok: false, reason: "Notifications engine unavailable." };
    if (!permission)
      return { ok: false, reason: "Notification permission not granted." };
    try {
      const taskAlarmSound = normalizeTaskAlarmSoundSettings(
        settingsRef.current || DEFAULT_SETTINGS
      );
      const data = {
        type: alarmStyle ? "alarm_test" : "test",
        acknowledgeRequired: Boolean(alarmStyle),
        ackKey: buildAckKey("alarm_test"),
        ...(alarmStyle && taskAlarmSound.taskAlarmSoundUri
          ? {
              alarmSoundUri: taskAlarmSound.taskAlarmSoundUri,
              alarmSoundLabel: taskAlarmSound.taskAlarmSoundLabel,
            }
          : {}),
      };
      const extra = alarmStyle
        ? {
            data,
            ...getAlarmStyleContentOptions({
              includeActions: true,
              dueNow: true,
              sticky: true,
            }),
          }
        : { data, ...getAlarmStyleContentOptions() };
      if (alarmStyle) {
        const nativeId = await scheduleNativeExactAlarm({
          alarmId: `alarm_test_${Date.now()}`,
          triggerDate: new Date(Date.now() + 1500),
          title: "Alarm Test Notification",
          body: "Sound + acknowledge/snooze actions should appear. Use this to verify alarm behavior.",
          payload: data,
        });
        if (nativeId) return { ok: true };
      }
      await Notifications.scheduleNotificationAsync({
        content: buildNotificationContent(
          alarmStyle ? "Alarm Test Notification" : "Test Notification",
          alarmStyle
            ? "Sound + acknowledge/snooze actions should appear. Use this to verify alarm behavior."
            : "If you see this, reminders are working.",
          extra
        ),
        trigger:
          Platform.OS === "android"
            ? {
                type: "date",
                date: new Date(Date.now() + 1000),
                channelId: ANDROID_CHANNEL_ID,
              }
            : null,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || String(err) };
    }
  };

  const getNotificationDiagnostics = async () => {
    const user = auth.currentUser;
    const diagnostics = {
      notificationsAvailable: NOTIFICATIONS_AVAILABLE,
      isExpoGo: IS_EXPO_GO,
      nativeAlarmSupported: isNativeAlarmSupported,
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
    diagnostics.backgroundTask = {
      backgroundTaskDefined: isTaskManagerTaskDefined(BACKGROUND_ALARM_TASK),
    };
    diagnostics.exactAlarmPermission =
      isNativeAlarmSupported && Platform.OS === "android"
        ? await canScheduleExactAlarms()
        : null;
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
        nativeAlarmSupported: isNativeAlarmSupported,
        taskAlarmTonePickerAvailable: canPickNativeAlarmTone,
        taskAlarmAudioPickerAvailable: canPickNativeAlarmAudioFile,
        canScheduleExactAlarms,
        openExactAlarmSettings,
        isIgnoringBatteryOptimizations,
        requestIgnoreBatteryOptimizations,
        showBatteryOptimizationPrompt,
        dismissBatteryPrompt,
        pickTaskAlarmTone: pickNativeAlarmTone,
        pickTaskAlarmAudioFile: pickNativeAlarmAudioFile,
        clearTaskAlarmSuppression,
        rescheduleAll,
        rescheduleDeadlineAlarmsForTask,
        rescheduleDeadlineAlarmsImmediate,
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
      nativeAlarmSupported: false,
      taskAlarmTonePickerAvailable: false,
      taskAlarmAudioPickerAvailable: false,
      canScheduleExactAlarms: async () => false,
      openExactAlarmSettings: () => {},
      isIgnoringBatteryOptimizations: async () => false,
      requestIgnoreBatteryOptimizations: () => false,
      showBatteryOptimizationPrompt: false,
      dismissBatteryPrompt: () => {},
      pickTaskAlarmTone: async () => null,
      pickTaskAlarmAudioFile: async () => null,
      clearTaskAlarmSuppression: async () => {},
      rescheduleAll: async () => {},
      rescheduleDeadlineAlarmsForTask: async () => {},
      sendTestNotification: async () => ({
        ok: false,
        reason: "Notifications unavailable.",
      }),
      getNotificationDiagnostics: async () => ({}),
    };
  return ctx;
}
