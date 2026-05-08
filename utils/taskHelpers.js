import { parseDueDate, resolveTaskDueDate } from "./academicTaskModel";

export function buildQuickDueOptions(baseDate = new Date()) {
  const now = parseDueDate(baseDate) || new Date();
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight <= now) {
    tonight.setDate(tonight.getDate() + 1);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  nextWeek.setHours(18, 0, 0, 0);

  const isTonightActuallyTomorrow =
    tonight.getFullYear() !== now.getFullYear() ||
    tonight.getMonth() !== now.getMonth() ||
    tonight.getDate() !== now.getDate();

  return [
    {
      key: "tonight",
      label: isTonightActuallyTomorrow ? "Tomorrow 8 PM" : "Tonight 8 PM",
      dueAt: tonight,
    },
    {
      key: "tomorrow",
      label: "Tomorrow 6 PM",
      dueAt: tomorrow,
    },
    {
      key: "nextWeek",
      label: "Next Week",
      dueAt: nextWeek,
    },
  ];
}

export function getDefaultDueAt() {
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(18, 0, 0, 0);
  return due;
}

export function getQuickCreateDueAt(filter, now = new Date()) {
  const options = buildQuickDueOptions(now);
  if (filter === "Today") {
    return options[0]?.dueAt || getDefaultDueAt();
  }
  if (filter === "Overdue") {
    return options.find((o) => o.key === "tomorrow")?.dueAt || getDefaultDueAt();
  }
  return getDefaultDueAt();
}

export function getQuickSnoozePlan(task, now = new Date()) {
  const due = resolveTaskDueDate(task);
  if (!due) {
    return {
      label: "Tomorrow",
      dueAt: buildQuickDueOptions(now)[1]?.dueAt || getDefaultDueAt(),
    };
  }

  const hoursUntilDue = (due.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntilDue <= 2) {
    const next = new Date(Math.max(due.getTime(), now.getTime()));
    next.setHours(next.getHours() + 1);
    return { label: "+1h", dueAt: next };
  }

  const next = new Date(due);
  next.setDate(next.getDate() + 1);
  return { label: "+1d", dueAt: next };
}

export function normalizePendingUpdates(queue = []) {
  const map = new Map();
  for (const item of queue) {
    if (!item?.id || !item?.action) continue;
    map.set(`${item.action}\x00${item.id}`, {
      id: item.id,
      action: item.action,
      queuedAt: item.queuedAt || new Date().toISOString(),
    });
  }
  return Array.from(map.values());
}
