/**
 * utils/deadlineAlarmBackground.js
 *
 * CHANGES IN THIS VERSION:
 * - [FIX] Removed LEAD_BUFFER_MS (1-min early trigger buffer) — lead notifications
 *   now fire at exactly dueAtMs - lead.ms.
 * - [FIX] Shade action buttons renamed: ACTION_MARK_DONE → "Open" (opens app to modal),
 *   ACTION_NOT_DONE → "Not Done" (advances chain, reschedules silently).
 *   Completion only happens inside the alarm modal, never from the shade.
 * - [FIX] scheduleNextOverdueAlarm / scheduleOverdueCheckpointAlarm now cancels ALL
 *   existing shade notifications for the task before posting the next one, so only
 *   one shade notification exists at a time as the chain advances.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { resolveTaskDueDate } from "./academicTaskModel";
import {
    logScheduleFailed,
    logScheduleStart,
    logScheduleSuccess,
} from "./alarmDiagnostics";
import { getNext8AM } from "./alarmTimeHelpers.js";
import { OVERDUE_CHAIN } from "./deadlineConstants";
import { warnIfDev } from "./logger";
import {
    cancelNativeAlarmByScheduledId,
    ensureNativeAlarmPermissions,
    forceStopNativeAlarm,
    isNativeAlarmScheduledId,
    isNativeAlarmSupported,
    scheduleNativeAlarm,
    stopActiveNativeAlarm,
    toNativeAlarmScheduledId,
} from "./nativeAlarm";
import {
    buildManagedNotificationData,
    buildNotificationId,
} from "./notificationIds";
import {
    cancelDeadlineNotifications as cancelSharedDeadlineNotifications,
    DEADLINE_ACTION_NOT_DONE,
    DEADLINE_ACTION_OPEN,
    DEADLINE_NOTIF_TYPE,
    dismissDeadlinePresentations,
    logDeadlineFlow,
    normalizeDeadlineAlarmAction,
} from "./deadlineNotifications";
import { isPlannerTask } from "./taskFilters";
import {
    advanceCheckpoint,
    getCheckpoint,
    resolveCurrentOverdueStageInfo,
    resolveIntendedTriggerAt,
    setCheckpoint,
} from "./taskOverdueState";

let notifeeModule = null;
try {
  notifeeModule = require("@notifee/react-native");
} catch (error) {
  warnIfDev(
    "Notifee native module unavailable; using expo-notifications fallback where possible:",
    error
  );
}

const notifee = notifeeModule?.default ?? {
  createChannel: async () => null,
  displayNotification: async () => null,
  cancelNotification: async () => null,
};
const AndroidCategory = notifeeModule?.AndroidCategory ?? {
  ALARM: "alarm",
};
const AndroidImportance = notifeeModule?.AndroidImportance ?? {
  HIGH: Notifications.AndroidImportance?.HIGH ?? 4,
  DEFAULT: Notifications.AndroidImportance?.DEFAULT ?? 3,
};
const AndroidVisibility = notifeeModule?.AndroidVisibility ?? {
  PUBLIC: "public",
};
const AndroidColor = notifeeModule?.AndroidColor ?? { RED: "#ff0000" };
const isNotifeeAvailable = Boolean(notifeeModule?.default);

export const DEADLINE_CHANNEL_ID = "ctu-deadline-alarms-v2";
export const LEAD_CHANNEL_ID = "ctu-deadline-lead-v2";
export const DEADLINE_CATEGORY_ID = "deadline_alarm_actions";
export const ALARM_KIND_LEAD_NOTICE = "lead_notice";
export const ALARM_KIND_DUE_ALARM = "due_alarm";
export const ALARM_KIND_OVERDUE_ALARM = "overdue_alarm";
export const ALARM_KIND_OVERDUE_SEED = "overdue_seed";

const ALARM_RING_ACTIVITY = "com.ctudanao.timemanager.AlarmRingActivity";

const SMALL_ICON = "notification_icon";
const LARGE_ICON = "ic_launcher_round";
const IMMEDIATE_CATCHUP_DELAY_MS = 1500;
const OVERDUE_SEED_TARGET_STAGE = "+15m";

// [FIX] Removed LEAD_BUFFER_MS — lead notifications fire at exact threshold time.

const LEAD_TIMES = [
  { key: "1d", ms: 24 * 60 * 60 * 1000, label: "1 day" },
  { key: "2h", ms: 2 * 60 * 60 * 1000, label: "2 hours" },
  { key: "30m", ms: 30 * 60 * 1000, label: "30 min" },
  { key: "5m", ms: 5 * 60 * 1000, label: "5 min" },
];

function resolveNativeAlarmPath(permissionState) {
  const exactGranted = permissionState?.exactAlarm?.value !== false;
  const fullScreenGranted = permissionState?.fullScreenIntent?.value !== false;

  if (exactGranted && fullScreenGranted) return "native_popup";
  if (exactGranted) return "native_no_fullscreen_popup";
  if (fullScreenGranted) return "native_inexact_popup";
  return "native_inexact_no_fullscreen_popup";
}

function shouldAttemptFullScreenPresentation(deliveryPath = "") {
  const normalizedPath =
    typeof deliveryPath === "string" ? deliveryPath.trim().toLowerCase() : "";
  if (!normalizedPath) return true;
  if (normalizedPath.includes("no_fullscreen")) return false;
  if (normalizedPath.includes("foreground_catchup")) return false;
  if (normalizedPath.includes("app_open_catchup")) return false;
  return true;
}

function logAlarmSchedulingPath(kind, alarmId, path, meta = {}) {
  const details = {
    ...meta,
    intendedTriggerAt:
      Number.isFinite(meta.intendedTriggerAt) && meta.intendedTriggerAt > 0
        ? new Date(meta.intendedTriggerAt).toISOString()
        : meta.intendedTriggerAt,
    triggerAt:
      Number.isFinite(meta.triggerAt) && meta.triggerAt > 0
        ? new Date(meta.triggerAt).toISOString()
        : meta.triggerAt,
  };
  const msg = `[deadlineAlarm] ${kind} ${alarmId} -> ${path}`;
  warnIfDev(msg, details);
  if (path?.includes("failed")) {
    console.warn(msg, details);
  }
}

function getChainEntry(stageKey) {
  return OVERDUE_CHAIN.find((entry) => entry.key === stageKey) || null;
}

function getStageIndex(stageKey) {
  return OVERDUE_CHAIN.findIndex((entry) => entry.key === stageKey);
}

function buildDeliveryPath(path, hint = null) {
  return hint ? `${hint}_${path}` : path;
}

function getOverdueSeedId(taskId) {
  return buildNotificationId(
    "deadline-followup",
    taskId,
    OVERDUE_SEED_TARGET_STAGE
  );
}

async function cancelManagedNotificationId(id) {
  if (!id) return;
  try {
    await cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(id));
  } catch (_e) {}
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (_e) {}
  try {
    await notifee.cancelNotification(id);
  } catch (_e) {}
}

async function cancelOverdueSeedAlarm(taskId) {
  if (!taskId) return;
  await cancelManagedNotificationId(getOverdueSeedId(taskId));
}

/**
 * [FIX] Cancel ALL shade notifications for a task across every overdue stage
 * before posting a new one. This ensures only one shade notification exists
 * at a time as the overdue chain advances.
 */
