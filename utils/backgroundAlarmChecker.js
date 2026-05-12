/**
 * utils/backgroundAlarmChecker.js
 *
 * Background task for missed deadline alarms when app is killed.
 *
 * Architecture: reactive + minimal
 * Does NOT fire its own alarms. Instead:
 * - Inspects the merged remote + offline pending task set
 * - For each task with a stored checkpoint but no matching scheduled alarm,
 *   repairs the broken chain by scheduling the current checkpoint alarm
 */
import * as Notifications from "expo-notifications";
import { enableNetwork } from "firebase/firestore";
import { auth, db } from "../config/firebase";
import { resolveTaskDueDate } from "./academicTaskModel";
import {
    bootstrapDeadlineAlarmChannel,
    cancelDeadlineAlarms,
    rescheduleAllDeadlineAlarms,
    scheduleNextOverdueAlarm,
} from "./deadlineAlarmBackground";
import { OVERDUE_CHAIN } from "./deadlineConstants";
import { reportError, warnIfDev } from "./logger";
import { buildNotificationId } from "./notificationIds";
import {
    clearPendingNotificationReschedule,
    clearTaskRescheduleIntent,
    clearTaskRescheduleIntents,
    listTaskRescheduleIntents,
    readPendingNotificationReschedule,
} from "./notificationScheduleRecovery";
import {
    readSchedulablePendingTasks
} from "./pendingTaskSources";
import {
    getCheckpoint,
    resolveCurrentOverdueStageInfo,
} from "./taskOverdueState";

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

const isValidBackgroundFetchResult = (result) => {
  return result && (result === backgroundFetchResult.NewData || result === backgroundFetchResult.NoData || result === backgroundFetchResult.Failed);
};

const getBackgroundFetchResult = (resultType) => {
  const result = backgroundFetchResult[resultType];
  if (result === undefined) {
    warnIfDev(`[BackgroundTask] BackgroundFetchResult.${resultType} is undefined`);
    return resultType === "Failed" ? 1 : (resultType === "NewData" ? 1 : 0);
  }
  return result;
};

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

