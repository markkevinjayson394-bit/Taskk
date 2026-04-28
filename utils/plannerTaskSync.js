import {
  Timestamp,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { clampText } from '@/utils/parsing';
import {
  buildSubjectIdFromName,
  buildTaskCreateData,
  getTaskPriorityLevel,
  isTaskCompleted,
  normalizeSubjectName,
  parseDueDate,
} from "./academicTaskModel";
import {
  endOfLocalDay,
  isSameLocalDay,
  startOfLocalDay,
  toLocalDayKey,
} from "./dateHelpers";
import { errorIfDev } from "./logger";

function normalizeDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date value.");
  }
  return date;
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

function startOfIsoWeek(baseDate) {
  const date = startOfLocalDay(normalizeDate(baseDate));
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
}

function endOfIsoWeek(baseDate) {
  const start = startOfIsoWeek(baseDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfLocalDay(end);
}

function startOfMonth(baseDate) {
  const date = normalizeDate(baseDate);
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(baseDate) {
  const date = normalizeDate(baseDate);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function dateToMs(value) {
  const d = parseDueDate(value);
  return d ? d.getTime() : null;
}

function normalizePlannerPriority(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "urgent") return "high";
  if (raw === "normal") return "medium";
  if (raw === "low") return "low";
  if (raw === "high" || raw === "medium" || raw === "none") return raw;
  return "medium";
}

function taskNeedsUpdate(existing, desired) {
  const existingPriorityLevel =
    Number(existing.priorityLevel) || getTaskPriorityLevel(existing.priority);
  const desiredPriorityLevel = getTaskPriorityLevel(desired.priority);
  const existingStatus =
    typeof existing.status === "string" ? existing.status : "";
  const existingSubjectId =
    typeof existing.subjectId === "string" ? existing.subjectId.trim() : "";
  const desiredSubjectId =
    typeof desired.subjectId === "string" ? desired.subjectId.trim() : "";
  const missingSchemaFields =
    !existing.subjectName ||
    !existingSubjectId ||
    !existing.status ||
    !Number.isFinite(Number(existing.priorityLevel)) ||
    !Number.isInteger(existing.schemaVersion);
  const existingSignature = [
    existing.title || "",
    existing.subjectName || existing.subject || "",
    existingSubjectId,
    existing.type || "",
    existing.priority || "",
    String(existingPriorityLevel),
    existingStatus,
    String(dateToMs(existing.dueAt)),
  ].join("|");

  const desiredSignature = [
    desired.title || "",
    desired.subject || "",
    desiredSubjectId,
    desired.type || "",
    desired.priority || "",
    String(desiredPriorityLevel),
    "todo",
    String(dateToMs(desired.dueDate)),
  ].join("|");

  return (
    existingSignature !== desiredSignature ||
    Boolean(existing.plannerArchived) ||
    missingSchemaFields
  );
}

async function fetchAssignmentsByUser(uid) {
  try {
    const snap = await getDocs(
      query(collection(db, "assignments"), where("userId", "==", uid))
    );
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    errorIfDev("Failed to fetch assignments:", error);
    throw error;
  }
}

function buildDayDesiredTasks(baseDate, dayKey, timeBlocks = []) {
  const bucket = `day:${dayKey}`;
  const deduped = new Map();

  for (let idx = 0; idx < timeBlocks.length; idx += 1) {
    const block = timeBlocks[idx];
    const title = clampText(typeof block?.task === "string" ? block.task.trim() : "", 140);
    if (!title) continue;

    const blockId = clampText(typeof block?.id === "string" ? block.id.trim() : "", 80) || `idx-${idx + 1}`;
    const plannerRef = buildDayPlannerRef(dayKey, blockId);
    const dueDate = withTime(baseDate, block?.end || block?.start, 18);
    const subject = normalizeSubjectName(
      clampText(typeof block?.subject === "string" ? block.subject.trim() : "", 80) || "Daily Planner"
    );
    const subjectId = buildSubjectIdFromName(subject);

    deduped.set(plannerRef, {
      plannerRef,
      plannerBucket: bucket,
      title,
      subject,
      subjectId,
      type: "assignment",
      priority: "medium",
      dueDate,
    });
  }

  return Array.from(deduped.values());
}

export function buildDayPlannerRef(dayKey, blockId) {
  const safeDayKey = clampText(typeof dayKey === "string" ? dayKey.trim() : "", 40) || "unknown-day";
  const safeBlockId = clampText(typeof blockId === "string" ? blockId.trim() : "", 80) || "unknown-block";
  return `planner:day:${safeDayKey}:block:${safeBlockId}`;
}

function buildMonthDesiredTasks(baseDate, monthKey, milestones = []) {
  const bucket = `month:${monthKey}`;
  const dueDate = monthEndDueDate(baseDate);
  const tasks = [];

  for (let idx = 0; idx < milestones.length; idx += 1) {
    const title = clampText(typeof milestones[idx] === "string" ? milestones[idx].trim() : "", 140);
    if (!title) continue;
    const subject = "Monthly Planner";

    tasks.push({
      plannerRef: `planner:month:${monthKey}:milestone:${idx + 1}`,
      plannerBucket: bucket,
      title,
      subject,
      subjectId: buildSubjectIdFromName(subject),
      type: "project",
      priority: "medium",
      dueDate,
    });
  }

  return tasks;
}
const BATCH_LIMIT = 499;

async function batchWrite(dbRef, collectionPath, items = []) {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = writeBatch(dbRef);
    const chunk = items.slice(i, i + BATCH_LIMIT);

    for (const item of chunk) {
      const ref = doc(collection(dbRef, collectionPath));
      batch.set(ref, item);
    }

    await batch.commit();
  }
}

async function syncBucket(uid, bucketKey, desiredTasks, existingAssignments, dbRef = db) {
  const plannerDocs = existingAssignments.filter(
    (item) => item.source === "planner" && item.plannerBucket === bucketKey
  );

  const byRef = new Map(plannerDocs.map((item) => [item.plannerRef, item]));
  const desiredRefs = new Set(desiredTasks.map((task) => task.plannerRef));

  const tasksToCreate = [];
  let created = 0;
  let updated = 0;
  let archived = 0;

  for (const desired of desiredTasks) {
    const existing = byRef.get(desired.plannerRef);

    if (!existing) {
      const createPayload = buildTaskCreateData(
        {
          userId: uid,
          title: desired.title,
          subject: desired.subject,
          subjectId: desired.subjectId,
          dueAt: Timestamp.fromDate(desired.dueDate),
          completed: false,
          type: desired.type,
          priority: desired.priority,
          source: "planner",
          plannerRef: desired.plannerRef,
          plannerBucket: desired.plannerBucket,
          plannerArchived: false,
        },
        { createdAt: serverTimestamp() }
      );
      tasksToCreate.push(createPayload);
      continue;
    }

    if (isTaskCompleted(existing)) {
      continue;
    }

    if (taskNeedsUpdate(existing, desired)) {
      await updateDoc(doc(dbRef, "assignments", existing.id), {
        title: desired.title,
        subject: desired.subject,
        subjectName: desired.subject,
        subjectId: desired.subjectId,
        dueAt: Timestamp.fromDate(desired.dueDate),
        type: desired.type,
        priority: desired.priority,
        priorityLevel: getTaskPriorityLevel(desired.priority),
        status: "todo",
        plannerArchived: false,
        schemaVersion: 2,
        updatedAt: serverTimestamp(),
      });
      updated += 1;
    }
  }

  await batchWrite(dbRef, "assignments", tasksToCreate);
  created = tasksToCreate.length;

  for (const stale of plannerDocs) {
    if (
      !desiredRefs.has(stale.plannerRef) &&
      !isTaskCompleted(stale) &&
      !stale.plannerArchived
    ) {
      await updateDoc(doc(dbRef, "assignments", stale.id), {
        plannerArchived: true,
        updatedAt: serverTimestamp(),
      });
      archived += 1;
    }
  }

  return { created, updated, archived };
}

function resolveDayKey(dayKey, baseDate = new Date()) {
  const text = typeof dayKey === "string" ? dayKey.trim() : "";
  return text || toLocalDayKey(normalizeDate(baseDate));
}

export async function syncDayPlannerTasks(
  uid,
  baseDate,
  dayKey,
  timeBlocks = []
) {
  const date = normalizeDate(baseDate);
  const resolvedDayKey = resolveDayKey(dayKey, date);
  const desiredTasks = buildDayDesiredTasks(date, resolvedDayKey, timeBlocks);
  const existingAssignments = await fetchAssignmentsByUser(uid);
  return syncBucket(
    uid,
    `day:${resolvedDayKey}`,
    desiredTasks,
    existingAssignments,
    db
  );
}

export async function syncMonthPlannerTasks(
  uid,
  baseDate,
  monthKey,
  milestones = []
) {
  const date = normalizeDate(baseDate);
  const desiredTasks = buildMonthDesiredTasks(date, monthKey, milestones);
  const existingAssignments = await fetchAssignmentsByUser(uid);
  return syncBucket(
    uid,
    `month:${monthKey}`,
    desiredTasks,
    existingAssignments,
    db
  );
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

function summarizeItems(plannedItems) {
  const planned = plannedItems.length;
  const completed = plannedItems.filter((item) => isTaskCompleted(item)).length;
  const pending = Math.max(planned - completed, 0);
  const percent = planned > 0 ? Math.round((completed / planned) * 100) : 0;

  return {
    planned,
    completed,
    pending,
    percent,
  };
}

function summarizeRange(assignments, rangeStart, rangeEnd) {
  const plannedItems = assignments.filter((item) => {
    const due = item.dueDate;
    if (!due) return false;
    return due >= rangeStart && due <= rangeEnd;
  });

  return summarizeItems(plannedItems);
}

export function buildCalendarPlanTasks(baseDate, dayKey, plans = []) {
  const resolvedBaseDate = normalizeDate(baseDate);
  const resolvedDayKey = resolveDayKey(dayKey, resolvedBaseDate);
  const bucket = `calendar:day:${resolvedDayKey}`;
  const deduped = new Map();

  for (const plan of plans) {
    const planDate = parseDueDate(plan?.time) || resolvedBaseDate;
    const planDayKey = resolveDayKey(plan?.dayKey, planDate);
    if (planDayKey !== resolvedDayKey) {
      continue;
    }
    if (!plan?.id) continue;
    const title =
      clampText(typeof plan?.title === "string" ? plan.title.trim() : "", 140) || `Calendar Plan: ${plan.id.slice(0, 8)}`;
    if (!title) continue;

    const plannerRef = `calendar:day:${resolvedDayKey}:plan:${plan.id}`;
    const dueDate = new Date(plan.time || resolvedBaseDate);
    dueDate.setHours(dueDate.getHours(), dueDate.getMinutes(), 0, 0);

    const subject = normalizeSubjectName(
      clampText(typeof plan?.note === "string" && plan.note.trim() ? plan.note.trim() : "Calendar Plan", 80)
    );
    const subjectId = buildSubjectIdFromName(subject);

    deduped.set(plannerRef, {
      plannerRef,
      plannerBucket: bucket,
      title,
      subject,
      subjectId,
      type: "assignment",
      priority: normalizePlannerPriority(plan?.priority),
      dueDate,
    });
  }

  return Array.from(deduped.values());
}

export async function syncCalendarDayPlans(uid, baseDate, dayKey, plans = []) {
  const date = normalizeDate(baseDate);
  const resolvedDayKey = resolveDayKey(dayKey, date);
  const desiredTasks = buildCalendarPlanTasks(date, resolvedDayKey, plans);
  const existingAssignments = await fetchAssignmentsByUser(uid);
  return syncBucket(
    uid,
    `calendar:day:${resolvedDayKey}`,
    desiredTasks,
    existingAssignments,
    db
  );
}

export function computePlannerAnalytics(assignments, baseDate = new Date()) {
  const date = normalizeDate(baseDate);
  const dayAssignments = assignments.filter((item) => {
    const due = item?.dueDate;
    return due instanceof Date && isSameLocalDay(due, date);
  });

  return {
    day: summarizeItems(dayAssignments),
    week: summarizeRange(
      assignments,
      startOfIsoWeek(new Date(date)),
      endOfIsoWeek(new Date(date))
    ),
    month: summarizeRange(assignments, startOfMonth(date), endOfMonth(date)),
  };
}
export { parseDueDate };


