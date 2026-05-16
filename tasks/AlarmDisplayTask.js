import notifee, { EventType } from "@notifee/react-native";
import { AppRegistry, AppState } from "react-native";
import {
  ACTION_MARK_DONE,
  ACTION_NOT_DONE,
  ALARM_KIND_LEAD_NOTICE,
  bootstrapDeadlineAlarmChannel,
  DEADLINE_NOTIF_TYPE,
  displayAlarmNotification,
  displayLeadNotification,
  resolveNotificationAlarmKind,
  scheduleNextOverdueAlarm,
} from "../utils/deadlineAlarmBackground";
import { OVERDUE_CHAIN } from "../utils/deadlineConstants";
import { warnIfDev } from "../utils/logger";
import {
  cancelNativeAlarmByAlarmId,
  clearPendingAlarmAction,
  forceStopNativeAlarm,
  stopActiveNativeAlarm,
  writeAlarmAction,
} from "../utils/nativeAlarm";
import { advanceCheckpoint, setCheckpoint } from "../utils/taskOverdueState";

function buildTaskFromNotificationData(data = {}, dueAtMs) {
  const subjectLabel =
    typeof data.subjectLabel === "string" && data.subjectLabel.trim()
      ? data.subjectLabel.trim()
      : typeof data.subject === "string" && data.subject.trim()
        ? data.subject.trim()
        : "General";

  return {
    id: data.taskId,
    title:
      typeof data.taskTitle === "string" && data.taskTitle.trim()
        ? data.taskTitle.trim()
        : "Task",
    subject: subjectLabel,
    subjectName: subjectLabel,
    type:
      typeof data.taskType === "string" && data.taskType.trim()
        ? data.taskType.trim()
        : "custom",
    priority:
      typeof data.taskPriority === "string" && data.taskPriority.trim()
        ? data.taskPriority.trim()
        : "medium",
    dueAt: new Date(dueAtMs).toISOString(),
  };
}

function parsePayloadJson(payloadJson) {
  if (typeof payloadJson !== "string" || !payloadJson.trim()) return {};
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}

function resolveAlarmTitle(data = {}, payload = {}) {
  if (typeof data?.title === "string" && data.title.trim()) {
    return data.title.trim();
  }
  if (resolveNotificationAlarmKind(payload) === ALARM_KIND_LEAD_NOTICE) {
    return "Task Reminder";
  }
  if (typeof payload?.taskTitle === "string" && payload.taskTitle.trim()) {
    return `${payload.taskTitle.trim()} is due NOW`;
  }
  return "Task Reminder";
}

function resolveAlarmBody(data = {}, payload = {}) {
  if (typeof data?.body === "string" && data.body.trim()) {
    return data.body.trim();
  }
  const taskTitle =
    typeof payload?.taskTitle === "string" && payload.taskTitle.trim()
      ? payload.taskTitle.trim()
      : "Task";
  const subjectLabel =
    typeof payload?.subjectLabel === "string" && payload.subjectLabel.trim()
      ? payload.subjectLabel.trim()
      : typeof payload?.subject === "string" && payload.subject.trim()
        ? payload.subject.trim()
        : "General";
  if (resolveNotificationAlarmKind(payload) === ALARM_KIND_LEAD_NOTICE) {
    return `"${taskTitle}" (${subjectLabel}) is coming up soon.`;
  }
  // [FIX] Updated body to reflect new button labels
  return `"${taskTitle}" (${subjectLabel}) — tap Open or Not Done.`;
}

function stripDisplaySuffix(id) {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return trimmed.endsWith("-display")
    ? trimmed.slice(0, -"-display".length)
    : trimmed;
}

function resolveBaseAlarmId(data = {}, notificationId = null) {
  if (typeof data?.alarmId === "string" && data.alarmId.trim()) {
    return data.alarmId.trim();
  }
  if (typeof data?.notificationId === "string" && data.notificationId.trim()) {
    return stripDisplaySuffix(data.notificationId);
  }
  return stripDisplaySuffix(notificationId);
}

