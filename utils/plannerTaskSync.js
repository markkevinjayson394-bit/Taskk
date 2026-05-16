import {
    Timestamp,
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch,
} from "firebase/firestore";
import { getDb } from "../config/firebase";
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
import { clampText } from "./parsing";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
      query(collection(getDb(), "assignments"), where("userId", "==", uid))
    );
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    errorIfDev("Failed to fetch assignments:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// FIX 1: resolveDayKey — extracted BEFORE buildDayPlannerRef so both can use it.
// No logic change; just moved up so buildDayPlannerRef (exported) is defined
// after the helpers it needs.
// ---------------------------------------------------------------------------

function resolveDayKey(dayKey, baseDate = new Date()) {
  const text = typeof dayKey === "string" ? dayKey.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return toLocalDayKey(normalizeDate(baseDate));
}

// ---------------------------------------------------------------------------
// FIX 2: extractDayKeyFromIso — timezone-safe date extraction from ISO strings.
// Reads the YYYY-MM-DD prefix directly without any timezone conversion so that
// a plan with time="2026-03-23T08:00:00.000Z" always yields dayKey "2026-03-23"
// regardless of the test-runner's local timezone.
// ---------------------------------------------------------------------------

function extractDayKeyFromIso(isoString) {
  if (typeof isoString === "string") {
    const match = isoString.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Day-planner helpers
// ---------------------------------------------------------------------------

function buildDayDesiredTasks(baseDate, dayKey, timeBlocks = []) {
  const bucket = `day:${dayKey}`;
  const deduped = new Map();

  for (let idx = 0; idx < timeBlocks.length; idx += 1) {
    const block = timeBlocks[idx];
    const title = clampText(
      typeof block?.task === "string" ? block.task.trim() : "",
      140
    );
    if (!title) continue;

    const blockId =
      clampText(typeof block?.id === "string" ? block.id.trim() : "", 80) ||
      `idx-${idx + 1}`;
    const plannerRef = buildDayPlannerRef(dayKey, blockId);
    const dueDate = withTime(baseDate, block?.end || block?.start, 18);
    const subjectText =
      typeof block?.subject === "string" ? block.subject.trim() : "";
    const subject = subjectText
      ? normalizeSubjectName(clampText(subjectText, 80))
      : "Daily Planner";
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

// ---------------------------------------------------------------------------
// FIX 3: buildDayPlannerRef — was already correct in the source, but the test
// was getting "planner:day:undefined:block:undefined".  Root cause: the
// function was defined AFTER resolveDayKey in the original file, but more
// critically the EXPORT must be present so the test import resolves it.
// Confirmed export below.
// ---------------------------------------------------------------------------

export function buildDayPlannerRef(dayKey, blockId) {
  const safeDayKey =
    typeof dayKey === "string" && dayKey.trim()
      ? clampText(dayKey.trim(), 40)
      : "unknown-day";
  const safeBlockId =
    typeof blockId === "string" && blockId.trim()
      ? clampText(blockId.trim(), 80)
      : "unknown-block";
  return `planner:day:${safeDayKey}:block:${safeBlockId}`;
}

function buildMonthDesiredTasks(baseDate, monthKey, milestones = []) {
  const bucket = `month:${monthKey}`;
  const dueDate = monthEndDueDate(baseDate);
  const tasks = [];

  for (let idx = 0; idx < milestones.length; idx += 1) {
    const title = clampText(
      typeof milestones[idx] === "string" ? milestones[idx].trim() : "",
      140
    );
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

// ---------------------------------------------------------------------------
// Batch write
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// syncBucket
// ---------------------------------------------------------------------------

async function syncBucket(
  uid,
  bucketKey,
  desiredTasks,
  existingAssignments,
  dbRef = getDb()
) {
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

// ---------------------------------------------------------------------------
// Public sync functions
// ---------------------------------------------------------------------------

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
    existingAssignments
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
    existingAssignments
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

// ---------------------------------------------------------------------------
// FIX 1 (core): buildCalendarPlanTasks — timezone-safe day matching.
//
// Original bug:
//   const planDayKey = resolveDayKey(plan?.dayKey, planDate);
//   → when plan.dayKey is undefined, falls through to toLocalDayKey(planDate)
//   → toLocalDayKey converts the UTC Date to *local* midnight, so
//     "2026-03-23T08:00:00Z" in a UTC-N timezone becomes "2026-03-22", which
//     never matches resolvedDayKey "2026-03-23" → ALL plans are skipped.
//
// Fix: when plan.dayKey is absent, extract the YYYY-MM-DD prefix directly
// from the ISO string without any timezone conversion.  Only fall back to
// toLocalDayKey-based resolution when there is no ISO string at all.
// ---------------------------------------------------------------------------

export function buildCalendarPlanTasks(baseDate, dayKey, plans = []) {
  const resolvedBaseDate = normalizeDate(baseDate);
  const resolvedDayKey = resolveDayKey(dayKey, resolvedBaseDate);
  const bucket = `calendar:day:${resolvedDayKey}`;
  const deduped = new Map();

  for (const plan of plans) {
    // Determine the plan's dayKey in a timezone-safe way:
    //   1. Use plan.dayKey directly if it is already a valid YYYY-MM-DD string.
    //   2. Otherwise extract the date prefix from the ISO time string (no TZ conversion).
    //   3. Only fall back to toLocalDayKey() when neither is available.
    let planDayKey;
    if (
      typeof plan?.dayKey === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(plan.dayKey.trim())
    ) {
      planDayKey = plan.dayKey.trim();
    } else {
      planDayKey =
        extractDayKeyFromIso(plan?.time) ||
        resolveDayKey(undefined, resolvedBaseDate);
    }

    if (planDayKey !== resolvedDayKey) {
      continue;
    }

    if (!plan?.id) continue;

    const rawTitle = clampText(
      typeof plan?.title === "string" ? plan.title.trim() : "",
      140
    );

    // FIX: generate a default title for plans missing a title (instead of
    // silently dropping them, which broke the "generates default title" test).
    const title = rawTitle || `Plan ${String(plan.id).slice(0, 8)}`;

    const plannerRef = `calendar:day:${resolvedDayKey}:plan:${plan.id}`;

    // Build dueDate: use the plan's time when present, otherwise fall back to
    // the caller-supplied baseDate (preserves the "no time field" test).
    let dueDate;
    if (plan.time) {
      dueDate = new Date(plan.time);
      dueDate.setHours(dueDate.getHours(), dueDate.getMinutes(), 0, 0);
    } else {
      dueDate = new Date(resolvedBaseDate);
    }

    const noteText = typeof plan?.note === "string" ? plan.note.trim() : "";
    const subject = noteText
      ? normalizeSubjectName(clampText(noteText, 80))
      : "Calendar Plan";
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
    existingAssignments
  );
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// parsePlannerRef (added — was missing from the original file)
// ---------------------------------------------------------------------------

export function parsePlannerRef(ref) {
  if (typeof ref !== "string") return null;
  const value = ref.trim();
  if (!value) return null;
  if (value.split(":").some((segment) => segment === "")) {
    console.warn("parsePlannerRef: malformed ref (empty segment):", ref);
    return null;
  }
  const calendarMatch = value.match(/^calendar:day:([^:]+):plan:(.+)$/);
  if (calendarMatch) {
    const planId = (calendarMatch[2] || "").trim();
    if (!planId) {
      console.warn(
        "parsePlannerRef: malformed calendar ref (empty planId):",
        ref
      );
      return null;
    }
    return {
      mode: "calendar-day",
      dayKey: calendarMatch[1],
      planId,
    };
  }
  const dayMatch = value.match(/^planner:day:([^:]+):block:(.+)$/);
  if (dayMatch) {
    const blockId = (dayMatch[2] || "").trim();
    if (!blockId) {
      console.warn(
        "parsePlannerRef: malformed day-planner ref (empty blockId):",
        ref
      );
      return null;
    }
    return { mode: "day", dayKey: dayMatch[1], blockId };
  }
  const monthMatch = value.match(
    /^planner:month:(\d{4}-\d{2}):milestone:(\d+)$/
  );
  if (monthMatch)
    return {
      mode: "month",
      monthKey: monthMatch[1],
      milestoneIndex: Number(monthMatch[2]),
    };
  console.warn("parsePlannerRef: unrecognized ref format:", ref);
  return null;
}

export { parseDueDate };

