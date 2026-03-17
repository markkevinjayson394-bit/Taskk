import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../config/firebase";

function normalizeDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date value.");
  }
  return date;
}

function clampText(value, maxLen = 140) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

function parseClock(clockText) {
  if (typeof clockText !== "string") return null;
  const match = clockText.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function withTime(baseDate, clockText, fallbackHour = 18) {
  const date = normalizeDate(baseDate);
  const parsed = parseClock(clockText);
  const out = new Date(date);
  if (parsed) {
    out.setHours(parsed.hours, parsed.minutes, 0, 0);
  } else {
    out.setHours(fallbackHour, 0, 0, 0);
  }
  return out;
}

function monthEndDueDate(baseDate) {
  const date = normalizeDate(baseDate);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 20, 0, 0, 0);
}

function startOfDay(baseDate) {
  const date = normalizeDate(baseDate);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(baseDate) {
  const date = normalizeDate(baseDate);
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfIsoWeek(baseDate) {
  const date = startOfDay(baseDate);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
}

function endOfIsoWeek(baseDate) {
  const start = startOfIsoWeek(baseDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function startOfMonth(baseDate) {
  const date = normalizeDate(baseDate);
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(baseDate) {
  const date = normalizeDate(baseDate);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function toMillis(value) {
  return value instanceof Date ? value.getTime() : NaN;
}

function stringifyTaskSignature(task) {
  const dueMs = toMillis(task.dueDate);
  return [task.title, task.subject, task.type, task.priority, String(dueMs)].join("|");
}

function taskNeedsUpdate(existing, desired) {
  const existingDue = parseDueDate(existing.dueAt);
  const existingSignature = [
    existing.title || "",
    existing.subject || "",
    existing.type || "",
    existing.priority || "",
    String(toMillis(existingDue)),
  ].join("|");

  return existingSignature !== stringifyTaskSignature(desired) || Boolean(existing.plannerArchived);
}

async function fetchAssignmentsByUser(uid) {
  try {
    const snap = await getDocs(query(collection(db, "assignments"), where("userId", "==", uid)));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.error("Failed to fetch assignments:", error);
    return [];
  }
}

function buildDayDesiredTasks(baseDate, dayKey, timeBlocks = []) {
  const bucket = `day:${dayKey}`;
  const deduped = new Map();

  for (let idx = 0; idx < timeBlocks.length; idx += 1) {
    const block = timeBlocks[idx];
    const title = clampText(block?.task, 140);
    if (!title) continue;

    const blockId = clampText(block?.id, 80) || `idx-${idx + 1}`;
    const plannerRef = `planner:day:${dayKey}:block:${blockId}`;
    const dueDate = withTime(baseDate, block?.end || block?.start, 18);
    const subject = clampText(block?.subject, 80) || "Daily Planner";

    deduped.set(plannerRef, {
      plannerRef,
      plannerBucket: bucket,
      title,
      subject,
      type: "assignment",
      priority: "medium",
      dueDate,
    });
  }

  return Array.from(deduped.values());
}

function buildMonthDesiredTasks(baseDate, monthKey, milestones = []) {
  const bucket = `month:${monthKey}`;
  const dueDate = monthEndDueDate(baseDate);
  const tasks = [];

  for (let idx = 0; idx < milestones.length; idx += 1) {
    const title = clampText(milestones[idx], 140);
    if (!title) continue;

    tasks.push({
      plannerRef: `planner:month:${monthKey}:milestone:${idx + 1}`,
      plannerBucket: bucket,
      title,
      subject: "Monthly Planner",
      type: "project",
      priority: "medium",
      dueDate,
    });
  }

  return tasks;
}

async function syncBucket(uid, bucketKey, desiredTasks, existingAssignments) {
  const plannerDocs = existingAssignments.filter(
    (item) => item.source === "planner" && item.plannerBucket === bucketKey
  );

  const byRef = new Map(plannerDocs.map((item) => [item.plannerRef, item]));
  const desiredRefs = new Set(desiredTasks.map((task) => task.plannerRef));

  let created = 0;
  let updated = 0;
  let archived = 0;

  for (const desired of desiredTasks) {
    const existing = byRef.get(desired.plannerRef);

    if (!existing) {
      await addDoc(collection(db, "assignments"), {
        userId: uid,
        title: desired.title,
        subject: desired.subject,
        dueAt: Timestamp.fromDate(desired.dueDate),
        completed: false,
        type: desired.type,
        priority: desired.priority,
        source: "planner",
        plannerRef: desired.plannerRef,
        plannerBucket: desired.plannerBucket,
        plannerArchived: false,
        createdAt: serverTimestamp(),
      });
      created += 1;
      continue;
    }

    if (existing.completed) {
      continue;
    }

    if (taskNeedsUpdate(existing, desired)) {
      await updateDoc(doc(db, "assignments", existing.id), {
        title: desired.title,
        subject: desired.subject,
        dueAt: Timestamp.fromDate(desired.dueDate),
        type: desired.type,
        priority: desired.priority,
        plannerArchived: false,
        updatedAt: serverTimestamp(),
      });
      updated += 1;
    }
  }

  for (const stale of plannerDocs) {
    if (!desiredRefs.has(stale.plannerRef) && !stale.completed && !stale.plannerArchived) {
      await updateDoc(doc(db, "assignments", stale.id), {
        plannerArchived: true,
        updatedAt: serverTimestamp(),
      });
      archived += 1;
    }
  }

  return { created, updated, archived };
}

export function parseDueDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export async function syncDayPlannerTasks(uid, baseDate, dayKey, timeBlocks = []) {
  const date = normalizeDate(baseDate);
  const desiredTasks = buildDayDesiredTasks(date, dayKey, timeBlocks);
  const existingAssignments = await fetchAssignmentsByUser(uid);
  return syncBucket(uid, `day:${dayKey}`, desiredTasks, existingAssignments);
}

export async function syncMonthPlannerTasks(uid, baseDate, monthKey, milestones = []) {
  const date = normalizeDate(baseDate);
  const desiredTasks = buildMonthDesiredTasks(date, monthKey, milestones);
  const existingAssignments = await fetchAssignmentsByUser(uid);
  return syncBucket(uid, `month:${monthKey}`, desiredTasks, existingAssignments);
}

export async function fetchPlannerAssignments(uid) {
  const existingAssignments = await fetchAssignmentsByUser(uid);

  return existingAssignments
    .filter((item) => item.source === "planner" && !item.plannerArchived)
    .map((item) => ({
      ...item,
      dueDate: parseDueDate(item.dueAt),
    }))
    .filter((item) => item.dueDate);
}

function summarizeRange(assignments, rangeStart, rangeEnd) {
  const plannedItems = assignments.filter((item) => {
    const due = item.dueDate;
    if (!due) return false;
    return due >= rangeStart && due <= rangeEnd;
  });

  const planned = plannedItems.length;
  const completed = plannedItems.filter((item) => Boolean(item.completed)).length;
  const pending = Math.max(planned - completed, 0);
  const percent = planned > 0 ? Math.round((completed / planned) * 100) : 0;

  return {
    planned,
    completed,
    pending,
    percent,
  };
}

export function computePlannerAnalytics(assignments, baseDate = new Date()) {
  const date = normalizeDate(baseDate);

  return {
    day: summarizeRange(assignments, startOfDay(date), endOfDay(date)),
    week: summarizeRange(assignments, startOfIsoWeek(date), endOfIsoWeek(date)),
    month: summarizeRange(assignments, startOfMonth(date), endOfMonth(date)),
  };
}
