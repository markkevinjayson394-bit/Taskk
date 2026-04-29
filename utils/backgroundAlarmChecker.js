/**
 * utils/backgroundAlarmChecker.js
 *
 * Background task for missed deadline alarms when app is killed.
 *
 * Architecture: reactive + minimal
 * Does NOT fire its own alarms. Instead:
 * - Queries Firestore for overdue incomplete tasks
 * - For each task with a stored checkpoint but no matching scheduled alarm,
 *   repairs the broken chain by scheduling the current checkpoint alarm
 */
import * as Notifications from "expo-notifications";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Platform } from "react-native";
import { auth, db } from "../config/firebase";
import {
  bootstrapDeadlineAlarmChannel,
  cancelDeadlineAlarms,
  DEADLINE_CATEGORY_ID,
  DEADLINE_CHANNEL_ID,
  DEADLINE_NOTIF_TYPE
} from "./deadlineAlarmBackground";
import { reportError, warnIfDev } from "./logger";
import {
  canScheduleExactAlarms,
  isNativeAlarmSupported,
  scheduleNativeAlarm,
} from "./nativeAlarm";
import {
  buildManagedNotificationData,
  buildNotificationId,
} from "./notificationIds";
import { isPlannerTask } from "./taskFilters";
import { getCheckpoint, OVERDUE_CHAIN } from "./taskOverdueState";

let TaskManager = null;
try {
  TaskManager = require("expo-task-manager");
} catch (err) {
  warnIfDev("TaskManager unavailable:", err);
  TaskManager = null;
}

let BackgroundFetch = null;
try {
  BackgroundFetch = require("expo-background-fetch");
} catch (err) {
  warnIfDev("BackgroundFetch unavailable:", err);
}


const MAX_TASKS_PER_RUN = 20;

const backgroundFetchResult = BackgroundFetch?.BackgroundFetchResult || {};
const backgroundFetchStatus = BackgroundFetch?.BackgroundFetchStatus || {};

const isTaskManagerTaskDefined = (taskName) => {
  if (!TaskManager || typeof TaskManager.isTaskDefined !== "function") {
    return false;
  }
  try {
    return TaskManager.isTaskDefined(taskName);
  } catch (err) {
    warnIfDev("TaskManager.isTaskDefined check failed:", err);
    return false;
  }
};

export const BACKGROUND_ALARM_TASK = "background-deadline-alarm-checker";

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);

try {
  if (
    TaskManager &&
    typeof TaskManager.defineTask === "function" &&
    !isTaskManagerTaskDefined(BACKGROUND_ALARM_TASK)
  ) {
    TaskManager.defineTask(BACKGROUND_ALARM_TASK, async () => {
      const user = auth.currentUser;
      if (!user) {
        warnIfDev("[BackgroundTask] No user — skipping");
        return backgroundFetchResult.NoData;
      }

      try {
        await bootstrapDeadlineAlarmChannel();

        const now = Date.now();
        const overdueQuery = query(
          collection(db, "assignments"),
          where("userId", "==", user.uid),
          where("completed", "==", false),
          where("dueAt", "<=", new Date(now)),
          orderBy("dueAt", "asc"),
          limit(MAX_TASKS_PER_RUN)
        );
        const FIRESTORE_QUERY_TIMEOUT_MS = 10000; // 10s max for the query
        const snap = await withTimeout(
          getDocs(overdueQuery),
          FIRESTORE_QUERY_TIMEOUT_MS
        );

        // Get all currently scheduled notification identifiers
        let scheduledIds = new Set();
        try {
          const scheduled =
            await Notifications.getAllScheduledNotificationsAsync();
          scheduledIds = new Set(scheduled.map((n) => n.request.identifier));
        } catch {
          scheduledIds = new Set();
        }

        let repaired = 0;

        for (const docSnap of snap.docs) {
          const task = { id: docSnap.id, ...docSnap.data() };
          if (isPlannerTask(task)) continue;
          if (task.status === "done" || task.completed === true) {
            await cancelDeadlineAlarms(task);
            continue;
          }

          const checkpoint = await getCheckpoint(task.id);
          if (!checkpoint) continue;

          // Check if the current checkpoint alarm is already scheduled
          const expectedId = buildNotificationId(
            "deadline-overdue",
            task.id,
            checkpoint.stage
          );
          if (scheduledIds.has(expectedId)) continue;

          const REPAIR_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
          if (
            checkpoint.scheduledAt &&
            Date.now() - checkpoint.scheduledAt < REPAIR_COOLDOWN_MS
          ) {
            continue;
          }

          // Chain is broken — repair by scheduling the current checkpoint alarm
          const dueAtMs = new Date(
            task.dueAt?.toDate?.() || task.dueAt
          ).getTime();
          const currentCheckpoint = OVERDUE_CHAIN.find(
            (c) => c.key === checkpoint.stage
          );
          if (!currentCheckpoint) continue;

          // Fire repair alarm 30 seconds from now to avoid spamming immediately
          const repairTriggerAt = now + 30 * 1000;
          const id = buildNotificationId(
            "deadline-overdue",
            task.id,
            checkpoint.stage
          );
          const taskTitle =
            typeof task.title === "string" && task.title.trim()
              ? task.title.trim()
              : "Task";
          const subject = task.subject || task.subjectName || "General";
          const overdueMin = Math.round((now - dueAtMs) / 60000);
          const body = `"${taskTitle}" (${subject}) is ${overdueMin} min overdue. Mark it done or acknowledge.`;

          const data = buildManagedNotificationData(id, {
            type: DEADLINE_NOTIF_TYPE,
            notificationType: DEADLINE_NOTIF_TYPE,
            taskId: task.id,
            taskTitle,
            subject,
            dueAtMs: Number.isFinite(dueAtMs) ? dueAtMs : null,
            stage: checkpoint.stage,
            acknowledgeRequired: true,
          });

          const extra =
            Platform.OS === "android"
              ? {
                  channelId: DEADLINE_CHANNEL_ID,
                  priority: "max",
                  sticky: true,
                  autoDismiss: false,
                  sound: "ctu_alarm.wav",
                  vibrationPattern: [0, 400, 200, 400, 200, 800],
                }
              : {};

          const exactAlarmResult =
            Platform.OS === "android" && isNativeAlarmSupported
              ? await canScheduleExactAlarms()
              : { status: "unsupported" };
          const exactAllowed =
            exactAlarmResult?.status === "success" &&
            exactAlarmResult?.value === true;

          if (exactAllowed) {
            try {
              const nativeId = await scheduleNativeAlarm({
                alarmId: id,
                triggerAt: repairTriggerAt,
                title: "Task still overdue",
                body,
                payload: data,
              });
              if (nativeId) {
                repaired += 1;
                continue; // Only skip expo fallback if native succeeded
              }
            } catch (err) {
              warnIfDev("Background repair native alarm failed:", err);
            }
          }

          try {
            await Notifications.cancelScheduledNotificationAsync(id).catch(
              () => {}
            );
            await Notifications.scheduleNotificationAsync({
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
                      date: new Date(repairTriggerAt),
                      channelId: DEADLINE_CHANNEL_ID,
                    }
                  : { date: new Date(repairTriggerAt) },
            });
            repaired += 1;
          } catch (err) {
            warnIfDev("Background repair expo notification failed:", err);
          }
        }

        warnIfDev(
          `[BackgroundTask] Repaired ${repaired} broken chains for ${user.uid}`
        );
        return repaired > 0
          ? backgroundFetchResult.NewData
          : backgroundFetchResult.NoData;
      } catch (err) {
        reportError(err, {
          message: "Background alarm checker failed",
          tags: { location: "background_alarm_checker" },
        });
        return backgroundFetchResult.Failed;
      }
    });
  }
} catch (err) {
  reportError(err, {
    message: "Failed to register background alarm task.",
    tags: { location: "background_alarm_task_registration" },
  });
}