async function cancelAllShadeNotificationsForTask(taskId) {
  if (!taskId) return;
  await dismissDeadlinePresentations(taskId);
  await cancelOverdueSeedAlarm(taskId);
}

function buildAlarmTimingMeta({
  stageKey,
  intendedTriggerAtMs,
  scheduledAtMs = Date.now(),
  deliveryPath,
} = {}) {
  return {
    ...(stageKey ? { stage: stageKey } : {}),
    ...(Number.isFinite(intendedTriggerAtMs) ? { intendedTriggerAtMs } : {}),
    ...(Number.isFinite(scheduledAtMs) ? { scheduledAtMs } : {}),
    ...(typeof deliveryPath === "string" && deliveryPath
      ? { deliveryPath }
      : {}),
  };
}

function computeActualDelayMs(intendedTriggerAtMs, nowMs = Date.now()) {
  const resolvedIntendedTriggerAtMs = Number(intendedTriggerAtMs);
  const resolvedNowMs = Number(nowMs);
  if (
    !Number.isFinite(resolvedIntendedTriggerAtMs) ||
    !Number.isFinite(resolvedNowMs)
  ) {
    return null;
  }
  return Math.max(0, resolvedNowMs - resolvedIntendedTriggerAtMs);
}

function resolveNotificationIntendedTriggerAtMs(data = {}) {
  const raw = Number(data?.intendedTriggerAtMs);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function resolveRequestedOverdueCheckpoint({
  checkpoint,
  dueAtMs,
  triggerAt = null,
  nowMs = Date.now(),
}) {
  const requestedKey =
    typeof checkpoint?.key === "string" && checkpoint.key
      ? checkpoint.key
      : "due";
  const requestedEntry = getChainEntry(requestedKey) || checkpoint || null;
  const requestedIndex = getStageIndex(requestedKey);
  const currentStageInfo = resolveCurrentOverdueStageInfo(dueAtMs, nowMs);
  const currentIndex = getStageIndex(currentStageInfo?.key);
  const requestedTriggerAt = Number(triggerAt);
  const requestedIntendedTriggerAt =
    Number.isFinite(requestedTriggerAt) && requestedTriggerAt > nowMs
      ? requestedTriggerAt
      : resolveIntendedTriggerAt(requestedKey, dueAtMs, nowMs);

  if (currentStageInfo?.key && currentIndex > requestedIndex) {
    const upgradedEntry = getChainEntry(currentStageInfo.key);
    return {
      checkpoint: {
        key: upgradedEntry?.key ?? currentStageInfo.key,
        delayMs: upgradedEntry?.delayMs ?? null,
      },
      triggerAtMs: nowMs + IMMEDIATE_CATCHUP_DELAY_MS,
      intendedTriggerAtMs: currentStageInfo.triggerAtMs,
    };
  }

  if (Number.isFinite(requestedTriggerAt) && requestedTriggerAt > nowMs) {
    return {
      checkpoint: {
        key: requestedEntry?.key ?? requestedKey,
        delayMs: requestedEntry?.delayMs ?? null,
      },
      triggerAtMs: requestedTriggerAt,
      intendedTriggerAtMs: requestedIntendedTriggerAt,
    };
  }

  if (
    Number.isFinite(requestedIntendedTriggerAt) &&
    requestedIntendedTriggerAt > nowMs
  ) {
    return {
      checkpoint: {
        key: requestedEntry?.key ?? requestedKey,
        delayMs: requestedEntry?.delayMs ?? null,
      },
      triggerAtMs: requestedIntendedTriggerAt,
      intendedTriggerAtMs: requestedIntendedTriggerAt,
    };
  }

  const fallbackStage = currentStageInfo?.key ?? requestedKey;
  const fallbackEntry = getChainEntry(fallbackStage) || requestedEntry;
  return {
    checkpoint: {
      key: fallbackEntry?.key ?? fallbackStage,
      delayMs: fallbackEntry?.delayMs ?? null,
    },
    triggerAtMs: nowMs + IMMEDIATE_CATCHUP_DELAY_MS,
    intendedTriggerAtMs:
      currentStageInfo?.triggerAtMs ??
      requestedIntendedTriggerAt ??
      resolveIntendedTriggerAt(fallbackStage, dueAtMs, nowMs),
  };
}

async function bootstrapDeadlineActionCategory() {
  if (typeof Notifications.setNotificationCategoryAsync !== "function") return;
  try {
    await Notifications.setNotificationCategoryAsync(DEADLINE_CATEGORY_ID, [
      {
        // [FIX] "Open" — just opens app to alarm modal, does NOT complete task
        identifier: DEADLINE_ACTION_OPEN,
        buttonTitle: "Open",
        options: { opensAppToForeground: true },
      },
      {
        // "Not Done" — advances chain, reschedules
        identifier: DEADLINE_ACTION_NOT_DONE,
        buttonTitle: "Not Done",
        options: { opensAppToForeground: false },
      },
    ]);
  } catch (err) {
    warnIfDev("bootstrapDeadlineActionCategory failed:", err);
  }
}

export async function bootstrapDeadlineAlarmChannel() {
  await bootstrapDeadlineActionCategory();
  if (Platform.OS !== "android") return;
  try {
    if (isNativeAlarmSupported) {
      await ensureNativeAlarmPermissions({
        requireExactAlarm: true,
        requireFullScreen: true,
        prompt: false,
        source: "bootstrap_deadline_alarm_channel",
      }).catch(() => null);
    }

    if (typeof Notifications.setNotificationChannelAsync === "function") {
      await Notifications.setNotificationChannelAsync(DEADLINE_CHANNEL_ID, {
        name: "Deadline Alarms",
        description: "Urgent alerts for upcoming task deadlines",
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        sound: "ctu_alarm.wav",
        vibrationPattern: [0, 600, 900],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility?.PUBLIC,
        bypassDnd: true,
      });

      await Notifications.setNotificationChannelAsync(LEAD_CHANNEL_ID, {
        name: "Deadline Reminders",
        description: "Advance warnings before task deadlines",
        importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
        vibrationPattern: [],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility?.PUBLIC,
      });
    }

    if (!isNotifeeAvailable) return;

    await notifee.createChannel({
      id: DEADLINE_CHANNEL_ID,
      name: "Deadline Alarms",
      description: "Urgent alerts for upcoming task deadlines",
      importance: AndroidImportance.HIGH,
      sound: "ctu_alarm",
      vibration: true,
      vibrationPattern: [600, 900],
      lights: true,
      lightColor: AndroidColor.RED,
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: true,
    });

    await notifee.createChannel({
      id: LEAD_CHANNEL_ID,
      name: "Deadline Reminders",
      description: "Advance warnings before task deadlines",
      importance: AndroidImportance.DEFAULT,
      vibration: false,
      lights: false,
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: false,
    });
  } catch (err) {
    warnIfDev("bootstrapDeadlineAlarmChannel failed:", err);
  }
}

function buildLeadTitle(label) {
  return `\u23F0 Due in ${label}`;
}

function buildLeadBody(taskTitle, subjectLabel, due) {
  const dueStr = due.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${taskTitle} • ${subjectLabel} — ${dueStr}`;
}

function getTaskAlarmMeta(task = {}, soundSettings = {}) {
  const taskTitle =
    typeof task.title === "string" && task.title.trim()
      ? task.title.trim()
      : "Task";
  const subjectLabel =
    typeof (task.subject || task.subjectName) === "string" &&
    String(task.subject || task.subjectName).trim()
      ? String(task.subject || task.subjectName).trim()
      : "General";
  const taskType =
    typeof task.type === "string" && task.type.trim()
      ? task.type.trim().toLowerCase()
      : "custom";
  const taskPriority =
    typeof task.priority === "string" && task.priority.trim()
      ? task.priority.trim().toLowerCase()
      : "medium";
  const alarmSoundUri =
    typeof soundSettings.taskAlarmSoundUri === "string" &&
    soundSettings.taskAlarmSoundUri.trim()
      ? soundSettings.taskAlarmSoundUri.trim()
      : null;
  return { taskTitle, subjectLabel, taskType, taskPriority, alarmSoundUri };
}

function buildDeadlineAlarmData(
  identifier,
  task,
  dueAtMs,
  soundSettings = {},
  extra = {}
) {
  const meta = getTaskAlarmMeta(task, soundSettings);
  const alarmKind =
    typeof extra?.alarmKind === "string" && extra.alarmKind
      ? extra.alarmKind
      : extra?.isLeadTime === true
        ? ALARM_KIND_LEAD_NOTICE
        : extra?.isOverdueAlarm === true
          ? ALARM_KIND_OVERDUE_ALARM
          : ALARM_KIND_DUE_ALARM;
  return buildManagedNotificationData(identifier, {
    alarmId: identifier,
    type: DEADLINE_NOTIF_TYPE,
    notificationType: DEADLINE_NOTIF_TYPE,
    alarmKind,
    taskId: task?.id || "",
    taskTitle: meta.taskTitle,
    subject: meta.subjectLabel,
    subjectLabel: meta.subjectLabel,
    taskType: meta.taskType,
    taskPriority: meta.taskPriority,
    ...(Number.isFinite(dueAtMs)
      ? {
          dueAtMs,
          dueAt: new Date(dueAtMs).toISOString(),
          dueDate: new Date(dueAtMs).toISOString(),
        }
      : {}),
    ...(meta.alarmSoundUri ? { alarmSoundUri: meta.alarmSoundUri } : {}),
    ...extra,
  });
}

function normalizeNotificationData(data = {}) {
  if (!data || typeof data !== "object") return {};

  return Object.entries(data).reduce((normalized, [key, value]) => {
    if (value === undefined || value === null) return normalized;
    if (typeof value === "string") {
      normalized[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      normalized[key] = String(value);
    } else if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else {
      try {
        normalized[key] = JSON.stringify(value);
      } catch (_error) {
        normalized[key] = String(value);
      }
    }
    return normalized;
  }, {});
}

function buildOverdueAlarmBody(taskTitle, subjectLabel, dueAtMs, stageKey) {
  const dueDate = new Date(dueAtMs);
  const dueLabel = Number.isFinite(dueDate.getTime())
    ? dueDate.toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "unknown time";

  const stageLabel =
    stageKey === "+15m"
      ? "15 min overdue"
      : stageKey === "+1h"
        ? "1 hour overdue"
        : stageKey === "+3h"
          ? "3 hours overdue"
          : stageKey === "daily"
            ? "still overdue — daily reminder"
            : "overdue";

  return `${taskTitle} • ${subjectLabel} — ${stageLabel} (due ${dueLabel})`;
}

function resolveNotificationDueAtMs(data = {}) {
  const rawDueAtMs = Number(data?.dueAtMs);
  if (Number.isFinite(rawDueAtMs) && rawDueAtMs > 0) return rawDueAtMs;
  const rawDueDate =
    typeof data?.dueDate === "string" && data.dueDate
      ? data.dueDate
      : typeof data?.dueAt === "string" && data.dueAt
        ? data.dueAt
        : "";
  if (!rawDueDate) return null;
  const parsedDueAtMs = new Date(rawDueDate).getTime();
  return Number.isFinite(parsedDueAtMs) ? parsedDueAtMs : null;
}

export function resolveNotificationAlarmKind(data = {}) {
  if (typeof data?.alarmKind === "string" && data.alarmKind.trim()) {
    return data.alarmKind.trim();
  }
  if (data?.isLeadTime === true) return ALARM_KIND_LEAD_NOTICE;
  if (data?.isOverdueAlarm === true) return ALARM_KIND_OVERDUE_ALARM;
  return ALARM_KIND_DUE_ALARM;
}

function resolveNotificationStageKey(data = {}) {
  if (typeof data?.stage === "string" && data.stage.trim()) {
    return data.stage.trim();
  }
  if (typeof data?.threshold === "string" && data.threshold.trim()) {
    return data.threshold.trim();
  }
  return "due";
}

function buildTaskFromNotificationData(data = {}, dueAtMs) {
  const subjectLabel =
    typeof data?.subjectLabel === "string" && data.subjectLabel.trim()
      ? data.subjectLabel.trim()
      : typeof data?.subject === "string" && data.subject.trim()
        ? data.subject.trim()
        : "General";

  return {
    id: data.taskId,
    title:
      typeof data?.taskTitle === "string" && data.taskTitle.trim()
        ? data.taskTitle.trim()
        : "Task",
    subject: subjectLabel,
    subjectName: subjectLabel,
    type:
      typeof data?.taskType === "string" && data.taskType.trim()
        ? data.taskType.trim()
        : "custom",
    priority:
      typeof data?.taskPriority === "string" && data.taskPriority.trim()
        ? data.taskPriority.trim()
        : "medium",
    dueAt: new Date(dueAtMs).toISOString(),
  };
}

/**
 * [FIX] Shade notification android config.
 * "Open" button (ACTION_MARK_DONE) just opens the app — opensAppToForeground handled
 * by the category. "Not Done" advances chain without opening app.
 */
function buildOverdueNotifeeAndroid({
  isOngoing = true,
  allowFullScreen = true,
} = {}) {
  return {
    channelId: DEADLINE_CHANNEL_ID,
    category: AndroidCategory.ALARM,
    importance: AndroidImportance.HIGH,
    smallIcon: SMALL_ICON,
    largeIcon: LARGE_ICON,
    sound: "ctu_alarm",
    vibrationPattern: [600, 900],
    lights: ["#ef4444", 300, 300],
    bypassDnd: true,
    visibility: AndroidVisibility.PUBLIC,
    ongoing: isOngoing,
    autoCancel: !isOngoing,
    localOnly: false,
    ...(allowFullScreen
      ? {
          fullScreenAction: {
            id: "default",
            launchActivity: ALARM_RING_ACTIVITY,
          },
        }
      : {}),
    pressAction: { id: "default", launchActivity: "default" },
    actions: [
      {
        // [FIX] "Open" — opens app to alarm modal, completion happens in modal only
        title: "🔔 Open",
        pressAction: { id: DEADLINE_ACTION_OPEN, launchActivity: "default" },
      },
      {
        // "Not Done" — advances chain, reschedules, no app open
        title: "⏰ Not Done",
        pressAction: { id: DEADLINE_ACTION_NOT_DONE, launchActivity: "default" },
      },
    ],
  };
}

function buildLeadNotifeeAndroid() {
  return {
    channelId: LEAD_CHANNEL_ID,
    importance: AndroidImportance.DEFAULT,
    smallIcon: SMALL_ICON,
    largeIcon: LARGE_ICON,
    visibility: AndroidVisibility.PUBLIC,
    ongoing: false,
    autoCancel: true,
    localOnly: false,
    pressAction: { id: "default", launchActivity: "default" },
  };
}

export async function displayAlarmNotification({
  id,
  title,
  body,
  data,
  isOngoing = true,
}) {
  const nowMs = Date.now();
  const dueAtMs = resolveNotificationDueAtMs(data);
  const intendedTriggerAtMs = resolveNotificationIntendedTriggerAtMs(data);
  const actualDelayMs = computeActualDelayMs(intendedTriggerAtMs, nowMs);
  const overdueMs =
    Number.isFinite(dueAtMs) && dueAtMs > 0 ? Math.max(0, nowMs - dueAtMs) : 0;
  const resolvedDueDate =
    typeof data?.dueDate === "string" && data.dueDate
      ? data.dueDate
      : typeof data?.dueAt === "string" && data.dueAt
        ? data.dueAt
        : Number.isFinite(dueAtMs) && dueAtMs > 0
          ? new Date(dueAtMs).toISOString()
          : null;
  const resolvedData = {
    ...data,
    alarmId:
      typeof data?.alarmId === "string" && data.alarmId ? data.alarmId : id,
    taskTitle:
      typeof data?.taskTitle === "string" && data.taskTitle.trim()
        ? data.taskTitle.trim()
        : title,
    type: DEADLINE_NOTIF_TYPE,
    notificationType: DEADLINE_NOTIF_TYPE,
    ...(Number.isFinite(dueAtMs) && dueAtMs > 0 ? { dueAtMs } : {}),
    ...(resolvedDueDate
      ? { dueAt: resolvedDueDate, dueDate: resolvedDueDate }
      : {}),
    overdueMs: String(overdueMs),
    ...(actualDelayMs !== null ? { actualDelayMs } : {}),
  };

  warnIfDev(`[deadlineAlarm] display ${id}`, {
    stage:
      typeof resolvedData?.stage === "string" && resolvedData.stage
        ? resolvedData.stage
        : "due",
    deliveryPath: resolvedData?.deliveryPath ?? "unknown",
    actualDelayMs,
  });

  const allowFullScreen = shouldAttemptFullScreenPresentation(
    resolvedData?.deliveryPath
  );

  if (!isNotifeeAvailable && Platform.OS !== "android") {
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data: normalizeNotificationData(resolvedData),
        categoryIdentifier: DEADLINE_CATEGORY_ID,
        ...(Platform.OS === "android"
          ? {
              priority: "max",
              sticky: isOngoing !== false,
              autoDismiss: isOngoing === false,
              sound: "ctu_alarm.wav",
              vibrationPattern: [0, 600, 900],
            }
          : {}),
      },
      trigger: null,
    });
    return;
  }

  if (!isNotifeeAvailable) {
    warnIfDev(`[deadlineAlarm] Notifee unavailable for display ${id}`);
    return;
  }

  await notifee.displayNotification({
    id,
    title,
    body,
    data: normalizeNotificationData(resolvedData),
    android: buildOverdueNotifeeAndroid({
      isOngoing: isOngoing !== false,
      allowFullScreen,
    }),
  });
}

export async function displayLeadNotification({ id, title, body, data }) {
  if (!isNotifeeAvailable && Platform.OS !== "android") {
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data: normalizeNotificationData({
          ...data,
          type: DEADLINE_NOTIF_TYPE,
          notificationType: DEADLINE_NOTIF_TYPE,
          alarmKind: ALARM_KIND_LEAD_NOTICE,
          isLeadTime: true,
          acknowledgeRequired: false,
        }),
      },
      trigger: null,
    });
    return;
  }

  if (!isNotifeeAvailable) {
    warnIfDev(`[deadlineAlarm] Notifee unavailable for lead display ${id}`);
    return;
  }

  await notifee.displayNotification({
    id,
    title,
    body,
    data: normalizeNotificationData({
      ...data,
      type: DEADLINE_NOTIF_TYPE,
      notificationType: DEADLINE_NOTIF_TYPE,
      alarmKind: ALARM_KIND_LEAD_NOTICE,
      isLeadTime: true,
      acknowledgeRequired: false,
    }),
    android: buildLeadNotifeeAndroid(),
  });
}

async function scheduleOverdueCheckpointAlarm({
  task,
  dueAtMs,
  checkpoint,
  soundSettings = {},
  triggerAt = null,
  intendedTriggerAtMs = null,
  deliveryPathHint = null,
}) {
  if (!task?.id || !Number.isFinite(dueAtMs) || !checkpoint?.key) return null;

  const nowMs = Date.now();
  const normalizedCheckpoint = resolveRequestedOverdueCheckpoint({
    checkpoint,
    dueAtMs,
    triggerAt,
    nowMs,
  });
  if (!normalizedCheckpoint?.checkpoint?.key) return null;

  const resolvedCheckpoint = normalizedCheckpoint.checkpoint;
  const resolvedTriggerAt = normalizedCheckpoint.triggerAtMs;
  const resolvedIntendedTriggerAtMs =
    Number.isFinite(Number(intendedTriggerAtMs)) &&
    Number(intendedTriggerAtMs) > 0
      ? Number(intendedTriggerAtMs)
      : normalizedCheckpoint.intendedTriggerAtMs;

  const { taskTitle, subjectLabel } = getTaskAlarmMeta(task, soundSettings);
  const id = buildNotificationId(
    "deadline-overdue",
    task.id,
    resolvedCheckpoint.key
  );
  const title = checkpoint.key === "daily" ? "⏰ Still Overdue" : "⏰ Overdue";
  const body = buildOverdueAlarmBody(
    taskTitle,
    subjectLabel,
    dueAtMs,
    resolvedCheckpoint.key
  );
  const resolvedTitle =
    checkpoint.key === resolvedCheckpoint.key
      ? title
      : resolvedCheckpoint.key === "daily"
        ? "Still Overdue"
        : "Overdue";

  const data = buildDeadlineAlarmData(id, task, dueAtMs, soundSettings, {
    alarmKind: ALARM_KIND_OVERDUE_ALARM,
    stage: resolvedCheckpoint.key,
    acknowledgeRequired: true,
    isLeadTime: false,
    isOverdueAlarm: true,
    ...buildAlarmTimingMeta({
      stageKey: resolvedCheckpoint.key,
      intendedTriggerAtMs: resolvedIntendedTriggerAtMs,
      scheduledAtMs: Date.now(),
    }),
  });

  // [FIX] Cancel ALL existing shade notifications for this task before posting
  // the new overdue one — ensures only one shade notification exists at a time.
  await cancelAllShadeNotificationsForTask(task.id);
  await setCheckpoint(task.id, resolvedCheckpoint.key, resolvedTriggerAt);

  // Schedule BOTH native and Expo for redundancy — overdue alarms are critical
  // and must ring reliably even if one system fails.
  let nativeId = null;
  let expoId = null;

  if (Platform.OS === "android" && isNativeAlarmSupported) {
    let permissionState = null;
    try {
      permissionState =
        typeof ensureNativeAlarmPermissions === "function"
          ? await ensureNativeAlarmPermissions({
              requireExactAlarm: true,
              requireFullScreen: true,
              prompt: true,
              source: `overdue:${resolvedCheckpoint.key}:${id}`,
            })
          : null;
      if (!permissionState) {
        warnIfDev("scheduleOverdueCheckpointAlarm: missing permission state");
      } else {
        const nativePath = buildDeliveryPath(
          resolveNativeAlarmPath(permissionState),
          deliveryPathHint
        );
        data.deliveryPath = nativePath;
        data.scheduledAtMs = Date.now();
        nativeId = await scheduleNativeAlarm({
          alarmId: id,
          triggerAt: resolvedTriggerAt,
          title: resolvedTitle,
          body,
          payload: data,
        });
        if (nativeId) {
          logAlarmSchedulingPath("overdue", id, nativePath, {
            stage: resolvedCheckpoint.key,
            intendedTriggerAt: resolvedIntendedTriggerAtMs,
            triggerAt: resolvedTriggerAt,
          });
        } else {
          logAlarmSchedulingPath(
            "overdue",
            id,
            buildDeliveryPath("native_schedule_failed", deliveryPathHint),
            {
              stage: resolvedCheckpoint.key,
              intendedTriggerAt: resolvedIntendedTriggerAtMs,
              triggerAt: resolvedTriggerAt,
            }
          );
        }
      }
    } catch (err) {
      warnIfDev("scheduleOverdueCheckpointAlarm native failed:", err);
    }
  }

  if (!nativeId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      const expoDeliveryPath = buildDeliveryPath(
        nativeId ? "expo_backup" : "expo_primary",
        deliveryPathHint
      );
      data.deliveryPath = expoDeliveryPath;
      data.scheduledAtMs = Date.now();

      expoId = await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: resolvedTitle,
          body,
          data,
          categoryIdentifier: DEADLINE_CATEGORY_ID,
          ...(Platform.OS === "android"
            ? {
                priority: "max",
                sticky: true,
                autoDismiss: false,
                sound: "ctu_alarm.wav",
                vibrationPattern: [0, 400, 200, 400, 200, 800],
                channelId: DEADLINE_CHANNEL_ID,
              }
            : {}),
        },
        trigger:
          Platform.OS === "android"
            ? {
                type: "date",
                date: new Date(resolvedTriggerAt),
              }
            : { date: new Date(resolvedTriggerAt) },
      });

      if (expoId) {
        logAlarmSchedulingPath("overdue", id, expoDeliveryPath, {
          stage: resolvedCheckpoint.key,
          intendedTriggerAt: resolvedIntendedTriggerAtMs,
          triggerAt: resolvedTriggerAt,
        });
      }
    } catch (err) {
      warnIfDev("scheduleOverdueCheckpointAlarm Expo failed:", err);
    }
  }

  const scheduledId = nativeId || expoId;
  if (!scheduledId) {
    warnIfDev(
      `scheduleOverdueCheckpointAlarm: CRITICAL - both native and Expo failed for ${id}`
    );
  }

  return scheduledId;
}

async function scheduleLeadNotification({ id, title, body, data, triggerAt }) {
  try {
    await notifee.cancelNotification(id).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    data.deliveryPath = "expo_scheduled_lead";
    data.scheduledAtMs = Date.now();

    return Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data,
        ...(Platform.OS === "android" ? { channelId: LEAD_CHANNEL_ID } : {}),
      },
      trigger: {
        type: "date",
        date: new Date(triggerAt),
      },
    });
  } catch (err) {
    warnIfDev(`scheduleLeadNotification [${id}] failed:`, err);
    return null;
  }
}

async function scheduleDueMomentNotification({
  id,
  title,
  body,
  data,
  triggerAt,
  retryCount = 0,
  maxRetries = 3,
}) {
  const now = Date.now();
  const triggerMs = new Date(triggerAt).getTime();
  const delayMs = Math.max(0, triggerMs - now);

  warnIfDev(`[Due Alarm] Scheduling notification ${id}`, {
    triggerAt: new Date(triggerAt).toISOString(),
    delayMs,
    retryAttempt: retryCount,
  });

  try {
    await notifee.cancelNotification(id).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});

    const result = await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data,
        categoryIdentifier: DEADLINE_CATEGORY_ID,
        ...(Platform.OS === "android"
          ? {
              priority: "max",
              sticky: true,
              autoDismiss: false,
              sound: "ctu_alarm.wav",
              vibrationPattern: [0, 400, 200, 400, 200, 800],
              channelId: DEADLINE_CHANNEL_ID,
            }
          : {}),
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: "date",
              date: new Date(triggerAt),
            }
          : { date: new Date(triggerAt) },
    });

    warnIfDev(`[Due Alarm] Successfully scheduled ${id}`, { result, delayMs });
    return result;
  } catch (err) {
    warnIfDev(
      `[Due Alarm] Scheduling failed [${id}] attempt ${retryCount + 1}/${maxRetries}:`,
      err
    );

    if (retryCount < maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
      warnIfDev(`[Due Alarm] Retrying in ${backoffMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return scheduleDueMomentNotification({
        id,
        title,
        body,
        data,
        triggerAt,
        retryCount: retryCount + 1,
        maxRetries,
      });
    }

    warnIfDev(
      `[Due Alarm] Failed to schedule ${id} after ${maxRetries} retries`
    );
    return null;
  }
}

