import notifee from "@notifee/react-native";
import { AppRegistry } from "react-native";
import {
  DEADLINE_NOTIF_TYPE,
  displayAlarmNotification,
  ACTION_MARK_DONE,
  ACTION_NOT_DONE,
} from "../utils/deadlineAlarmBackground";
import { writeAlarmAction } from "../utils/nativeAlarm";
import { buildNotificationId } from "../utils/notificationIds";

// Headless task called by AlarmHeadlessTaskService when the alarm fires.
// AlarmForegroundService already owns audio, vibration, and wake lock.
// This task posts the notifee full-screen intent notification which is:
// - Persistent (ongoing: true, autoCancel: false - cannot be swiped away)
// - Plays ctu_alarm sound
// - Vibrates with the alarm pattern [0, 400, 200, 400, 200, 800]
// - Shows Done / Not Done action buttons directly in the notification shade
//   so the user can respond without opening the app
AppRegistry.registerHeadlessTask("AlarmDisplayTask", () => async (data) => {
  if (!data?.alarmId) return;

  let payload = {};
  try {
    payload = JSON.parse(data.payloadJson || "{}");
  } catch (_) {}

  const taskId = payload.taskId ?? data.alarmId;

  const notifId =
    typeof data.alarmId === "string" && data.alarmId
      ? data.alarmId
      : buildNotificationId("deadline-due", taskId, "due");

  // Determine if this is an overdue alarm so we can tailor the body text.
  // isOverdueAlarm is set in buildDeadlineAlarmData for all overdue checkpoints.
  const isOverdue = Boolean(payload.isOverdueAlarm);
  const taskTitle =
    typeof payload.taskTitle === "string" && payload.taskTitle.trim()
      ? payload.taskTitle.trim()
      : data.title || "Task";
  const subjectLabel =
    typeof payload.subjectLabel === "string" && payload.subjectLabel.trim()
      ? payload.subjectLabel.trim()
      : typeof payload.subject === "string" && payload.subject.trim()
        ? payload.subject.trim()
        : "";

  // Build a richer body for overdue alarms so the shade notification text
  // matches what DeadlineAlarmModal shows.
  let resolvedBody = data.body || "";
  if (isOverdue && taskTitle) {
    const dueAtMs = Number(payload.dueAtMs ?? data.triggerAtMs);
    if (Number.isFinite(dueAtMs) && dueAtMs > 0) {
      const dueDate = new Date(dueAtMs);
      const dueLabel = dueDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const subjectPart = subjectLabel ? ` (${subjectLabel})` : "";
      resolvedBody = `"${taskTitle}"${subjectPart} is overdue since ${dueLabel}. Tap Done or Not Done - alarm will not stop until you respond.`;
    }
  }

  await displayAlarmNotification({
    id: notifId,
    title: data.title || (isOverdue ? `🔴 Overdue: ${taskTitle}` : "Task due now"),
    body: resolvedBody || data.body || "",
    data: {
      ...payload,
      alarmId: data.alarmId,
      type: DEADLINE_NOTIF_TYPE,
      notificationType: DEADLINE_NOTIF_TYPE,
      taskId,
      taskTitle,
      dueAtMs: payload.dueAtMs ?? data.triggerAtMs,
      dueDate: payload.dueDate ?? payload.dueAt ?? null,
      stage: payload.stage ?? "due",
    },
    // All alarms fired via this headless task are persistent - the user must
    // respond via Done or Not Done; the notification cannot be swiped away.
    isOngoing: true,
  });
});

// Background notifee event handler - fires when the app is killed/backgrounded
// and the user interacts with a notifee notification from the shade.
// Done / Not Done actions cancel the notification immediately so the shade
// clears without requiring the app to open.
// Ongoing deadline alarms intentionally ignore DISMISSED so the system cannot
// silently clear them before the user responds.
// DeadlineAlarmModal handles all chain logic once the app opens.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification } = detail;
  const data = notification?.data ?? {};

  if (
    data.type !== DEADLINE_NOTIF_TYPE &&
    data.notificationType !== DEADLINE_NOTIF_TYPE
  ) return;

  if (!data.taskId) return;

  if (type === notifee.EventType.ACTION_PRESS) {
    await notifee.cancelNotification(notification.id);

    const actionId = detail.pressAction?.id;
    const pendingAction =
      actionId === ACTION_MARK_DONE ? "markdone" :
      actionId === ACTION_NOT_DONE  ? "notdone"  : null;

    if (pendingAction) {
      await writeAlarmAction(
        pendingAction,
        data.taskId,
        JSON.stringify(data)
      ).catch(() => {});
    }
  }
});
