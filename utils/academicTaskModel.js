import { warnIfDev } from "./logger";
import { clampText } from "./parsing";

const TASK_TYPES = [
  "assignment",
  "quiz",
  "exam",
  "project",
  "review",
  "custom",
];

const TASK_PRIORITIES = ["high", "medium", "low", "none"];
const REMINDER_MODES = ["default", "custom", "persistent"];
const TASK_STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
};

const PRIORITY_LEVEL_BY_LABEL = {
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const REMINDER_LEAD_MINUTES_CAP = 7 * 24 * 60;
const COMPLETION_META_ALLOWLIST = new Set(["notes", "tags"]);

export function normalizeTaskType(value) {
  const next = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TASK_TYPES.includes(next) ? next : "custom";
}

export function normalizeTaskPriority(value) {
  const next = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TASK_PRIORITIES.includes(next) ? next : "medium";
}

export function getTaskPriorityLevel(priority) {
  const normalized = normalizeTaskPriority(priority);
  return PRIORITY_LEVEL_BY_LABEL[normalized] ?? PRIORITY_LEVEL_BY_LABEL.medium;
}

export function normalizeTaskStatus(value, completed = false) {
  if (completed) return TASK_STATUS.DONE;
  const next = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (Object.values(TASK_STATUS).includes(next)) {
    return next;
  }
  return TASK_STATUS.TODO;
}

function normalizeCompletedFlag(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const next = value.trim().toLowerCase();
    if (next === "true" || next === "1" || next === "yes") return true;
    return false;
  }

  return false;
}

export function normalizeSubjectName(value) {
  const clean = clampText(typeof value === "string" ? value.trim() : "", 80);
  return clean || "General";
}

export function buildSubjectIdFromName(value) {
  const name = normalizeSubjectName(value);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug ? `subject_${slug}` : "subject_general";
}

export function normalizeSubjectId(value) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

export function normalizeTaskDateInput(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const next = value.toDate();
    return Number.isNaN(next?.getTime?.()) ? null : next;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const next = new Date(value);
    return Number.isNaN(next.getTime()) ? null : next;
  }
  if (typeof value?.seconds === "number") {
    const next = new Date(value.seconds * 1000);
    return Number.isNaN(next.getTime()) ? null : next;
  }
  return null;
}

export function parseDueDate(value) {
  return normalizeTaskDateInput(value);
}

