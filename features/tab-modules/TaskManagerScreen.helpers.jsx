// TaskManagerScreen.helpers.js
// Extracted helper functions and constants from TaskManagerScreen.js

import { Timestamp } from "firebase/firestore";
import { calculateDailyWorkload } from "@/utils/workloadCalculator";
import * as AcademicTaskModel from "../../utils/academicTaskModel";
import {
    parseDueDate,
    resolveTaskDueDate,
} from "../../utils/academicTaskModel";
import {
    cancelDeadlineAlarms,
    scheduleDeadlineAlarms,
} from "../../utils/deadlineAlarmBackground";
import { warnIfDev } from "../../utils/logger";
import {
    prepareQueuedTaskPayloadForFirestore,
    readOfflineCreateQueue,
    writeOfflineCreateQueue,
} from "../../utils/offlineTaskQueue";

// Simple LRU cache for parsed subject catalogs
class LRUCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

const subjectCatalogCache = new LRUCache(50);

const normalizeSubjectName =
  typeof AcademicTaskModel.normalizeSubjectName === "function"
    ? AcademicTaskModel.normalizeSubjectName
    : (value = "") => {
        const text = typeof value === "string" ? value.trim() : "";
        return text || "General";
      };

const buildSubjectIdFromName =
  typeof AcademicTaskModel.buildSubjectIdFromName === "function"
    ? AcademicTaskModel.buildSubjectIdFromName
    : (value) => {
        const name = normalizeSubjectName(value);
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 48);
        return slug ? `subject_${slug}` : "subject_general";
      };

export const PENDING_UPDATES_KEY = (uid) => `pending_complete_${uid}`;
export const SUBJECT_CATALOG_KEY = (uid) => `subject_catalog_${uid}`;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const PAGE_SIZE = 12;

// ---
// Offline create queue helpers (mirrors the plannerStorage pattern)
// ---

export async function readCreateQueue(uid) {
  const queue = await readOfflineCreateQueue(uid);
  return Array.isArray(queue) ? queue : [];
}

export async function writeCreateQueue(uid, queue) {
  return writeOfflineCreateQueue(uid, queue);
}

function convertDatesToTimestamps(payload = {}) {
  const DATE_FIELDS = [
    "dueAt",
    "createdAt",
    "completedAt",
    "updatedAt",
    "startedAt",
    "customReminderAt",
  ];
  const result = { ...payload };
  DATE_FIELDS.forEach((field) => {
    const val = result[field];
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      result[field] = Timestamp.fromDate(val);
    } else if (val === undefined) {
      delete result[field];
    }
  });
  return result;
}

export async function flushCreateQueue(uid, flushFn, soundSettings = {}) {
  const queue = await readOfflineCreateQueue(uid);
  if (!queue.length) return { flushed: 0, remaining: [] };
  const remaining = [];
  let flushed = 0;
  for (const item of queue) {
    // Convert plain Dates → Firestore Timestamps before writing
    const payload = convertDatesToTimestamps(
      prepareQueuedTaskPayloadForFirestore(item.payload)
    );
    try {
      const docRef = await flushFn({ ...item, payload });
      flushed++;
      await cancelDeadlineAlarms({ id: item.id }).catch(() => {});
      if (docRef?.id) {
        scheduleDeadlineAlarms(
          { id: docRef.id, ...payload },
          soundSettings
        ).catch((_e) => {});
      }
    } catch (err) {
      warnIfDev("TaskManagerScreen: failed to flush create queue item:", err);
      remaining.push(item);
    }
  }
  await writeOfflineCreateQueue(uid, remaining);
  return { flushed, remaining };
}
export const GENERAL_SUBJECT = "General";
export const GENERAL_SUBJECT_ID = "subject_general";
export const DEFAULT_MANUAL_TASK_REMINDER_POLICY = {
  mode: "persistent",
  acknowledgeRequired: true,
  dailyOverdue: true,
};
export const GENERAL_SUBJECT_OPTION = {
  id: GENERAL_SUBJECT_ID,
  name: GENERAL_SUBJECT,
  source: "default",
};
export const SCHEDULE_SUBJECT_SOURCES = new Set(["schedule_admin", "schedule"]);
export const SUBJECT_FILTER_ALL_ID = "all_subjects";
export const SORT_OPTIONS = [
  { key: "dueSoon", label: "Due Soon" },
  { key: "priority", label: "Priority" },
  { key: "subject", label: "Subject" },
];
export const AUTO_REFRESH_COOLDOWN_MS = 10 * 1000;

// Two explicit rows of 3 - guarantees labels are always visible
export const TYPE_ROWS = [
  ["assignment", "quiz", "exam"],
  ["project", "review", "custom"],
];

