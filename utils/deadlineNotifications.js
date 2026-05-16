import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { OVERDUE_CHAIN, FOREGROUND_THRESHOLDS } from "./deadlineConstants";
import { resolveDeadlineAlarmStage } from "./deadlineAlarmStage";
import { warnIfDev } from "./logger";
import {
  cancelNativeAlarmByScheduledId,
  toNativeAlarmScheduledId,
} from "./nativeAlarm";
import { buildDeadlineNotificationId, buildNotificationId } from "./notificationIds";

let notifee = null;
try {
  notifee = require("@notifee/react-native").default;
} catch (_error) {}

export const DEADLINE_NOTIF_TYPE = "deadline_alarm";
export const DEADLINE_ACTION_OPEN = "open_deadline_alarm";
export const DEADLINE_ACTION_OPEN_LEGACY = "mark_done_deadline_alarm";
export const DEADLINE_ACTION_NOT_DONE = "not_done_deadline_alarm";

const LEAD_STAGE_KEYS = FOREGROUND_THRESHOLDS.map((threshold) => threshold.key)
  .filter(Boolean)
  .filter((key) => key !== "due");
const OVERDUE_STAGE_KEYS = Array.from(
  new Set(
    OVERDUE_CHAIN.map((entry) => entry?.key).filter(
      (key) => typeof key === "string" && key
    )
  )
);
const FOLLOWUP_STAGE_KEYS = ["15m", "60m", "+15m"];

function pushId(target, value) {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (!normalized) return;
  target.add(normalized);
}

function addDisplayVariant(target, id) {
  pushId(target, id);
  pushId(target, `${id}-display`);
}

export function isDeadlineNotificationData(data = {}) {
  const type =
    typeof data?.type === "string" ? data.type.trim().toLowerCase() : "";
  const notificationType =
    typeof data?.notificationType === "string"
      ? data.notificationType.trim().toLowerCase()
      : "";
  return (
    type === DEADLINE_NOTIF_TYPE ||
    type === "deadline" ||
    notificationType === DEADLINE_NOTIF_TYPE ||
    notificationType === "deadline"
  );
}

export function isDeadlineManagedNotificationId(value) {
  if (typeof value !== "string") return false;
  return (
    value.includes(":deadline-lead:") ||
    value.includes(":deadline-due:") ||
    value.includes(":deadline-overdue:") ||
    value.includes(":deadline-followup:") ||
    value.includes(":deadline-custom-reminder:") ||
    value.includes(":auto-overdue:")
  );
}

export function normalizeDeadlineAlarmAction(value) {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized || normalized === "default") return "open";
  if (
    normalized === DEADLINE_ACTION_OPEN ||
    normalized === DEADLINE_ACTION_OPEN_LEGACY ||
    normalized === "open"
  ) {
    return "open";
  }
  if (
    normalized === DEADLINE_ACTION_NOT_DONE ||
    normalized === "not_done" ||
    normalized === "notdone"
  ) {
    return "notdone";
  }
  if (normalized === "done" || normalized === "markdone") {
    return "markdone";
  }
  return "open";
}

export function resolveDeadlineNotificationSourceId({
  notificationId = null,
  data = {},
} = {}) {
  if (typeof notificationId === "string" && notificationId.trim()) {
    return notificationId.trim();
  }
  const candidates = [
    data?.notificationId,
    data?.alarmId,
    data?.taskId && resolveDeadlineAlarmStage(data)
      ? `${data.taskId}:${resolveDeadlineAlarmStage(data)}`
      : null,
    data?.taskId,
  ];
  const match = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim()
  );
  return match ? match.trim() : null;
}

