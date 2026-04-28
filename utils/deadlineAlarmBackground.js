/**
 * utils/deadlineAlarmBackground.js
 *
 * Background-friendly deadline alarm scheduler built on expo-notifications
 * and NativeAlarmModule exact alarms.
 *
 * Architecture: reactive + minimal
 * - Layer 1: lead-time warnings (1d, 2h, 30m) — standard dismissable notifications
 * - Layer 2: due-moment alarm — pre-scheduled, alarm-style
 * - Chain: when due/overdue alarm fires and user taps "Not Done" inside the app modal,
 *   the modal advances the checkpoint (due → +15m → +1h → +3h → daily 8 AM → repeats).
 *   Chain only stops when user taps "Done" inside the modal.
 *
 * NOTIFICATION SHADE BUTTONS ("Done" / "Not Done"):
 * - These only stop the alarm sound/vibration and open the app.
 * - DeadlineAlarmModal is the single source of truth for all chain logic.
 * - No advanceCheckpoint, no scheduleNextOverdueAlarm, no Firestore writes here.
 *
 * FIXES APPLIED:
 * - [FIX 1] Replaced ACTION_ACKNOWLEDGE + ACTION_SNOOZE_10 with ACTION_NOT_DONE.
 * - [FIX 2] handleDeadlineAlarmResponse simplified — all buttons (Done, Not Done,
 *   default tap) only stop the native alarm + dismiss the OS notification then
 *   return. The app opens and DeadlineAlarmModal handles all real logic.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { parseDueDate } from "./academicTaskModel";
import { warnIfDev } from "./logger";
import {
  cancelNativeAlarmByScheduledId,
  isNativeAlarmSupported,
  scheduleNativeAlarm,
  stopActiveNativeAlarm,
  toNativeAlarmScheduledId,
} from "./nativeAlarm";
import {
  buildManagedNotificationData,
  buildNotificationId,
} from "./notificationIds";
import { isPlannerTask } from "./taskFilters";
import { clearCheckpoint, OVERDUE_CHAIN } from "./taskOverdueState";

export { OVERDUE_CHAIN };

export const DEADLINE_NOTIF_TYPE = "deadline_alarm";
export const DEADLINE_CHANNEL_ID = "ctu-deadline-alarms-v1";
export const DEADLINE_CATEGORY_ID = "deadline_alarm_actions";
const ACTION_NOT_DONE = "not_done_deadline_alarm";
const ACTION_MARK_DONE = "mark_done_deadline_alarm";

// Lead-time thresholds — 3 standard dismissable warnings
const LEAD_TIMES = [
  { key: "1d", ms: 24 * 60 * 60 * 1000, label: "1 day" },
  { key: "2h", ms: 2 * 60 * 60 * 1000, label: "2 hours" },
  { key: "30m", ms: 30 * 60 * 1000, label: "30 min" },
];

function getDeadlineNotificationIds(taskId, thresholdKey) {
  if (thresholdKey === "due") {
    return [buildNotificationId("deadline-due", taskId, "due")];
  }
  return [buildNotificationId("deadline-lead", taskId, thresholdKey)];
}

function buildLeadTitle(label) {
  return `Due in ${label}`;
}

function buildLeadBody(taskTitle, subjectLabel, due) {
  const dueStr = due.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `"${taskTitle}" (${subjectLabel}) is due at ${dueStr}.`;
}

function androidAlarmExtra(soundSettings = {}) {
  const soundUri = soundSettings.taskAlarmSoundUri || "ctu_alarm.wav";
  return Platform.OS === "android"
    ? {
        channelId: DEADLINE_CHANNEL_ID,
        priority: "max",
        sticky: true,
        autoDismiss: false,
        sound: soundUri,
        vibrationPattern: [0, 400, 200, 400, 200, 800],
      }
    : {};
}

export async function bootstrapDeadlineAlarmChannel() {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(DEADLINE_CHANNEL_ID, {
        name: "Deadline Alarms",
        description: "Urgent alerts for upcoming task deadlines",
        importance: Notifications.AndroidImportance.MAX,
        sound: "ctu_alarm.wav",
        vibrationPattern: [0, 400, 200, 400, 200, 800],
        enableLights: true,
        lightColor: "#ef4444",
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    }

    if (typeof Notifications.setNotificationCategoryAsync === "function") {
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
    }
  } catch (err) {
    warnIfDev("bootstrapDeadlineAlarmChannel failed:", err);
  }
}

export async function scheduleDeadlineAlarms(task, soundSettings = {}) {
  if (!task?.id) return [];
  if (task.completed || task.status === "done" || isPlannerTask(task)) {
    await cancelDeadlineAlarms(task);
    return [];
  }

  const due = parseDueDate(task.dueAt);
  if (!due) return [];

  const now = Date.now();
  const ids = [];
  await cancelDeadlineAlarms(task);

  const taskTitle = task.title || "Task";
  const subjectLabel = task.subject || task.subjectName || "General";
  const dueAtMs = due.getTime();

  // Layer 1 — lead-time warnings (standard dismissable, no sticky/alarm)
  for (const lead of LEAD_TIMES) {
    const triggerTime = dueAtMs - lead.ms;
    if (triggerTime <= now + 5000) continue;

    const id = buildNotificationId("deadline-lead", task.id, lead.key);
    const data = buildManagedNotificationData(id, {
      type: DEADLINE_NOTIF_TYPE,
      notificationType: DEADLINE_NOTIF_TYPE,
      taskId: task.id,
      taskTitle,
      subject: subjectLabel,
      dueAtMs,
      leadKey: lead.key,
      isLeadTime: true,
      acknowledgeRequired: false,
    });

    try {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      const scheduledId = await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: buildLeadTitle(lead.label),
          body: buildLeadBody(taskTitle, subjectLabel, due),
          data,
          ...(Platform.OS === "android"
            ? { channelId: DEADLINE_CHANNEL_ID }
            : {}),
        },
        trigger:
          Platform.OS === "android"
            ? {
                type: "date",
                date: new Date(triggerTime),
                channelId: DEADLINE_CHANNEL_ID,
              }
            : { date: new Date(triggerTime) },
      });
      if (scheduledId) ids.push(scheduledId);
    } catch (err) {
      warnIfDev(`scheduleDeadlineAlarms lead [${lead.key}] failed:`, err);
    }
  }

  // Custom user-set reminder (from task editor)
  const customReminderMs = task.customReminderAt
    ? new Date(task.customReminderAt).getTime()
    : task.reminderPolicy?.offsetMs
      ? dueAtMs - task.reminderPolicy.offsetMs
      : null;

  if (customReminderMs && customReminderMs > now + 5000) {
    const customId = buildNotificationId(
      "deadline-custom-reminder",
      task.id,
      "user"
    );
    const data = buildManagedNotificationData(customId, {
      type: DEADLINE_NOTIF_TYPE,
      notificationType: DEADLINE_NOTIF_TYPE,
      taskId: task.id,
      taskTitle,
      subject: subjectLabel,
      dueAtMs,
      isCustomReminder: true,
      acknowledgeRequired: false,
    });

    try {
      await Notifications.cancelScheduledNotificationAsync(customId).catch(
        () => {}
      );
      const scheduledId = await Notifications.scheduleNotificationAsync({
        identifier: customId,
        content: {
          title: `Reminder: "${taskTitle}"`,
          body: buildLeadBody(taskTitle, subjectLabel, due),
          data,
          ...(Platform.OS === "android"
            ? { channelId: DEADLINE_CHANNEL_ID }
            : {}),
        },
        trigger:
          Platform.OS === "android"
            ? {
                type: "date",
                date: new Date(customReminderMs),
                channelId: DEADLINE_CHANNEL_ID,
              }
            : { date: new Date(customReminderMs) },
      });
      if (scheduledId) ids.push(scheduledId);
    } catch (err) {
      warnIfDev("scheduleDeadlineAlarms custom reminder failed:", err);
    }
  }

  // Layer 2 — due-moment alarm (pre-scheduled, alarm-style)
  if (dueAtMs > now + 5000) {
    const dueId = buildNotificationId("deadline-due", task.id, "due");
    const dueData = buildManagedNotificationData(dueId, {
      type: DEADLINE_NOTIF_TYPE,
      notificationType: DEADLINE_NOTIF_TYPE,
      taskId: task.id,
      taskTitle,
      subject: subjectLabel,
      dueAtMs,
      stage: "due",
      acknowledgeRequired: true,
    });

    if (Platform.OS === "android" && isNativeAlarmSupported) {
      try {
        const result = await scheduleNativeAlarm({
          alarmId: dueId,
          triggerAt: dueAtMs,
          title: `${taskTitle} is due NOW`,
          body: `"${taskTitle}" (${subjectLabel}) is due. Mark it done or tap Not Done to be reminded later.`,
          payload: dueData,
        });
        if (result?.status === "success" && result?.value) {
          ids.push(result.value);
        } else {
          await scheduleExpoDueAlarm(dueId, dueData, soundSettings);
          ids.push(dueId);
        }
      } catch (err) {
        warnIfDev("scheduleNativeAlarm for due failed:", err);
        await scheduleExpoDueAlarm(dueId, dueData, soundSettings);
        ids.push(dueId);
      }
    } else {
      await scheduleExpoDueAlarm(dueId, dueData, soundSettings);
      ids.push(dueId);
    }
  }

  return ids;
}

async function scheduleExpoDueAlarm(id, data, soundSettings) {
  const extra = androidAlarmExtra(soundSettings);
  try {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: "Task due now",
        body: data.taskTitle
          ? `"${data.taskTitle}" is due. Mark it done or tap Not Done to be reminded later.`
          : "Task is due now.",
        data,
        categoryIdentifier: DEADLINE_CATEGORY_ID,
        ...extra,
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: "date",
              date: new Date(data.dueAtMs),
              channelId: DEADLINE_CHANNEL_ID,
            }
          : { date: new Date(data.dueAtMs) },
    });
  } catch (err) {
    warnIfDev("scheduleExpoDueAlarm failed:", err);
  }
}

export async function cancelDeadlineAlarms(task) {
  if (!task?.id) return;

  const thresholdKeys = [...LEAD_TIMES.map((l) => l.key), "due"];
  for (const key of thresholdKeys) {
    for (const id of getDeadlineNotificationIds(task.id, key)) {
      try {
        await cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(id));
      } catch (err) {
        warnIfDev("Failed to cancel native deadline alarm:", err);
      }
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch (err) {
        warnIfDev("Failed to cancel deadline notification:", err);
      }
    }
  }

  // Cancel overdue chain alarms
  for (const checkpoint of OVERDUE_CHAIN.map((c) => c.key)) {
    const overdueId = buildNotificationId(
      "deadline-overdue",
      task.id,
      checkpoint
    );
    try {
      await cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(overdueId));
    } catch {}
    try {
      await Notifications.cancelScheduledNotificationAsync(overdueId);
    } catch {}
  }

  // Cancel custom user-set reminder
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
  } catch (err) {
    warnIfDev("Failed to cancel custom reminder alarm:", err);
  }

  await clearCheckpoint(task.id);
}

export async function rescheduleAllDeadlineAlarms(
  tasks = [],
  soundSettings = {}
) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const pending = tasks.filter(
    (task) =>
      !task.completed && !isPlannerTask(task) && parseDueDate(task.dueAt)
  );
  const results = await Promise.all(
    pending.map((task) => scheduleDeadlineAlarms(task, soundSettings))
  );
  return results.flat().filter(Boolean);
}

export async function scheduleNextOverdueAlarm(
  taskId,
  taskTitle,
  dueAtMs,
  checkpoint
) {
  let triggerAt;
  if (checkpoint.key === "daily") {
    const t = new Date();
    t.setHours(8, 0, 0, 0);
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
    triggerAt = t.getTime();
  } else {
    triggerAt = Date.now() + checkpoint.delayMs;
  }

  const id = buildNotificationId("deadline-overdue", taskId, checkpoint.key);
  const overdueMin = Math.round((Date.now() - dueAtMs) / 60000);
  const body = taskTitle
    ? `"${taskTitle}" is ${overdueMin} min overdue. Mark it done or tap Not Done to be reminded again.`
    : `Task is ${overdueMin} min overdue. Mark it done or tap Not Done to be reminded again.`;

  const data = buildManagedNotificationData(id, {
    type: DEADLINE_NOTIF_TYPE,
    notificationType: DEADLINE_NOTIF_TYPE,
    taskId,
    taskTitle: taskTitle || "",
    dueAtMs,
    stage: checkpoint.key,
    acknowledgeRequired: true,
  });

  if (Platform.OS === "android" && isNativeAlarmSupported) {
    try {
      const result = await scheduleNativeAlarm({
        alarmId: id,
        triggerAt,
        title: "Task still overdue",
        body,
        payload: data,
      });
      if (result?.status === "success" && result?.value) return result.value;
    } catch (err) {
      warnIfDev("scheduleNextOverdueAlarm native failed:", err);
    }
  }

  const extra = androidAlarmExtra({});
  try {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    return await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: "Task still overdue",
        body,
        data,
        categoryIdentifier: DEADLINE_CATEGORY_ID,
        ...extra,
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
    warnIfDev("scheduleNextOverdueAlarm failed:", err);
    return null;
  }
}

/**
 * handleDeadlineAlarmResponse
 *
 * Called when user interacts with a deadline notification from the shade
 * (including when the app was killed and reopened via notification tap).
 *
 * ALL button actions here only:
 *   1. Stop the native alarm sound/vibration
 *   2. Dismiss the OS notification
 *   3. Return — the app will open and DeadlineAlarmModal handles all real logic.
 *
 * No advanceCheckpoint, no scheduleNextOverdueAlarm, no cancelDeadlineAlarms,
 * no Firestore writes. DeadlineAlarmModal is the single source of truth.
 */
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

  // Stop alarm sound/vibration and dismiss the OS notification.
  // This is all we do — the app opens and DeadlineAlarmModal handles the rest.
  try {
    if (Platform.OS === "android") {
      await stopActiveNativeAlarm();
    }
    if (
      notificationIdentifier &&
      typeof Notifications.dismissNotificationAsync === "function"
    ) {
      await Notifications.dismissNotificationAsync(
        notificationIdentifier
      ).catch(() => {});
    }
  } catch (err) {
    warnIfDev(
      "handleDeadlineAlarmResponse: failed to stop/dismiss notification:",
      err
    );
  }

  // All three cases (Done, Not Done, default tap) do the same thing here —
  // silence the alarm. DeadlineAlarmModal takes over once the app is open.
}