async function scheduleOverdueSeedAlarm({
  task,
  dueAtMs,
  soundSettings = {},
  triggerAt,
}) {
  if (
    Platform.OS !== "android" ||
    !task?.id ||
    !Number.isFinite(dueAtMs) ||
    !Number.isFinite(triggerAt) ||
    !isNativeAlarmSupported
  ) {
    return null;
  }

  const seedId = getOverdueSeedId(task.id);
  const data = buildDeadlineAlarmData(seedId, task, dueAtMs, soundSettings, {
    alarmKind: ALARM_KIND_OVERDUE_SEED,
    stage: "due",
    seedTargetStage: OVERDUE_SEED_TARGET_STAGE,
    acknowledgeRequired: false,
    isLeadTime: false,
    ...buildAlarmTimingMeta({
      stageKey: "due",
      intendedTriggerAtMs: triggerAt,
      scheduledAtMs: Date.now(),
    }),
  });

  await cancelOverdueSeedAlarm(task.id);

  try {
    const permissionState =
      typeof ensureNativeAlarmPermissions === "function"
        ? await ensureNativeAlarmPermissions({
            requireExactAlarm: true,
            requireFullScreen: false,
            prompt: false,
            source: `overdue_seed:${seedId}`,
          })
        : null;
    const exactGranted = permissionState?.exactAlarm?.value !== false;
    data.deliveryPath = exactGranted
      ? "native_exact_overdue_seed"
      : "native_inexact_overdue_seed";
    data.scheduledAtMs = Date.now();
    const scheduledId = await scheduleNativeAlarm({
      alarmId: seedId,
      triggerAt,
      title: "Overdue follow-up",
      body: "Scheduling next overdue reminder.",
      payload: data,
    });
    if (scheduledId) {
      logAlarmSchedulingPath("overdue_seed", seedId, data.deliveryPath, {
        stage: OVERDUE_SEED_TARGET_STAGE,
        intendedTriggerAt: triggerAt,
        triggerAt,
      });
    }
    return scheduledId;
  } catch (err) {
    warnIfDev(`scheduleOverdueSeedAlarm [${seedId}] failed:`, err);
    return null;
  }
}