// ---
// Pure helpers
// ---

export function normalizeSubjectOption(item = {}) {
  const raw =
    typeof item.name === "string"
      ? item.name.trim()
      : typeof item.subject === "string"
        ? item.subject.trim()
        : "";
  if (!raw) return null;
  const name = normalizeSubjectName(raw);
  const id = String(item.id || "").trim() || buildSubjectIdFromName(name);
  return {
    id,
    name,
    source: String(item.source || "other"),
  };
}

export function parseSubjectCatalogRaw(raw) {
  if (!raw) return [];

  // Check cache first to avoid re-parsing
  const cached = subjectCatalogCache.get(raw);
  if (cached) {
    return cached;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result = parsed
      .map((item) => normalizeSubjectOption(item))
      .filter(Boolean);
    // Cache the parsed result
    subjectCatalogCache.set(raw, result);
    return result;
  } catch {
    return [];
  }
}

export function invalidateSubjectCache() {
  subjectCatalogCache.clear();
}

export function extractScheduleSubjectNames(weekSchedule = {}) {
  const names = new Set();
  Object.values(weekSchedule || {}).forEach((classes) => {
    if (!Array.isArray(classes)) return;
    classes.forEach((cls) => {
      const raw =
        typeof cls?.subject === "string"
          ? cls.subject.trim()
          : typeof cls?.name === "string"
            ? cls.name.trim()
            : "";
      if (!raw) return;
      const name = normalizeSubjectName(raw);
      if (name) names.add(name);
    });
  });
  return Array.from(names);
}

export function extractStudentScheduleProfile(userData = {}) {
  const si = userData?.studentInfo || {};
  const profile = {
    college: String(si.college || "").trim(),
    course: String(si.course || "").trim(),
    year: String(si.year || "").trim(),
    section: String(si.section || "").trim(),
    scheduleType: String(si.scheduleType || "").trim(),
  };
  if (!profile.course || !profile.year || !profile.section) return null;
  return profile;
}

export function sortSubjectOptions(options = []) {
  return [...options].sort((a, b) => {
    if (a.name === GENERAL_SUBJECT && b.name !== GENERAL_SUBJECT) return -1;
    if (b.name === GENERAL_SUBJECT && a.name !== GENERAL_SUBJECT) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function ensureGeneralSubjectOption(options = []) {
  if (!Array.isArray(options) || options.length === 0) {
    return [GENERAL_SUBJECT_OPTION];
  }
  const hasGeneral = options.some(
    (option) =>
      option?.id === GENERAL_SUBJECT_ID || option?.name === GENERAL_SUBJECT
  );
  if (hasGeneral) return options;
  return sortSubjectOptions([...options, GENERAL_SUBJECT_OPTION]);
}

// Re-export everything from utility modules so TaskManagerScreen.jsx can import
// them all from a single helpers file without missing-function errors
export * from "@/utils/navigationHelpers";
export * from "@/utils/plannerRefs";
export * from "@/utils/taskConstants";
export * from "@/utils/taskFormatters";
export * from "@/utils/taskHelpers";
export * from "@/utils/workloadCalculator";
export * from "../../utils/academicTaskModel";

export function normalizeDateToISO(value) {
  const d = parseDueDate(value);
  return d ? d.toISOString() : null;
}

export function getTaskSubjectId(task = {}) {
  const existing = String(task.subjectId || "").trim();
  if (existing) return existing;
  const name = normalizeSubjectName(
    task.subjectName || task.subject || GENERAL_SUBJECT
  );
  return buildSubjectIdFromName(name);
}

export function calculateWorkloadScore(tasks = []) {
  return calculateDailyWorkload(tasks);
}

export function getSectionKey(task, now) {
  const due = resolveTaskDueDate(task);
  if (!due) return "upcoming";
  if (due < now) return "overdue";
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  if (due <= endToday) return "today";
  const endWeek = new Date(now);
  endWeek.setDate(now.getDate() + 7);
  endWeek.setHours(23, 59, 59, 999);
  if (due <= endWeek) return "week";
  return "upcoming";
}

export function getPreferredCreateSubject({
  subjectFilterId,
  routeSubjectName,
  options = [],
}) {
  if (subjectFilterId && subjectFilterId !== SUBJECT_FILTER_ALL_ID) {
    const byId = options.find((option) => option.id === subjectFilterId);
    if (byId) return byId;
  }

  const normalizedRoute = normalizeSubjectName(routeSubjectName || "");
  if (normalizedRoute) {
    const byName = options.find(
      (option) => normalizeSubjectName(option.name) === normalizedRoute
    );
    if (byName) return byName;
  }

  return null;
}