export function resolveTaskDueDate(task = {}) {
  const raw = task?.dueAt ?? task?.due ?? task?.dueDate ?? null;
  if (!raw) return null;

  // Handle Firestore Timestamp objects ({ toDate: Function })
  if (typeof raw?.toDate === "function") {
    try {
      const d = raw.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  // Handle plain numeric milliseconds
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? new Date(raw) : null;
  }

  // Handle ISO string or any Date-parseable string
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeEstimatedMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.min(parsed, REMINDER_LEAD_MINUTES_CAP);
}

function normalizeReminderLeadMinutes(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value.map((item) => Math.round(Number(item)));
  const droppedOverCap = normalized.filter(
    (item) => Number.isFinite(item) && item > REMINDER_LEAD_MINUTES_CAP
  ).length;
  if (droppedOverCap > 0) {
    warnIfDev(
      "normalizeReminderLeadMinutes: dropped reminder lead minutes above cap:",
      { droppedCount: droppedOverCap, capMinutes: REMINDER_LEAD_MINUTES_CAP }
    );
  }
  return normalized
    .filter(
      (item) =>
        Number.isFinite(item) && item > 0 && item <= REMINDER_LEAD_MINUTES_CAP
    )
    .slice(0, 8);
}

export function normalizeReminderPolicy(value) {
  if (!value || typeof value !== "object") return null;

  const modeInput =
    typeof value.mode === "string" ? value.mode.trim().toLowerCase() : "";
  const mode = REMINDER_MODES.includes(modeInput) ? modeInput : "default";
  const typeInput =
    typeof value.type === "string" ? value.type.trim().toLowerCase() : "";
  const type = typeInput === "at_creation" ? typeInput : null;

  const leadMinutes = normalizeReminderLeadMinutes(value.leadMinutes);
  const acknowledgeRequired = Boolean(value.acknowledgeRequired);
  const dailyOverdue = Boolean(value.dailyOverdue);

  const hasCustomFields =
    leadMinutes.length > 0 ||
    acknowledgeRequired ||
    dailyOverdue ||
    type === "at_creation";
  if (!hasCustomFields && mode === "default") {
    return null;
  }

  const normalized = {
    mode,
    leadMinutes,
    acknowledgeRequired,
    dailyOverdue,
  };
  if (type === "at_creation") {
    normalized.type = type;
  }
  return normalized;
}

export function normalizeSubtasks(subtasks = []) {
  if (!Array.isArray(subtasks)) return [];
  return subtasks
    .slice(0, 50)
    .map((item, index) => {
      const title = clampText(
        typeof item?.title === "string" ? item.title.trim() : "",
        120
      );
      if (!title) return null;
      return {
        id:
          typeof item?.id === "string" && item.id.trim()
            ? item.id.trim().slice(0, 120)
            : `subtask_${index + 1}`,
        title,
        done: Boolean(item?.done),
      };
    })
    .filter(Boolean);
}

export function normalizeMilestones(milestones = []) {
  if (!Array.isArray(milestones)) return [];
  return milestones
    .map((item) => clampText(typeof item === "string" ? item.trim() : "", 140))
    .filter(Boolean)
    .slice(0, 30);
}

export function isTaskCompleted(task = {}) {
  if (task?.completed === true) return true;
  const status = String(task?.status || "")
    .trim()
    .toLowerCase();
  return status === TASK_STATUS.DONE;
}

export function buildTaskCreateData(input = {}, meta = {}) {
  const title = clampText(
    typeof input.title === "string" ? input.title.trim() : "",
    160
  );
  const subjectName = normalizeSubjectName(input.subjectName ?? input.subject);
  const priority = normalizeTaskPriority(input.priority);
  const completed = normalizeCompletedFlag(input.completed);
  const status = normalizeTaskStatus(input.status, completed);
  const dueAt = normalizeTaskDateInput(input.dueAt);
  const startedAt = normalizeTaskDateInput(input.startedAt);
  const completedAtInput = normalizeTaskDateInput(input.completedAt);
  const customReminderAt = normalizeTaskDateInput(input.customReminderAt);
  const estimatedMinutes = normalizeEstimatedMinutes(input.estimatedMinutes);
  const reminderPolicy = normalizeReminderPolicy(input.reminderPolicy);

  const data = {
    userId: typeof input.userId === "string" ? input.userId : "",
    title,
    // Legacy `subject` preserved for existing UI compatibility.
    subject: subjectName,
    subjectName,
    subjectId: normalizeSubjectId(input.subjectId),
    dueAt: dueAt ?? null,
    completed: status === TASK_STATUS.DONE,
    status,
    type: normalizeTaskType(input.type),
    priority,
    priorityLevel: getTaskPriorityLevel(priority),
    subtasks: normalizeSubtasks(input.subtasks),
    milestones: normalizeMilestones(input.milestones),
    schemaVersion:
      Number.isInteger(input.schemaVersion) && input.schemaVersion > 0
        ? input.schemaVersion
        : 2,
  };

  if (estimatedMinutes !== null) {
    data.estimatedMinutes = estimatedMinutes;
  }
  if (customReminderAt) {
    data.customReminderAt = customReminderAt;
  }
  if (reminderPolicy) {
    data.reminderPolicy = reminderPolicy;
  }
  if (startedAt) {
    data.startedAt = startedAt;
  }
  if (completedAtInput) {
    data.completedAt = completedAtInput;
  } else if (status === TASK_STATUS.DONE) {
    data.completedAt = new Date();
  }

  if (typeof input.source === "string" && input.source.trim()) {
    data.source = input.source.trim();
  }
  if (typeof input.plannerRef === "string" && input.plannerRef.trim()) {
    data.plannerRef = input.plannerRef.trim();
  }
  if (typeof input.plannerBucket === "string" && input.plannerBucket.trim()) {
    data.plannerBucket = input.plannerBucket.trim();
  }
  if (typeof input.plannerArchived === "boolean") {
    data.plannerArchived = input.plannerArchived;
  }

  return { ...data, ...meta };
}

export function buildTaskCompletionUpdate(completedAt = new Date(), meta = {}) {
  const normalizedCompletedAt =
    normalizeTaskDateInput(completedAt) || new Date();
  const startedAt = normalizeTaskDateInput(meta?.startedAt);
  const estimatedMinutes = normalizeEstimatedMinutes(meta?.estimatedMinutes);
  const reminderPolicy = normalizeReminderPolicy(meta?.reminderPolicy);
  const {
    startedAt: _ignoredStartedAt,
    estimatedMinutes: _ignoredEstimatedMinutes,
    reminderPolicy: _ignoredReminderPolicy,
    ...restMeta
  } = meta || {};
  const safeRestMeta = Object.fromEntries(
    Object.entries(restMeta).filter(([key]) =>
      COMPLETION_META_ALLOWLIST.has(key)
    )
  );

  return {
    completed: true,
    status: TASK_STATUS.DONE,
    completedAt: normalizedCompletedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(estimatedMinutes !== null ? { estimatedMinutes } : {}),
    ...(reminderPolicy ? { reminderPolicy } : {}),
    ...safeRestMeta,
  };
}

export {
  TASK_PRIORITIES,
  TASK_PRIORITIES as TASK_PRIORITY_LABELS,
  TASK_STATUS,
  TASK_TYPES
};