export function buildDeadlineRouteParams(
  data = {},
  { action = "open", nativeHandoff = true, sourceId = null } = {}
) {
  const taskId =
    typeof data?.taskId === "string" && data.taskId.trim()
      ? data.taskId.trim()
      : null;
  if (!taskId) return null;

  const dueAtMs = Number(data?.dueAtMs);
  const displayStage =
    typeof data?.displayStage === "string" && data.displayStage.trim()
      ? data.displayStage.trim()
      : null;
  const recoveryReason =
    typeof data?.recoveryReason === "string" && data.recoveryReason.trim()
      ? data.recoveryReason.trim()
      : null;
  const alarmStage = resolveDeadlineAlarmStage(data) || displayStage;
  const normalizedAction = normalizeDeadlineAlarmAction(action);

  return {
    focusTaskId: taskId,
    showAlarm: "1",
    alarmAction: normalizedAction,
    family: "deadline",
    ...(nativeHandoff ? { nativeHandoff: "1" } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(alarmStage ? { alarmStage } : {}),
    ...(displayStage ? { displayStage } : {}),
    ...(recoveryReason ? { recoveryReason } : {}),
    ...(Number.isFinite(dueAtMs) && dueAtMs > 0
      ? { dueAtMs: String(dueAtMs) }
      : {}),
  };
}

export function buildDeadlineTaskNotificationIds(
  taskId,
  {
    includeLead = true,
    includeDue = true,
    includeOverdue = true,
    includeFollowup = true,
    includeAutoOverdue = true,
    includeCustomReminder = true,
    includeDisplay = true,
    thresholdKey = null,
    extraIds = [],
  } = {}
) {
  const ids = new Set();
  if (!taskId) return ids;

  if (includeLead) {
    for (const key of LEAD_STAGE_KEYS) {
      const id = buildDeadlineNotificationId(taskId, key);
      includeDisplay ? addDisplayVariant(ids, id) : pushId(ids, id);
    }
  }

  if (includeDue) {
    const id = buildNotificationId("deadline-due", taskId, "due");
    includeDisplay ? addDisplayVariant(ids, id) : pushId(ids, id);
  }

  if (includeOverdue) {
    for (const key of OVERDUE_STAGE_KEYS) {
      const id = buildDeadlineNotificationId(taskId, key);
      includeDisplay ? addDisplayVariant(ids, id) : pushId(ids, id);
    }
  }

  if (includeFollowup) {
    for (const key of FOLLOWUP_STAGE_KEYS) {
      pushId(ids, buildNotificationId("deadline-followup", taskId, key));
    }
  }

  if (includeAutoOverdue) {
    const id = buildNotificationId("auto-overdue", taskId, "open");
    includeDisplay ? addDisplayVariant(ids, id) : pushId(ids, id);
  }

  if (includeCustomReminder) {
    pushId(
      ids,
      buildNotificationId("deadline-custom-reminder", taskId, "user")
    );
  }

  if (thresholdKey) {
    const id = buildDeadlineNotificationId(taskId, thresholdKey);
    includeDisplay ? addDisplayVariant(ids, id) : pushId(ids, id);
  }

  for (const id of extraIds) {
    if (includeDisplay) {
      addDisplayVariant(ids, id);
    } else {
      pushId(ids, id);
    }
  }

  return ids;
}

export function buildDeadlinePresentationIds(
  taskId,
  { thresholdKey = null, extraIds = [] } = {}
) {
  const ids = new Set();
  if (!taskId) return ids;

  addDisplayVariant(ids, buildNotificationId("deadline-due", taskId, "due"));

  for (const key of OVERDUE_STAGE_KEYS) {
    addDisplayVariant(ids, buildDeadlineNotificationId(taskId, key));
  }

  if (thresholdKey) {
    addDisplayVariant(ids, buildDeadlineNotificationId(taskId, thresholdKey));
  }

  for (const id of extraIds) {
    addDisplayVariant(ids, id);
  }

  return ids;
}

export async function dismissDeadlinePresentations(taskId, options = {}) {
  const ids = Array.from(buildDeadlinePresentationIds(taskId, options));
  if (!ids.length) return [];

  await Promise.all(
    ids.map(async (id) => {
      try {
        await notifee?.cancelNotification?.(id);
      } catch (_error) {}
      try {
        await Notifications.dismissNotificationAsync?.(id);
      } catch (_error) {}
    })
  );

  return ids;
}

export async function cancelDeadlineNotifications(taskId, options = {}) {
  const {
    legacyExpoCompat = true,
    includeDisplay = true,
    thresholdKey = null,
    extraIds = [],
  } = options;

  const ids = Array.from(
    buildDeadlineTaskNotificationIds(taskId, {
      ...options,
      includeDisplay,
      thresholdKey,
      extraIds,
    })
  );
  if (!ids.length) return [];

  await Promise.all(
    ids.map(async (id) => {
      try {
        await cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(id));
      } catch (_error) {}

      try {
        await notifee?.cancelNotification?.(id);
      } catch (_error) {}

      const shouldCancelExpo =
        legacyExpoCompat || Platform.OS !== "android" || !isDeadlineManagedNotificationId(id);
      if (!shouldCancelExpo) return;

      try {
        await Notifications.cancelScheduledNotificationAsync?.(id);
      } catch (_error) {}
      try {
        await Notifications.dismissNotificationAsync?.(id);
      } catch (_error) {}
    })
  );

  return ids;
}

export function logDeadlineFlow(event, details = {}) {
  warnIfDev(`[deadlineFlow] ${event}`, details);
}