/**
 * Ensures the task handler exists.
 */
export async function startBackgroundAlarmChecker() {
  if (!TaskManager || typeof TaskManager.isTaskRegisteredAsync !== "function") {
    return isTaskManagerTaskDefined(BACKGROUND_ALARM_TASK);
  }

  try {
    return await TaskManager.isTaskRegisteredAsync(BACKGROUND_ALARM_TASK);
  } catch (err) {
    warnIfDev("TaskManager.isTaskRegisteredAsync failed:", err);
    return isTaskManagerTaskDefined(BACKGROUND_ALARM_TASK);
  }
}

/**
 * Request permission + prepare background alarm support.
 */
export async function enableBackgroundAlarms() {
  try {
    const permission =
      typeof Notifications.getPermissionsAsync === "function"
        ? await Notifications.getPermissionsAsync()
        : await Notifications.requestPermissionsAsync();
    const status = permission?.status;

    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      if (requested?.status !== "granted") {
        console.warn("[BackgroundTask] Notifications permission denied");
        return false;
      }
    }

    await bootstrapDeadlineAlarmChannel();

    if (
      !BackgroundFetch ||
      typeof BackgroundFetch.getStatusAsync !== "function" ||
      typeof BackgroundFetch.registerTaskAsync !== "function"
    ) {
      warnIfDev("[BackgroundTask] BackgroundFetch module unavailable");
      return false;
    }

    const fetchStatus = await BackgroundFetch.getStatusAsync();
    if (
      fetchStatus === backgroundFetchStatus.Denied ||
      fetchStatus === backgroundFetchStatus.Restricted
    ) {
      warnIfDev("[BackgroundTask] Background fetch unavailable", {
        fetchStatus,
      });
      return false;
    }

    let alreadyRegistered = false;
    if (
      TaskManager &&
      typeof TaskManager.isTaskRegisteredAsync === "function"
    ) {
      try {
        alreadyRegistered = await TaskManager.isTaskRegisteredAsync(
          BACKGROUND_ALARM_TASK
        );
      } catch (err) {
        warnIfDev("TaskManager.isTaskRegisteredAsync failed:", err);
      }
    }

    if (!alreadyRegistered) {
      try {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_ALARM_TASK, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      } catch (err) {
        reportError(err, {
          message: "Background alarm checker registration failed.",
          tags: { location: "background_alarm_task_register" },
        });
        return false;
      }
    }

    warnIfDev("[BackgroundTask] Enabled");
    return true;
  } catch (err) {
    warnIfDev("enableBackgroundAlarms failed:", err);
    return false;
  }
}