try {
  if (
    TaskManager &&
    typeof TaskManager.defineTask === "function" &&
    !isTaskManagerTaskDefined(BACKGROUND_ALARM_TASK)
  ) {
    TaskManager.defineTask(BACKGROUND_ALARM_TASK, async () => {
      const user = auth.currentUser;
      if (!user) {
        warnIfDev("[BackgroundTask] No user - skipping");
        return getBackgroundFetchResult("NoData");
      }

      try {
        // Re-enable network in case firebase.js disabled it
        await enableNetwork(db).catch(() => {});

        await bootstrapDeadlineAlarmChannel();

        const now = Date.now();
        const pendingTasks = await readSchedulablePendingTasks(user.uid, {
          warnContext: "backgroundAlarmChecker",
        });
        const pendingTaskMap = new Map(
          pendingTasks.map((task) => [String(task.id || ""), task])
        );
        const pendingReschedule = await readPendingNotificationReschedule();
        const pendingTaskIntents = await listTaskRescheduleIntents(user.uid);
        let recoveredSchedules = 0;

        // Get all currently scheduled notification identifiers BEFORE clearing recovery intents
        // This prevents race conditions where new alarms are scheduled during recovery
        let scheduledIds = new Set();
        try {
          const scheduled =
            await Notifications.getAllScheduledNotificationsAsync();
          scheduledIds = new Set(scheduled.map((n) => n.request.identifier));
        } catch {
          scheduledIds = new Set();
        }

        if (
          pendingReschedule?.uid === user.uid ||
          pendingTaskIntents.length > 0
        ) {
          const tasksToRecover =
            pendingReschedule?.uid === user.uid
              ? pendingTasks
              : pendingTaskIntents
                  .map((taskId) => pendingTaskMap.get(taskId))
                  .filter(Boolean);

          if (tasksToRecover.length > 0) {
            const rescheduledIds = await rescheduleAllDeadlineAlarms(tasksToRecover);
            if (Array.isArray(rescheduledIds) && rescheduledIds.length > 0) {
              recoveredSchedules += rescheduledIds.length;
            } else {
              warnIfDev(`[BackgroundTask] Failed to reschedule ${tasksToRecover.length} tasks for recovery`);
            }
          }

          if (pendingReschedule?.uid === user.uid) {
            await clearPendingNotificationReschedule(user.uid);
            await clearTaskRescheduleIntents(user.uid);
          } else {
            for (const taskId of pendingTaskIntents) {
              if (!pendingTaskMap.has(taskId)) {
                await cancelDeadlineAlarms({ id: taskId });
              }
              await clearTaskRescheduleIntent(user.uid, taskId);
            }
          }
        }

        let repaired = 0;

        for (const task of overdueTasks) {
          if (task.status === "done" || task.completed === true) {
            await cancelDeadlineAlarms(task);
            continue;
          }

          const dueAtMs = resolveTaskDueDate(task)?.getTime?.();
          const currentStageInfo = resolveCurrentOverdueStageInfo(dueAtMs, now);
          let checkpoint = await getCheckpoint(task.id);
          const resolvedStageKey = currentStageInfo?.key || checkpoint?.key;
          if (!resolvedStageKey) continue;
          if (!checkpoint?.key) {
            checkpoint = {
              key: resolvedStageKey,
              triggerAtMs: currentStageInfo?.triggerAtMs ?? null,
            };
          }

          // Check if the current checkpoint alarm is already scheduled
          const expectedId = buildNotificationId(
            "deadline-overdue",
            task.id,
            checkpoint.key // ← confirmed: uses .key (normalized in Step 2)
          );
          if (scheduledIds.has(expectedId)) continue;
          const currentExpectedId = buildNotificationId(
            "deadline-overdue",
            task.id,
            resolvedStageKey
          );
          if (scheduledIds.has(currentExpectedId)) continue;

          const pendingTriggerAt =
            Number.isFinite(currentStageInfo?.triggerAtMs) &&
            currentStageInfo.triggerAtMs > 0
              ? currentStageInfo.triggerAtMs
              : Number.isFinite(checkpoint?.triggerAtMs) &&
                  checkpoint.triggerAtMs > 0
                ? checkpoint.triggerAtMs
                : null;
          const TRIGGER_GRACE_MS = 30 * 1000;
          if (
            Number.isFinite(checkpoint?.triggerAtMs) &&
            checkpoint.triggerAtMs > now + TRIGGER_GRACE_MS
          ) {
            continue;
          }
          if (
            Number.isFinite(checkpoint?.triggerAtMs) &&
            Math.abs(now - checkpoint.triggerAtMs) < TRIGGER_GRACE_MS
          ) {
            continue;
          }
          // REMOVED: REPAIR_COOLDOWN_MS check — it blocked repairs for 10 minutes
          // even when the alarm definitively did not fire

          // Chain is broken - repair by scheduling the current checkpoint alarm
          const currentCheckpoint = OVERDUE_CHAIN.find(
            (c) => c.key === checkpoint.key // ← confirmed: uses .key
          );
          if (!currentCheckpoint) continue;

          // Re-validate checkpoint hasn't changed due to concurrent modifications
          const revalidatedCheckpoint = await getCheckpoint(task.id);
          if (revalidatedCheckpoint?.key !== checkpoint.key) {
            warnIfDev(
              `[BackgroundTask] Checkpoint changed concurrently for task ${task.id}, skipping repair`
            );
            continue;
          }

          const effectiveCheckpoint =
            OVERDUE_CHAIN.find((c) => c.key === resolvedStageKey) ||
            currentCheckpoint;

          // Fire repair alarm 30 seconds from now to avoid spamming immediately.
          const repairTriggerAt =
            Number.isFinite(pendingTriggerAt) && pendingTriggerAt > now
              ? pendingTriggerAt
              : now + 1500;

          const repairedId = await scheduleNextOverdueAlarm({
            task,
            checkpoint: {
              key: effectiveCheckpoint.key,
              delayMs: effectiveCheckpoint.delayMs,
            },
            triggerAt: repairTriggerAt,
            intendedTriggerAtMs: pendingTriggerAt,
            deliveryPathHint: "background_repair",
          });
          if (repairedId) repaired += 1;
        }

        warnIfDev(
          `[BackgroundTask] Recovered ${recoveredSchedules} schedules and repaired ${repaired} broken chains for ${user.uid}`
        );
        return recoveredSchedules > 0 || repaired > 0
          ? getBackgroundFetchResult("NewData")
          : getBackgroundFetchResult("NoData");
      } catch (err) {
        reportError(err, {
          message: "Background alarm checker failed",
          tags: { location: "background_alarm_checker" },
        });
        return getBackgroundFetchResult("Failed");
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
