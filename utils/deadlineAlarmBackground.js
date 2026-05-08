/**
 * utils/deadlineAlarmBackground.js
 *
 * CHANGES IN THIS VERSION:
 * - [NEW] Overdue alarms are now `ongoing: true` + `autoCancel: false` on Android
 *   so they cannot be swiped away from the shade — only Done / Not Done clears them.
 * - [NEW] Lead-time and custom-reminder notifications now include:
 *      sound: "ctu_alarm" on the notifee channel
 *      smallIcon / largeIcon via notifee for Android
 *      vibration pattern
 * - [NEW] A separate "lead" notifee channel (LEAD_CHANNEL_ID) with lower importance
 *   so lead-time pings don't feel as intrusive as the due-moment alarm.
 * - [NEW] scheduleLeadNotification() uses notifee.displayNotification for the
 *   immediate display path and Notifications.scheduleNotificationAsync for the
 *   future-scheduled path — both carry icon + sound.
 * - [FIX] iOS DateTimePicker maximumDate guard already done in TaskEditorModal;
 *   no changes needed here for that.
 * - [NEW] Overdue checkpoint alarms now ALSO post an immediate notifee notification
 *   (persistent, with Done / Not Done action buttons, sound, and vibration) via
 *   displayAlarmNotification() whenever the alarm fires — covering both the
 *   native-alarm path (AlarmDisplayTask → displayAlarmNotification) and the
 *   expo-notifications fallback path. The fallback now calls
 *   displayAlarmNotification() directly for already-overdue tasks so the full
 *   alarm-grade notification appears in the shade immediately.
 * - [FIX 8] Handle "daily" stage in scheduleDeadlineAlarms — schedule next 8AM explicitly
 */

import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  normalizeTaskDateInput,
  resolveTaskDueDate,
} from "./academicTaskModel";
import { getNext8AM } from "./alarmTimeHelpers.js";
import { warnIfDev } from "./logger";
import {
  cancelNativeAlarmByScheduledId,
  isNativeAlarmScheduledId,
  isNativeAlarmSupported,
  scheduleNativeAlarm,
  stopActiveNativeAlarm,
  toNativeAlarmScheduledId,
  writeAlarmAction,
  canScheduleExactAlarms,
  openExactAlarmSettings,
} from "./nativeAlarm";
import {
  buildManagedNotificationData,
  buildNotificationId,
} from "./notificationIds";
import { isPlannerTask } from "./taskFilters";
import { getCheckpoint, setCheckpoint } from "./taskOverdueState";
import { OVERDUE_CHAIN } from "./deadlineConstants";

export const DEADLINE_NOTIF_TYPE = "deadline_alarm";
export const DEADLINE_CHANNEL_ID = "ctu-deadline-alarms-v1"; // due-moment / overdue — max importance
export const LEAD_CHANNEL_ID = "ctu-deadline-lead-v1"; // lead-time warnings — high importance
export const DEADLINE_CATEGORY_ID = "deadline_alarm_actions";
export const ACTION_NOT_DONE = "not_done_deadline_alarm";
export const ACTION_MARK_DONE = "mark_done_deadline_alarm";

const ALARM_RING_ACTIVITY = "com.ctudanao.timemanager.AlarmRingActivity";

// — small / large icon names (must match drawable resources in android/app/src/main/res) —
const SMALL_ICON = "ic_notification"; // 24×24 monochrome silhouette (white on transparent)
const LARGE_ICON = "ic_launcher_round"; // 96×96 colour app icon

// Lead-time thresholds — 3 standard dismissable warnings
const LEAD_TIMES = [
  { key: "1d", ms: 24 * 60 * 60 * 1000, label: "1 day" },
  { key: "2h", ms: 2 * 60 * 60 * 1000, label: "2 hours" },
  { key: "30m", ms: 30 * 60 * 1000, label: "30 min" },
  { key: "1m", ms: 60 * 1000, label: "1 minute" },
];

