import notifee from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import { AppRegistry } from "react-native";
import {
    ALARM_KIND_OVERDUE_SEED,
    bootstrapDeadlineAlarmChannel,
    DEADLINE_NOTIF_TYPE,
    resolveNotificationAlarmKind,
    scheduleNextOverdueAlarm,
} from "../utils/deadlineAlarmBackground";
import { OVERDUE_CHAIN } from "../utils/deadlineConstants";
import { warnIfDev } from "../utils/logger";
import {
    advanceCheckpoint,
    compareOverdueStageOrder,
    getCheckpoint,
    setCheckpoint,
} from "../utils/taskOverdueState";

function parsePayloadJson(payloadJson) {
  if (typeof payloadJson !== "string" || !payloadJson.trim()) return {};
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}

function toStageKey(payload = {}) {
  if (typeof payload?.stage === "string" && payload.stage.trim()) {
    return payload.stage.trim();
  }
  if (typeof payload?.threshold === "string" && payload.threshold.trim()) {
    return payload.threshold.trim();
  }
  return null;
}

function buildTaskFromPayload(
  taskId,
  payload = {},
  fallbackTitle = "Task",
  dueAtMs
) {
  return {
    id: taskId,
    title:
      typeof payload?.taskTitle === "string" && payload.taskTitle.trim()
        ? payload.taskTitle.trim()
        : fallbackTitle,
    subject:
      typeof payload?.subjectLabel === "string" && payload.subjectLabel.trim()
        ? payload.subjectLabel.trim()
        : typeof payload?.subject === "string" && payload.subject.trim()
          ? payload.subject.trim()
          : "General",
    subjectName:
      typeof payload?.subjectLabel === "string" && payload.subjectLabel.trim()
        ? payload.subjectLabel.trim()
        : typeof payload?.subject === "string" && payload.subject.trim()
          ? payload.subject.trim()
          : "General",
    type:
      typeof payload?.taskType === "string" && payload.taskType.trim()
        ? payload.taskType.trim()
        : "custom",
    priority:
      typeof payload?.taskPriority === "string" && payload.taskPriority.trim()
        ? payload.taskPriority.trim()
        : "medium",
    dueAt: new Date(dueAtMs).toISOString(),
  };
}

AppRegistry.registerHeadlessTask("AlarmMissedTask", () => async (data) => {
  try {
    await bootstrapDeadlineAlarmChannel().catch(() => {});

    const payload = parsePayloadJson(data?.payloadJson);
    const taskId = payload?.taskId || data?.alarmId || "";
    const stageKey = toStageKey(payload);
    const dueAtMs = Number(payload?.dueAtMs ?? payload?.dueDateMs);
    const currentAlarmId =
      typeof data?.alarmId === "string" && data.alarmId ? data.alarmId : null;
    const alarmKind = resolveNotificationAlarmKind(payload);

    warnIfDev(
      `[AlarmMissedTask] Running for task ${taskId}, stage: ${stageKey}, kind: ${alarmKind}, alarmId: ${currentAlarmId}`
    );

    if (
      !taskId ||
      !Number.isFinite(dueAtMs) ||
      dueAtMs <= 0 ||
      (payload?.notificationType !== DEADLINE_NOTIF_TYPE &&
        payload?.type !== DEADLINE_NOTIF_TYPE)
    ) {
      warnIfDev(
        `[AlarmMissedTask] Skipping - invalid taskId, dueAtMs, or notification type`
      );
      return;
    }

    if (currentAlarmId) {
      warnIfDev(
        `[AlarmMissedTask] Canceling notifications for alarm ${currentAlarmId}`
      );
      try {
        await Promise.all([
          Notifications.cancelScheduledNotificationAsync(currentAlarmId).catch(
            () => {}
          ),
          notifee.cancelNotification(currentAlarmId).catch(() => {}),
          notifee.cancelNotification(`${currentAlarmId}-display`).catch(() => {}),
        ]);
      } catch (err) {
        warnIfDev(`[AlarmMissedTask] Error canceling notifications: ${err.message}`);
      }
    }

    const task = buildTaskFromPayload(
      taskId,
      payload,
      data?.title || "Task",
      dueAtMs
    );

    if (alarmKind === ALARM_KIND_OVERDUE_SEED) {
      warnIfDev(`[AlarmMissedTask] Processing overdue seed for task ${taskId}`);
      const targetStage =
        typeof payload?.seedTargetStage === "string" &&
        payload.seedTargetStage.trim()
          ? payload.seedTargetStage.trim()
          : "+15m";
      const checkpoint = await getCheckpoint(taskId);
      const currentKey =
        typeof checkpoint?.key === "string" && checkpoint.key
          ? checkpoint.key
          : "due";

      if (compareOverdueStageOrder(currentKey, "due") > 0) {
        warnIfDev(
          `[AlarmMissedTask] Skipping seed - task already past due stage`
        );
        return;
      }

      const targetEntry =
        OVERDUE_CHAIN.find((entry) => entry.key === targetStage) || null;
      if (!targetEntry?.key) {
        warnIfDev(
          `[AlarmMissedTask] Skipping seed - no target entry for stage ${targetStage}`
        );
        return;
      }

      const triggerAt =
        Number.isFinite(targetEntry.delayMs) && targetEntry.delayMs >= 0
          ? dueAtMs + targetEntry.delayMs
          : Date.now() + 1500;

      warnIfDev(
        `[AlarmMissedTask] Setting checkpoint to ${targetEntry.key}, trigger at ${new Date(triggerAt).toISOString()}`
      );
      await setCheckpoint(taskId, targetEntry.key, triggerAt);
      await scheduleNextOverdueAlarm({
        task,
        checkpoint: {
          key: targetEntry.key,
          delayMs: targetEntry.delayMs,
        },
        triggerAt,
        intendedTriggerAtMs: triggerAt,
        deliveryPathHint: "seed_recovery",
      });
      return;
    }

    if (!stageKey) {
      warnIfDev(`[AlarmMissedTask] Skipping - no stage key found in payload`);
      return;
    }

    warnIfDev(
      `[AlarmMissedTask] Advancing checkpoint from ${stageKey} for task ${taskId}`
    );
    const nextCheckpoint = await advanceCheckpoint(taskId, stageKey, dueAtMs);
    if (!nextCheckpoint?.key) {
      warnIfDev(`[AlarmMissedTask] No next checkpoint available`);
      return;
    }

    const chainEntry =
      OVERDUE_CHAIN.find((entry) => entry.key === nextCheckpoint.key) ||
      nextCheckpoint;

    warnIfDev(
      `[AlarmMissedTask] Scheduling next alarm for stage ${chainEntry.key}`
    );
    await scheduleNextOverdueAlarm({
      task,
      checkpoint: {
        key: chainEntry.key,
        delayMs: chainEntry.delayMs,
      },
      triggerAt: nextCheckpoint.triggerAtMs ?? null,
      intendedTriggerAtMs: nextCheckpoint.triggerAtMs ?? null,
      deliveryPathHint: "missed_alarm_recovery",
    });
  } catch (err) {
    warnIfDev("AlarmMissedTask headless task failed:", err);
  }
});