async function scheduleDailyOverdueAlarm(
  task,
  triggerAt,
  soundSettings = {},
  deliveryPathHint = null
) {
  const dueAtMs = resolveTaskDueDate(task)?.getTime?.();
  if (!Number.isFinite(dueAtMs)) return null;

  const dailyCheckpoint = { stage: "daily", key: "daily", delayMs: null };
  const resolvedTriggerAtMs =
    triggerAt instanceof Date
      ? triggerAt.getTime()
      : Number.isFinite(Number(triggerAt))
        ? Number(triggerAt)
        : resolveIntendedTriggerAt("daily", dueAtMs, Date.now());
  return scheduleOverdueCheckpointAlarm({
    task,
    dueAtMs,
    checkpoint: dailyCheckpoint,
    soundSettings,
    triggerAt: resolvedTriggerAtMs,
    intendedTriggerAtMs: resolvedTriggerAtMs,
    deliveryPathHint,
  });
}

// ─────────────────────── Main API ───────────────────────
export async function scheduleDeadlineAlarms(
  task,
  soundSettings = {},
  { force = false } = {}
) {
  if (!task?.id) return [];
  if (task.completed || task.status === "done" || isPlannerTask(task)) {
    await cancelDeadlineAlarms(task);
    return [];
  }

  await bootstrapDeadlineAlarmChannel();

  const due = resolveTaskDueDate(task);
  if (!due) return [];

  const now = Date.now();
  const ids = [];
  const dueAtMs = due.getTime();

  await logScheduleStart(task.id, task.title, dueAtMs);
  await cancelDeadlineAlarms(task);

  const { taskTitle, subjectLabel } = getTaskAlarmMeta(task, soundSettings);

  // Layer 1: lead-time warnings
  // [FIX] No LEAD_BUFFER_MS — fires at exactly dueAtMs - lead.ms
  for (const lead of LEAD_TIMES) {
    const triggerTime = dueAtMs - lead.ms;
    const GRACE_PERIOD_MS = 5_000;
    if (triggerTime <= now + GRACE_PERIOD_MS) {
      warnIfDev(
        `scheduleDeadlineAlarms: skipping lead notification for ${lead.key} (trigger time ${new Date(triggerTime).toISOString()} is too close to now)`
      );
      continue;
    }

    const id = buildNotificationId("deadline-lead", task.id, lead.key);
    const leadTitle = buildLeadTitle(lead.label);
    const leadBody = buildLeadBody(taskTitle, subjectLabel, due);
    const data = buildDeadlineAlarmData(id, task, dueAtMs, soundSettings, {
      alarmKind: ALARM_KIND_LEAD_NOTICE,
      leadKey: lead.key,
      stage: lead.key,
      isLeadTime: true,
      acknowledgeRequired: false,
    });

    let scheduledId = null;
    if (Platform.OS === "android" && isNativeAlarmSupported) {
      data.deliveryPath = "native_lead";
      data.scheduledAtMs = Date.now();
      scheduledId = await scheduleNativeAlarm({
        alarmId: id,
        triggerAt: triggerTime,
        title: leadTitle,
        body: leadBody,
        payload: data,
      });
    }
    if (!scheduledId) {
      scheduledId = await scheduleLeadNotification({
        id,
        title: leadTitle,
        body: leadBody,
        data,
        triggerAt: triggerTime,
      });
    }
    if (scheduledId) ids.push(scheduledId);
  }

  // Layer 2: due-moment alarm
  let scheduledDueId = null;
  if (dueAtMs > now) {
    const dueId = buildNotificationId("deadline-due", task.id, "due");
    const dueTitle = `🔔 ${taskTitle} is due NOW`;
    const dueBody = `"${taskTitle}" (${subjectLabel}) — tap Open or Not Done.`;
    const dueContent = { title: dueTitle, body: dueBody };
    warnIfDev(
      `[scheduleDeadlineAlarms] Scheduling due alarm for task ${task.id}`,
      {
        dueAtMs: new Date(dueAtMs).toISOString(),
        taskTitle,
        delayMs: dueAtMs - now,
      }
    );
    const dueData = buildDeadlineAlarmData(
      dueId,
      task,
      dueAtMs,
      soundSettings,
      {
        alarmKind: ALARM_KIND_DUE_ALARM,
        stage: "due",
        acknowledgeRequired: true,
        isLeadTime: false,
        ...buildAlarmTimingMeta({
          stageKey: "due",
          intendedTriggerAtMs: dueAtMs,
          scheduledAtMs: Date.now(),
        }),
      }
    );
    await setCheckpoint(task.id, "due", dueAtMs);
    if (Platform.OS === "android" && isNativeAlarmSupported) {
      let permissionState = null;
      try {
        permissionState =
          typeof ensureNativeAlarmPermissions === "function"
            ? await ensureNativeAlarmPermissions({
                requireExactAlarm: true,
                requireFullScreen: true,
                prompt: true,
                source: `due:${dueId}`,
              })
            : null;
        dueData.deliveryPath = resolveNativeAlarmPath(permissionState);
        dueData.scheduledAtMs = Date.now();
        scheduledDueId = await scheduleNativeAlarm({
          alarmId: dueId,
          triggerAt: dueAtMs,
          title: dueContent.title,
          body: dueContent.body,
          payload: dueData,
        });
        if (scheduledDueId) {
          await logScheduleSuccess(task.id, dueId, "native_alarm", {
            stage: "due",
            delayMs: dueAtMs - now,
          });
          logAlarmSchedulingPath("due", dueId, dueData.deliveryPath, {
            stage: "due",
            intendedTriggerAt: dueAtMs,
            triggerAt: dueAtMs,
          });
        } else {
          logAlarmSchedulingPath("due", dueId, "native_schedule_failed", {
            stage: "due",
            intendedTriggerAt: dueAtMs,
            triggerAt: dueAtMs,
          });
        }
      } catch (err) {
        warnIfDev("scheduleNativeAlarm for due failed:", err);
      }
    } else {
      warnIfDev(
        "scheduleDeadlineAlarms: due-moment native alarm unsupported; falling back to expo-notifications."
      );
      logAlarmSchedulingPath("due", dueId, "native_unsupported", {
        stage: "due",
        intendedTriggerAt: dueAtMs,
        triggerAt: dueAtMs,
      });
    }

    if (!scheduledDueId) {
      dueData.deliveryPath =
        Platform.OS === "android" ? "expo_fallback_android" : "expo_fallback";
      dueData.scheduledAtMs = Date.now();
      warnIfDev(`[Due Alarm] Native failed, trying Expo fallback for ${dueId}`);
      scheduledDueId = await scheduleDueMomentNotification({
        id: dueId,
        title: dueContent.title,
        body: dueContent.body,
        data: dueData,
        triggerAt: dueAtMs,
      });
      if (scheduledDueId) {
        await logScheduleSuccess(task.id, dueId, "expo_fallback", {
          stage: "due",
          delayMs: dueAtMs - now,
        });
        warnIfDev(`[Due Alarm] Expo fallback succeeded for ${dueId}`);
        logAlarmSchedulingPath("due", dueId, "expo_fallback", {
          stage: "due",
          intendedTriggerAt: dueAtMs,
          triggerAt: dueAtMs,
        });
      } else {
        await logScheduleFailed(
          task.id,
          "expo_fallback",
          new Error("Expo scheduleNotificationAsync failed")
        );
        warnIfDev(
          `[Due Alarm] Expo fallback FAILED for ${dueId} - this is a critical issue!`
        );
      }
    }
    if (scheduledDueId) ids.push(scheduledDueId);

    if (!scheduledDueId || !isNativeAlarmScheduledId(scheduledDueId)) {
      const seedTriggerAt = resolveIntendedTriggerAt(
        OVERDUE_SEED_TARGET_STAGE,
        dueAtMs
      );
      if (Number.isFinite(seedTriggerAt) && seedTriggerAt > now) {
        const seedId = await scheduleOverdueSeedAlarm({
          task,
          dueAtMs,
          soundSettings,
          triggerAt: seedTriggerAt,
        });
        if (seedId) ids.push(seedId);
      }
    }
    return ids;
  }

  // AFTER due — schedule current overdue stage
  const currentStageInfo = resolveCurrentOverdueStageInfo(dueAtMs, now) ?? {
    key: "due",
    triggerAtMs: dueAtMs,
  };
  const currentCheckpoint = getChainEntry(currentStageInfo.key) || {
    key: currentStageInfo.key,
    delayMs: null,
  };
  const scheduledOverdueId = await scheduleOverdueCheckpointAlarm({
    task,
    dueAtMs,
    checkpoint: {
      key: currentCheckpoint.key,
      delayMs: currentCheckpoint.delayMs,
    },
    soundSettings,
    triggerAt: now + IMMEDIATE_CATCHUP_DELAY_MS,
    intendedTriggerAtMs: currentStageInfo.triggerAtMs,
    deliveryPathHint: "reschedule_catchup",
  });
  if (scheduledOverdueId) ids.push(scheduledOverdueId);
  return ids;
}