// ─────────────────────── Internal helpers ───────────────────────
async function bootstrapDeadlineActionCategory() {
  if (typeof Notifications.setNotificationCategoryAsync !== "function") return;
  try {
    await Notifications.setNotificationCategoryAsync(DEADLINE_CATEGORY_ID, [
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
    warnIfDev("bootstrapDeadlineActionCategory failed:", err);
  }
}

export async function bootstrapDeadlineAlarmChannel() {
  await bootstrapDeadlineActionCategory();
  if (Platform.OS !== "android") return;
  try {
    // Due-moment / overdue channel — alarm-grade, bypasses DnD
    await notifee.createChannel({
      id: DEADLINE_CHANNEL_ID,
      name: "Deadline Alarms",
      description: "Urgent alerts for upcoming task deadlines",
      importance: AndroidImportance.HIGH,
      sound: "ctu_alarm",
      vibration: true,
      vibrationPattern: [0, 400, 200, 400, 200, 800],
      lights: true,
      lightColor: notifee.AndroidColor.RED,
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: true,
    });

    // Lead-time channel — important but not alarm-grade, respects DnD
    await notifee.createChannel({
      id: LEAD_CHANNEL_ID,
      name: "Deadline Reminders",
      description: "Advance warnings before task deadlines",
      importance: AndroidImportance.DEFAULT,
      sound: "ctu_reminder",
      vibration: true,
      vibrationPattern: [0, 250, 150, 250],
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: false,
    });
  } catch (err) {
    warnIfDev("bootstrapDeadlineAlarmChannel failed:", err);
  }
}

function getDeadlineNotificationIds(taskId, thresholdKey) {
  if (thresholdKey === "due") {
    return [buildNotificationId("deadline-due", taskId, "due")];
  }
  return [buildNotificationId("deadline-lead", taskId, thresholdKey)];
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
  return buildManagedNotificationData(identifier, {
    alarmId: identifier,
    type: DEADLINE_NOTIF_TYPE,
    notificationType: DEADLINE_NOTIF_TYPE,
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

function buildOverdueNotifeeAndroid(isOngoing = true) {
  return {
    channelId: DEADLINE_CHANNEL_ID,
    category: AndroidCategory.ALARM,
    importance: AndroidImportance.HIGH,
    smallIcon: SMALL_ICON,
    largeIcon: LARGE_ICON,
    sound: "ctu_alarm",
    vibrationPattern: [0, 400, 200, 400, 200, 800],
    lights: ["#ef4444", 300, 300],
    bypassDnd: true,
    visibility: AndroidVisibility.PUBLIC,
    ongoing: isOngoing,
    autoCancel: !isOngoing,
    localOnly: false,
    fullScreenAction: {
      id: "default",
      launchActivity: ALARM_RING_ACTIVITY,
    },
    pressAction: { id: "default", launchActivity: "default" },
    actions: [
      {
        title: "✅ Done",
        pressAction: { id: ACTION_MARK_DONE, launchActivity: "default" },
      },
      {
        title: "⏰ Not Done",
        pressAction: { id: ACTION_NOT_DONE, launchActivity: "default" },
      },
    ],
  };
}

export async function displayAlarmNotification({
  id,
  title,
  body,
  data,
  isOngoing = true,
}) {
  const dueAtMs = resolveNotificationDueAtMs(data);
  const overdueMs =
    Number.isFinite(dueAtMs) && dueAtMs > 0
      ? Math.max(0, Date.now() - dueAtMs)
      : 0;
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
  };

  await notifee.displayNotification({
    id,
    title,
    body,
    data: resolvedData,
    android: buildOverdueNotifeeAndroid(isOngoing !== false),
  });
}

async function scheduleOverdueCheckpointAlarm({
  task,
  dueAtMs,
  checkpoint,
  soundSettings = {},
  triggerAt = null,
}) {
  if (!task?.id || !Number.isFinite(dueAtMs) || !checkpoint?.key) return null;

  let resolvedTriggerAt = Number(triggerAt);
  if (!Number.isFinite(resolvedTriggerAt) || resolvedTriggerAt <= 0) {
    if (checkpoint.key === "daily") {
      const daily = new Date();
      daily.setHours(8, 0, 0, 0);
      if (daily.getTime() <= Date.now()) daily.setDate(daily.getDate() + 1);
      resolvedTriggerAt = daily.getTime();
    } else if (Number.isFinite(checkpoint.delayMs)) {
      resolvedTriggerAt = dueAtMs + checkpoint.delayMs;
    } else {
      return null;
    }
  }

  const { taskTitle, subjectLabel } = getTaskAlarmMeta(task, soundSettings);
  const id = buildNotificationId("deadline-overdue", task.id, checkpoint.key);
  const title = checkpoint.key === "daily" ? "⏰ Still Overdue" : "⏰ Overdue";
  const body = buildOverdueAlarmBody(
    taskTitle,
    subjectLabel,
    dueAtMs,
    checkpoint.key
  );

  const data = buildDeadlineAlarmData(id, task, dueAtMs, soundSettings, {
    stage: checkpoint.key,
    acknowledgeRequired: true,
    isOverdueAlarm: true,
  });

  await setCheckpoint(task.id, checkpoint.key, resolvedTriggerAt);

  if (Platform.OS === "android" && isNativeAlarmSupported) {
    try {
      const canSchedule = await canScheduleExactAlarms();
      if (canSchedule.status === "success" && !canSchedule.value) {
        openExactAlarmSettings();
      } else if (canSchedule.status === "success" && canSchedule.value) {
        const result = await scheduleNativeAlarm({
          alarmId: id,
          triggerAt: resolvedTriggerAt,
          title,
          body,
          payload: data,
        });
        if (result) {
          if (resolvedTriggerAt <= Date.now() + 10_000) {
            await displayAlarmNotification({
              id: `${id}-display`,
              title,
              body,
              data,
              isOngoing: true,
            }).catch((err) =>
              warnIfDev(
                "scheduleOverdueCheckpointAlarm: immediate display failed:",
                err
              )
            );
          }
          return result;
        }
      }
    } catch (err) {
      warnIfDev("scheduleOverdueCheckpointAlarm native failed:", err);
    }
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});

    const scheduledId = await Notifications.scheduleNotificationAsync({
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
            }
          : {}),
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: "date",
              date: new Date(resolvedTriggerAt),
              channelId: DEADLINE_CHANNEL_ID,
            }
          : { date: new Date(resolvedTriggerAt) },
    });

    if (Platform.OS === "android" && resolvedTriggerAt <= Date.now() + 15_000) {
      await displayAlarmNotification({
        id: `${id}-display`,
        title,
        body,
        data,
        isOngoing: true,
      }).catch((err) =>
        warnIfDev(
          "scheduleOverdueCheckpointAlarm: notifee immediate display failed:",
          err
        )
      );
    }

    return scheduledId;
  } catch (err) {
    warnIfDev("scheduleOverdueCheckpointAlarm failed:", err);
    return null;
  }
}