async function stopNativeAlarmLoop() {
  const stopped = await stopActiveNativeAlarm().catch(() => false);
  if (!stopped) {
    await forceStopNativeAlarm().catch(() => {});
  }
}

async function cancelVisibleAlarmNotifications(baseAlarmId, notificationId) {
  const ids = new Set([
    typeof notificationId === "string" && notificationId
      ? notificationId
      : null,
    typeof baseAlarmId === "string" && baseAlarmId ? baseAlarmId : null,
    typeof baseAlarmId === "string" && baseAlarmId
      ? `${baseAlarmId}-display`
      : null,
  ]);

  await Promise.all(
    [...ids]
      .filter(Boolean)
      .map((id) => notifee.cancelNotification(id).catch(() => {}))
  );
}

AppRegistry.registerHeadlessTask(
  "AlarmDisplayTask",
  () =>
    async (data = {}) => {
      try {
        const payload = parsePayloadJson(data?.payloadJson);
        const notificationType =
          typeof payload?.notificationType === "string" &&
          payload.notificationType.trim()
            ? payload.notificationType.trim()
            : typeof payload?.type === "string" && payload.type.trim()
              ? payload.type.trim()
              : "";
        if (notificationType !== DEADLINE_NOTIF_TYPE) {
          warnIfDev("AlarmDisplayTask: ignoring non-deadline notification");
          return;
        }

        const alarmId =
          typeof data?.alarmId === "string" && data.alarmId.trim()
            ? data.alarmId.trim()
            : typeof payload?.alarmId === "string" && payload.alarmId.trim()
              ? payload.alarmId.trim()
              : typeof payload?.notificationId === "string" &&
                  payload.notificationId.trim()
                ? payload.notificationId.trim()
                : null;
        if (!alarmId) {
          warnIfDev("AlarmDisplayTask: no alarm ID found");
          return;
        }

        const resolvedData = {
          ...payload,
          alarmId,
          notificationId: alarmId,
          taskId:
            typeof payload?.taskId === "string" && payload.taskId.trim()
              ? payload.taskId.trim()
              : alarmId,
        };
        const alarmKind = resolveNotificationAlarmKind(resolvedData);
        const deliveryPath =
          typeof payload?.deliveryPath === "string" ? payload.deliveryPath : "";
        const foregroundServiceOwnsDisplay =
          alarmKind !== ALARM_KIND_LEAD_NOTICE &&
          (deliveryPath === "" ||
            deliveryPath.includes("native_popup") ||
            deliveryPath.includes("native_no_fullscreen_popup"));

        warnIfDev(
          `[AlarmDisplayTask] Running for alarm ${alarmId}, kind: ${alarmKind}, stage: ${payload?.stage}`
        );

        await bootstrapDeadlineAlarmChannel().catch(() => {});

        if (foregroundServiceOwnsDisplay) {
          warnIfDev(
            `[AlarmDisplayTask] Skipping notifee shade for ${alarmId} - foreground service handles display`
          );
          return;
        }

        if (alarmKind === ALARM_KIND_LEAD_NOTICE) {
          warnIfDev(
            `[AlarmDisplayTask] Displaying lead notification for ${alarmId}`
          );
          await displayLeadNotification({
            id: alarmId,
            title: resolveAlarmTitle(data, payload),
            body: resolveAlarmBody(data, payload),
            data: resolvedData,
          });
          return;
        }

        warnIfDev(
          `[AlarmDisplayTask] Displaying alarm notification for ${alarmId}`
        );
        await displayAlarmNotification({
          id: `${alarmId}-display`,
          title: resolveAlarmTitle(data, payload),
          body: resolveAlarmBody(data, payload),
          data: resolvedData,
          isOngoing: true,
        });
      } catch (err) {
        warnIfDev("AlarmDisplayTask headless task failed:", err);
      }
    }
);

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification } = detail;
  const data = notification?.data ?? {};

  if (
    data.type !== DEADLINE_NOTIF_TYPE &&
    data.notificationType !== DEADLINE_NOTIF_TYPE
  ) {
    return;
  }

  if (!data.taskId || type !== EventType.ACTION_PRESS) return;

  const payloadJson = JSON.stringify(data);
  const actionId = detail.pressAction?.id;
  const notificationId =
    typeof notification?.id === "string" && notification.id
      ? notification.id
      : null;
  const baseAlarmId = resolveBaseAlarmId(data, notificationId);
  const alarmKind = resolveNotificationAlarmKind(data);

  if (alarmKind === ALARM_KIND_LEAD_NOTICE) {
    if (notificationId) {
      await notifee.cancelNotification(notificationId).catch(() => {});
    }
    return;
  }

  // [FIX] ACTION_MARK_DONE is now "Open" — just cancel the shade notification
  // and open the app. The modal handles completion. No writeAlarmAction("markdone").
  if (actionId === ACTION_MARK_DONE) {
    await cancelVisibleAlarmNotifications(baseAlarmId, notificationId);
    await stopNativeAlarmLoop();
    // Cancel native alarm so it stops ringing while app opens to modal
    if (baseAlarmId) {
      await cancelNativeAlarmByAlarmId(baseAlarmId).catch(() => {});
    }
    // Write "open" action so TaskManagerScreen knows to show the alarm modal
    if (baseAlarmId) {
      await writeAlarmAction("open", baseAlarmId, payloadJson).catch(() => {});
    }
    return;
  }

  if (actionId === ACTION_NOT_DONE) {
    await cancelVisibleAlarmNotifications(baseAlarmId, notificationId);
    await stopNativeAlarmLoop();
    if (baseAlarmId) {
      await cancelNativeAlarmByAlarmId(baseAlarmId).catch(() => {});
    }
    // A missed-recovery notification may have already written an "open"
    // startup handoff. Clear it before advancing so the old stage does not
    // reopen after Not Done already moved the chain forward.
    await clearPendingAlarmAction().catch(() => {});

    try {
      await bootstrapDeadlineAlarmChannel().catch(() => {});

      const stageKey =
        typeof data.stage === "string" && data.stage ? data.stage : "due";
      const dueAtMs = Number(data.dueAtMs);
      if (!Number.isFinite(dueAtMs) || dueAtMs <= 0) return;

      await setCheckpoint(data.taskId, stageKey, null, {
        handledByShade: true,
      });

      const nextCheckpoint = await advanceCheckpoint(
        data.taskId,
        stageKey,
        dueAtMs,
        { handledByShade: true }
      );
      if (!nextCheckpoint?.key) {
        warnIfDev(
          `[AlarmDisplayTask] Failed to advance checkpoint for task ${data.taskId} at stage ${stageKey}`
        );
        return;
      }

      const chainEntry =
        OVERDUE_CHAIN.find((entry) => entry.key === nextCheckpoint.key) ||
        nextCheckpoint;
      const triggerAt =
        chainEntry.key === "daily"
          ? (nextCheckpoint.triggerAtMs ?? null)
          : Number.isFinite(chainEntry.delayMs)
            ? dueAtMs + chainEntry.delayMs
            : Date.now() + 5 * 60 * 1000;

      await scheduleNextOverdueAlarm({
        task: buildTaskFromNotificationData(data, dueAtMs),
        checkpoint: {
          key: chainEntry.key,
          delayMs: chainEntry.delayMs,
        },
        triggerAt,
      });
      await setCheckpoint(data.taskId, chainEntry.key, triggerAt, {
        handledByShade: true,
      });

      // [FIX] If app is foreground, open the modal for the next stage
      // by writing an "open" action that TaskManagerScreen will pick up.
      // If backgrounded, the next alarm fires naturally — no need to foreground.
      if (AppState.currentState === "active" && baseAlarmId) {
        await writeAlarmAction("open", baseAlarmId, payloadJson).catch(
          () => {}
        );
      }
    } catch (err) {
      warnIfDev("notifee background NOT_DONE chain advance failed:", err);
    }
    return;
  }

  // Default tap — open app to modal
  if (baseAlarmId) {
    await writeAlarmAction("default", baseAlarmId, payloadJson).catch(() => {});
  }
});
