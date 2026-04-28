const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function asValidDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function plural(value, singular) {
  return value === 1 ? `${value} ${singular}` : `${value} ${singular}s`;
}

function buildParts(totalMinutes, style = "short") {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (style === "long") {
    const parts = [];
    if (days > 0) parts.push(plural(days, "day"));
    if (hours > 0) parts.push(plural(hours, "hour"));
    if ((days === 0 && hours === 0) || minutes > 0) {
      parts.push(plural(minutes, "minute"));
    }
    return parts.slice(0, 2).join(" ");
  }
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if ((days === 0 && hours === 0) || minutes > 0) {
    parts.push(`${minutes}m`);
  }
  return parts.slice(0, 2).join(" ");
}

export function formatDeadlineCountdown(
  dueDateInput,
  nowInput = new Date(),
  options = {}
) {
  const dueDate = asValidDate(dueDateInput);
  const now = asValidDate(nowInput) || new Date();
  const style = options?.style === "long" ? "long" : "short";
  if (!dueDate) return "No deadline set";
  const diffMs = dueDate.getTime() - now.getTime();
  if (Math.abs(diffMs) < MINUTE_MS) {
    return "Due now";
  }
  const absMs = Math.abs(diffMs);
  const totalMinutes = Math.max(1, Math.ceil(absMs / MINUTE_MS));
  const parts = buildParts(totalMinutes, style);
  if (diffMs > 0) {
    return `${parts} left`;
  }
  return `Overdue by ${parts}`;
}

export function getUrgencyMeta(deadlineMs, nowMs = Date.now()) {
  const deadline = asValidDate(deadlineMs);
  const now = asValidDate(nowMs) || new Date();

  if (!deadline) {
    return { label: "No deadline", color: "#64748b", severity: "none" };
  }

  const diffMs = deadline.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { label: "Overdue", color: "#ef4444", severity: "overdue" };
  }

  if (diffMs < DAY_MS) {
    return { label: "Critical", color: "#ef4444", severity: "critical" };
  }

  if (diffMs < 3 * DAY_MS) {
    return { label: "Urgent", color: "#f59e0b", severity: "urgent" };
  }

  if (diffMs < 7 * DAY_MS) {
    return { label: "Soon", color: "#0ea5e9", severity: "soon" };
  }

  return { label: "Upcoming", color: "#10b981", severity: "upcoming" };
}