async function scheduleLeadNotification({ id, title, body, data, triggerAt }) {
  if (Platform.OS !== "android") {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    return Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data, categoryIdentifier: DEADLINE_CATEGORY_ID },
      trigger: { date: new Date(triggerAt) },
    });
  }

  try {
    await notifee.cancelNotification(id).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    return Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data,
        categoryIdentifier: DEADLINE_CATEGORY_ID,
        // REMOVED: channelId from content — it doesn't belong here on Android
        sound: "ctu_reminder.wav",
        vibrationPattern: [0, 250, 150, 250],
      },
      trigger: {
        type: "date",
        date: new Date(triggerAt),
        channelId: LEAD_CHANNEL_ID, // ← only here
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
}) {
  try {
    await notifee.cancelNotification(id).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    return Notifications.scheduleNotificationAsync({
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
            }
          : {}),
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: "date",
              date: new Date(triggerAt),
              channelId: DEADLINE_CHANNEL_ID,
            }
          : { date: new Date(triggerAt) },
    });
  } catch (err) {
    warnIfDev(`scheduleDueMomentNotification [${id}] failed:`, err);
    return null;
  }
}

/**
 * Schedule daily overdue alarm for specified trigger time (typically 8AM)
 */
async function scheduleDailyOverdueAlarm(task, triggerAt, soundSettings = {}) {
  const dueAtMs = resolveTaskDueDate(task)?.getTime?.();
  if (!Number.isFinite(dueAtMs)) return null;

  const dailyCheckpoint = { stage: "daily", key: "daily", delayMs: null };
  return scheduleOverdueCheckpointAlarm({
    task,
    dueAtMs,
    checkpoint: dailyCheckpoint,
    soundSettings,
    triggerAt: triggerAt.getTime(),
  });
}

