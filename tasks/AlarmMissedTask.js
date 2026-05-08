import notifee from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import { AppRegistry } from "react-native";
import {
  bootstrapDeadlineAlarmChannel,
  DEADLINE_NOTIF_TYPE,
  scheduleNextOverdueAlarm,
} from "../utils/deadlineAlarmBackground";
import { OVERDUE_CHAIN } from "../utils/deadlineConstants";
import { warnIfDev } from "../utils/logger";
import { advanceCheckpoint } from "../utils/taskOverdueState";

const AUTO_MISS_DELAY_MS = 5 * 60 * 1000;

function toStageKey(payload = {}) {
  if (typeof payload?.stage === "string" && payload.stage.trim()) {
    return payload.stage.trim();
  }
  if (typeof payload?.threshold === "string" && payload.threshold.trim()) {
    return payload.threshold.trim();
  }
  return null;
}

function buildTaskFromPayload(taskId, payload = {}, fallbackTitle = "Task", dueAtMs) {
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

    const payload = data?.payloadJson ? JSON.parse(data.payloadJson) : {};
    const taskId = payload?.taskId || data?.alarmId || "";
    const stageKey = toStageKey(payload);
    const dueAtMs = Number(payload?.dueAtMs ?? payload?.dueDateMs);
    const currentAlarmId =
      typeof data?.alarmId === "string" && data.alarmId ? data.alarmId : null;

    if (
      !taskId ||
      !stageKey ||
      !Number.isFinite(dueAtMs) ||
      dueAtMs <= 0 ||
      (payload?.notificationType !== DEADLINE_NOTIF_TYPE &&
        payload?.type !== DEADLINE_NOTIF_TYPE)
    ) {
      return;
    }

    if (currentAlarmId) {
      await Promise.all([
        Notifications.cancelScheduledNotificationAsync(currentAlarmId).catch(
          () => {}
        ),
        notifee.cancelNotification(currentAlarmId).catch(() => {}),
        notifee.cancelNotification(`${currentAlarmId}-display`).catch(
          () => {}
        ),
      ]);
    }

    const nextCheckpoint = await advanceCheckpoint(taskId, stageKey, dueAtMs);
    if (!nextCheckpoint?.key) return;

    const task = buildTaskFromPayload(
      taskId,
      payload,
      data?.title || "Task",
      dueAtMs
    );
    const chainEntry =
      OVERDUE_CHAIN.find((entry) => entry.key === nextCheckpoint.key) ||
      nextCheckpoint;
    const triggerAt =
      chainEntry.key === "daily"
        ? nextCheckpoint.triggerAtMs ?? null
        : Number.isFinite(chainEntry.delayMs)
          ? dueAtMs + chainEntry.delayMs
          : Date.now() + AUTO_MISS_DELAY_MS;

    await scheduleNextOverdueAlarm({
      task,
      checkpoint: {
        key: chainEntry.key,
        delayMs: chainEntry.delayMs,
      },
      triggerAt,
    });
  } catch (err) {
    warnIfDev("AlarmMissedTask headless task failed:", err);
  }
});