export async function cancelDeadlineAlarms(task) {
  if (!task?.id) return;
  await cancelSharedDeadlineNotifications(task.id, {
    legacyExpoCompat: true,
  });
}

export async function rescheduleAllDeadlineAlarms(
  tasks = [],
  soundSettings = {}
) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const now = Date.now();

  const eligible = tasks.filter(
    (task) =>
      !task.completed && !isPlannerTask(task) && resolveTaskDueDate(task)
  );

  const BATCH_SIZE = 5;
  const results = [];

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (task) => {
        const dueMs = resolveTaskDueDate(task)?.getTime();
        if (dueMs && dueMs <= now) {
          const checkpoint = await getCheckpoint(task.id);
          if (checkpoint?.key) {
            const currentCheckpoint = OVERDUE_CHAIN.find(
              (entry) => entry.key === checkpoint.key
            );
            if (currentCheckpoint) {
              const repairTriggerAt =
                currentCheckpoint.key === "daily"
                  ? getNext8AM().getTime()
                  : Number.isFinite(checkpoint.triggerAtMs) &&
                      checkpoint.triggerAtMs > now + 30_000
                    ? checkpoint.triggerAtMs
                    : now + 30_000;
              const repairedId = await scheduleNextOverdueAlarm({
                task,
                checkpoint: currentCheckpoint,
                soundSettings,
                triggerAt: repairTriggerAt,
              });
              return repairedId ? [repairedId] : [];
            }
          }
        }
        return scheduleDeadlineAlarms(task, soundSettings, { force: true });
      })
    );
    results.push(...batchResults);
  }

  return results.flat().filter(Boolean);
}