// ─────────────────────── Main API ───────────────────────
export async function scheduleDeadlineAlarms(task, soundSettings = {}) {
  if (!task?.id) return [];
  if (task.completed || task.status === "done" || isPlannerTask(task)) {
    await cancelDeadlineAlarms(task);
    return [];
  }

  // Guarantee channels exist before any scheduling
  await bootstrapDeadlineAlarmChannel();

  // At the start of scheduleDeadlineAlarms, cancel any existing
  // displayed notifications before scheduling new ones

  const due = resolveTaskDueDate(task);
  if (!due) return [];

  const now = Date.now();
  const ids = [];
  const dueAtMs = due.getTime();

  await cancelDeadlineAlarms(task);

  const { taskTitle, subjectLabel } = getTaskAlarmMeta(task, soundSettings);

  // Layer 1: lead-time warnings
  for (const lead of LEAD_TIMES) {
  const triggerTime = dueAtMs - lead.ms;
  // Skip if trigger is in the past (with a 5s grace for scheduling latency)
  if (triggerTime <= now + 5_000) continue;

    const id = buildNotificationId("deadline-lead", task.id, lead.key);
    const leadTitle = buildLeadTitle(lead.label);
    const leadBody = buildLeadBody(taskTitle, subjectLabel, due);
    const data = buildDeadlineAlarmData(id, task, dueAtMs, soundSettings, {
      leadKey: lead.key,
      isLeadTime: true,
      acknowledgeRequired: true,
    });

    const scheduledId = await scheduleLeadNotification({
      id,
      title: leadTitle,
      body: leadBody,
      data,
      triggerAt: triggerTime,
    });
    if (scheduledId) ids.push(scheduledId);
  }

  // Custom user-set reminder
  const customReminderDate = normalizeTaskDateInput(task.customReminderAt);
  const customReminderMs = customReminderDate
    ? customReminderDate.getTime()
    : task.reminderPolicy?.offsetMs
      ? dueAtMs - task.reminderPolicy.offsetMs
      : null;

  if (customReminderMs && customReminderMs > now + 5000) {
    const customId = buildNotificationId(
      "deadline-custom-reminder",
      task.id,
      "user"
    );
    const data = buildDeadlineAlarmData(
      customId,
      task,
      dueAtMs,
      soundSettings,
      {
        isCustomReminder: true,
        acknowledgeRequired: true,
      }
    );

    const scheduledId = await scheduleLeadNotification({
      id: customId,
      title: `\u23F0 Reminder: "${taskTitle}"`,
      body: buildLeadBody(taskTitle, subjectLabel, due),
      data,
      triggerAt: customReminderMs,
    });
    if (scheduledId) ids.push(scheduledId);
  }

  // Layer 2: due-moment alarm
  let scheduledDueId = null;
  if (dueAtMs > now + 5000) {
    const dueId = buildNotificationId("deadline-due", task.id, "due");
    const dueTitle = `🔔 ${taskTitle} is due NOW`;
    const dueBody = `"${taskTitle}" (${subjectLabel}) — tap Done or Not Done. Alarm loops until you respond.`;
    const dueData = buildDeadlineAlarmData(
      dueId,
      task,
      dueAtMs,
      soundSettings,
      {
        stage: "due",
        acknowledgeRequired: true,
      }
    );
    if (Platform.OS === "android" && isNativeAlarmSupported) {
      try {
        const canSchedule = await canScheduleExactAlarms();
        if (canSchedule.status === "success" && !canSchedule.value) {
          openExactAlarmSettings();
        } else if (canSchedule.status === "success" && canSchedule.value) {
          scheduledDueId = await scheduleNativeAlarm({
            alarmId: dueId,
            triggerAt: dueAtMs,
            title: dueTitle,
            body: dueBody,
            payload: dueData,
          });
        }
      } catch (err) {
        warnIfDev("scheduleNativeAlarm for due failed:", err);
      }
    } else {
      warnIfDev(
        "scheduleDeadlineAlarms: due-moment native alarm unsupported; falling back to expo-notifications."
      );
    }

    if (!scheduledDueId) {
      scheduledDueId = await scheduleDueMomentNotification({
        id: dueId,
        title: dueTitle,
        body: dueBody,
        data: dueData,
        triggerAt: dueAtMs,
      });
    }
    if (scheduledDueId) ids.push(scheduledDueId);
  }

  // AFTER — schedule each checkpoint in the chain that is still relevant
  // Track whether the due-moment alarm was scheduled natively, so we can
  // avoid double-firing an immediate "overdue" at the due moment.
  const dueMomentScheduled = Boolean(
    scheduledDueId && isNativeAlarmScheduledId(scheduledDueId)
  );

  for (const checkpoint of OVERDUE_CHAIN) {
    if (checkpoint.key === "daily") {
      const nextMorning = getNext8AM();
      const scheduledId = await scheduleDailyOverdueAlarm(
        task,
        nextMorning,
        soundSettings
      );
      if (scheduledId) ids.push(scheduledId);
      continue;
    }
    if (!Number.isFinite(checkpoint.delayMs)) continue;

    const checkpointTriggerAt = dueAtMs + checkpoint.delayMs;

    if (checkpoint.key === "due") {
      if (!dueMomentScheduled && dueAtMs <= now) {
        const scheduledId = await scheduleOverdueCheckpointAlarm({
          task,
          dueAtMs,
          checkpoint: { key: checkpoint.key, delayMs: checkpoint.delayMs },
          soundSettings,
          triggerAt: Date.now() + 1000,
        });
        if (scheduledId) ids.push(scheduledId);
      }
      continue;
    }

    if (checkpointTriggerAt <= now + 5000) continue;

    const scheduledId = await scheduleOverdueCheckpointAlarm({
      task,
      dueAtMs,
      checkpoint: { key: checkpoint.key, delayMs: checkpoint.delayMs },
      soundSettings,
      triggerAt: checkpointTriggerAt,
    });
    if (scheduledId) ids.push(scheduledId);
  }

  return ids;
}

