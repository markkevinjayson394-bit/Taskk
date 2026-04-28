import { THRESHOLDS } from "./deadlineConstants";

export const NOTIFICATION_ID_PREFIX = "ctu-notif";

const DEADLINE_THRESHOLD_TO_MINUTES = Object.fromEntries(
  THRESHOLDS.filter((t) => t.key !== "due").map((t) => [
    t.key,
    `${Math.round(t.ms / 60000)}m`,
  ])
);

function sanitizeNotificationIdPart(value, fallback = "item") {
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  const normalized = text.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^-|-$/g, "") || fallback;
}

export function buildNotificationId(...parts) {
  return [
    NOTIFICATION_ID_PREFIX,
    ...parts.map((part) => sanitizeNotificationIdPart(part)),
  ]
    .filter(Boolean)
    .join(":");
}

export function isManagedNotificationId(value) {
  return (
    typeof value === "string" && value.startsWith(`${NOTIFICATION_ID_PREFIX}:`)
  );
}

export function buildManagedNotificationData(identifier, data = {}) {
  const extra = data && typeof data === "object" ? data : {};
  return {
    ...extra,
    notificationId: identifier,
    notificationNamespace: NOTIFICATION_ID_PREFIX,
  };
}

export function buildDeadlineNotificationId(taskId, thresholdKey) {
  if (thresholdKey === "due") {
    return buildNotificationId("deadline-due", taskId, "due");
  }

  const minutesLabel = DEADLINE_THRESHOLD_TO_MINUTES[thresholdKey];
  if (minutesLabel) {
    return buildNotificationId("deadline-lead", taskId, minutesLabel);
  }

  return buildNotificationId("deadline", taskId, thresholdKey);
}