export async function forceScheduleDeadlineAlarms(task, soundSettings = {}) {
  return scheduleDeadlineAlarms(task, soundSettings, { force: true });
}

export async function scheduleNextOverdueAlarm({
  task,
  checkpoint,
  soundSettings = {},
  triggerAt = null,
  intendedTriggerAtMs = null,
  deliveryPathHint = null,
}) {
  const dueAtMs = resolveTaskDueDate(task)?.getTime?.();
  if (!task?.id || !Number.isFinite(dueAtMs) || !checkpoint?.key) return null;
  await cancelOverdueSeedAlarm(task.id);
  if (checkpoint.key === "daily") {
    return scheduleDailyOverdueAlarm(
      task,
      triggerAt,
      soundSettings,
      deliveryPathHint
    );
  }
  return scheduleOverdueCheckpointAlarm({
    task,
    dueAtMs,
    checkpoint: { key: checkpoint.key, delayMs: checkpoint.delayMs },
    soundSettings,
    triggerAt: triggerAt ?? Date.now() + IMMEDIATE_CATCHUP_DELAY_MS,
    intendedTriggerAtMs,
    deliveryPathHint,
  });
}

export async function handleDeadlineAlarmResponse(response) {
  const data = response.notification.request.content.data ?? {};
  if (
    data.type !== DEADLINE_NOTIF_TYPE &&
    data.notificationType !== DEADLINE_NOTIF_TYPE
  ) {
    return;
  }

  const { taskId } = data;
  if (!taskId) return;

  const notificationIdentifier =
    response.notification.request.identifier ?? null;
  const actionIdentifier = response.actionIdentifier ?? "default";
  const normalizedAction = normalizeDeadlineAlarmAction(actionIdentifier);
  const isNotDoneAction = normalizedAction === "notdone";
  // [FIX] ACTION_MARK_DONE is now "Open" — just opens app, no task completion here.
  // Treat it the same as a default tap (open app to modal).

  try {
    if (Platform.OS === "android") {
      const withNativeStopTimeout = (callback, timeoutMessage) =>
        new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            warnIfDev(timeoutMessage);
            resolve(false);
          }, 3000);

          Promise.resolve()
            .then(() => callback())
            .then((value) => {
              clearTimeout(timeoutId);
              resolve(value);
            })
            .catch((error) => {
              clearTimeout(timeoutId);
              reject(error);
            });
        });

      const stopped = await withNativeStopTimeout(
        () => stopActiveNativeAlarm(),
        "handleDeadlineAlarmResponse: stopActiveNativeAlarm timed out — continuing"
      );
      if (!stopped && typeof forceStopNativeAlarm === "function") {
        await withNativeStopTimeout(
          () => forceStopNativeAlarm(),
          "handleDeadlineAlarmResponse: forceStopNativeAlarm timed out — continuing"
        );
      }
    }
    if (
      notificationIdentifier &&
      typeof Notifications.dismissNotificationAsync === "function"
    ) {
      await Notifications.dismissNotificationAsync(
        notificationIdentifier
      ).catch(() => {});
    }
    if (notificationIdentifier) {
      await notifee.cancelNotification(notificationIdentifier).catch(() => {});
    }
  } catch (err) {
    warnIfDev(
      "handleDeadlineAlarmResponse: failed to stop/dismiss notification:",
      err
    );
  }

  logDeadlineFlow("background_response", {
    taskId,
    notificationId: notificationIdentifier || null,
    action: normalizedAction,
    sourceId: notificationIdentifier || data?.alarmId || taskId,
  });

  warnIfDev(`[deadlineAlarm] response ${notificationIdentifier || taskId}`, {
    stage: resolveNotificationStageKey(data),
    deliveryPath: data?.deliveryPath ?? "unknown",
    actualDelayMs: computeActualDelayMs(
      resolveNotificationIntendedTriggerAtMs(data),
      Date.now()
    ),
    actionIdentifier,
    normalizedAction,
  });

  if (isNotDoneAction) {
    try {
      await bootstrapDeadlineAlarmChannel().catch(() => {});

      const stageKey = resolveNotificationStageKey(data);
      const dueAtMs = resolveNotificationDueAtMs(data);
      if (!Number.isFinite(dueAtMs) || dueAtMs <= 0) return;

      const nextCheckpoint = await advanceCheckpoint(taskId, stageKey, dueAtMs);
      if (!nextCheckpoint?.key) return;

      const chainEntry =
        OVERDUE_CHAIN.find((entry) => entry.key === nextCheckpoint.key) ||
        nextCheckpoint;

      await scheduleNextOverdueAlarm({
        task: buildTaskFromNotificationData(data, dueAtMs),
        checkpoint: {
          key: chainEntry.key,
          delayMs: chainEntry.delayMs,
        },
        triggerAt: nextCheckpoint.triggerAtMs ?? null,
        intendedTriggerAtMs: nextCheckpoint.triggerAtMs ?? null,
        deliveryPathHint: "not_done",
      });
    } catch (err) {
      warnIfDev(
        "handleDeadlineAlarmResponse: failed to advance not-done checkpoint:",
        err
      );
    }
  }
  // For ACTION_MARK_DONE ("Open") and default tap — app opens naturally,
  // TaskManagerScreen receives showAlarm params and opens the modal.
  // No task completion here.
}