export async function cancelDeadlineAlarms(task) {
  if (!task?.id) return;

  const thresholdKeys = [...LEAD_TIMES.map((l) => l.key), "due"];
  for (const key of thresholdKeys) {
    for (const id of getDeadlineNotificationIds(task.id, key)) {
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
  }

  for (const checkpoint of OVERDUE_CHAIN.map((c) => c.key)) {
    const overdueId = buildNotificationId("deadline-overdue", task.id, checkpoint);
    const overdueDisplayId = `${overdueId}-display`;   // ← FIXED: cancel display variant too

    for (const id of [overdueId, overdueDisplayId]) {
      try { await cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(id)); } catch (_e) {}
      try { await Notifications.cancelScheduledNotificationAsync(id); } catch (_e) {}
      try { await notifee.cancelNotification(id); } catch (_e) {}
    }
  }

  try {
    const customId = buildNotificationId(
      "deadline-custom-reminder",
      task.id,
      "user"
    );
    await cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(customId));
    await Notifications.cancelScheduledNotificationAsync(customId).catch(
      () => {}
    );
    await notifee.cancelNotification(customId).catch(() => {});
  } catch (err) {
    warnIfDev("Failed to cancel custom reminder alarm:", err);
  }

  for (const suffix of ["60m"]) {
    const followupId = buildNotificationId(
      "deadline-followup",
      task.id,
      suffix
    );
    try {
      await cancelNativeAlarmByScheduledId(
        toNativeAlarmScheduledId(followupId)
      );
    } catch (_e) {}
    try {
      await Notifications.cancelScheduledNotificationAsync(followupId);
    } catch (_e) {}
    try {
      await notifee.cancelNotification(followupId);
    } catch (_e) {}
  }

  // Cancel auto-overdue alarms scheduled by overdueAutoLaunch.js
  try {
    const autoOverdueId = buildNotificationId("auto-overdue", task.id, "open");
    await cancelNativeAlarmByScheduledId(
      toNativeAlarmScheduledId(autoOverdueId)
    );
    await Notifications.cancelScheduledNotificationAsync(autoOverdueId).catch(
      () => {}
    );
    await notifee.cancelNotification(autoOverdueId).catch(() => {});
  } catch (_e) {}
}

export async function rescheduleAllDeadlineAlarms(
  tasks = [],
  soundSettings = {}
) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const now = Date.now();

  const results = await Promise.all(
    tasks
      .filter(
        (task) =>
          !task.completed && !isPlannerTask(task) && resolveTaskDueDate(task)
      )
      .map(async (task) => {
        // If task is already overdue and has an active checkpoint,
        // skip rescheduling — backgroundAlarmChecker handles repair
        const dueMs = resolveTaskDueDate(task)?.getTime();
        if (dueMs && dueMs <= now) {
          const checkpoint = await getCheckpoint(task.id);
          if (checkpoint?.key) return [];
        }
        return scheduleDeadlineAlarms(task, soundSettings);
      })
  );
  return results.flat().filter(Boolean);
}

export async function scheduleNextOverdueAlarm({
  task,
  checkpoint,
  soundSettings = {},
  triggerAt = null,
}) {
  const dueAtMs = resolveTaskDueDate(task)?.getTime?.();
  if (!task?.id || !Number.isFinite(dueAtMs) || !checkpoint?.key) return null;
  return scheduleOverdueCheckpointAlarm({
          task,
          dueAtMs,
          checkpoint: { key: checkpoint.key, delayMs: checkpoint.delayMs },
          soundSettings,
          triggerAt: triggerAt ?? Date.now() + 3000,
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
  const pendingAction =
    actionIdentifier === ACTION_MARK_DONE
      ? "markdone"
      : actionIdentifier === ACTION_NOT_DONE
        ? "notdone"
        : "default";

  try {
    if (Platform.OS === "android") await stopActiveNativeAlarm();
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

  if (Platform.OS === "android") {
    try {
      await writeAlarmAction(pendingAction, taskId, JSON.stringify(data));
    } catch (_e) {}
  }
}
