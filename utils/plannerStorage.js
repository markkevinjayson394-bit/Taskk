import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";

const DAY_COLLECTION = "planner_days";
const WEEK_COLLECTION = "planner_weeks";
const MONTH_COLLECTION = "planner_months";
const QUEUE_KEY = (uid) => `planner_queue_${uid}`;
const CACHE_KEY = (uid, mode, key) => `planner_cache_${uid}_${mode}_${key}`;

/**
 * @typedef {Object} PlannerTimeBlock
 * @property {string} id
 * @property {string} start
 * @property {string} end
 * @property {string} subject
 * @property {string} task
 */

/**
 * @typedef {Object} DayPlan
 * @property {string[]} priorities
 * @property {PlannerTimeBlock[]} timeBlocks
 * @property {string} notes
 */

/**
 * @typedef {Object} WeekPlan
 * @property {string[]} goals
 * @property {string} notes
 */

/**
 * @typedef {Object} MonthPlan
 * @property {string[]} goals
 * @property {string[]} milestones
 * @property {string} notes
 */

const DEFAULT_DAY_PLAN = {
  priorities: ["", "", ""],
  timeBlocks: [],
  notes: "",
};

const DEFAULT_WEEK_PLAN = {
  goals: ["", "", ""],
  notes: "",
};

const DEFAULT_MONTH_PLAN = {
  goals: ["", "", ""],
  milestones: [],
  notes: "",
};

const MIN_FOCUS_ITEMS = 3;
const MAX_FOCUS_ITEMS = 12;

// Cache limits to prevent unbounded storage growth
const MAX_QUEUE_ITEMS = 50;
const MAX_CACHE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid planner date input.");
  }
  return date;
}

function getIsoWeekParts(dateInput = new Date()) {
  const date = normalizeDate(dateInput);
  const utcDate = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);

  return {
    year: utcDate.getUTCFullYear(),
    week: weekNo,
  };
}

function ensureUid(uid) {
  if (!uid) {
    throw new Error("A user id is required for planner operations.");
  }
}

function normalizeFocusList(list, minItems = MIN_FOCUS_ITEMS) {
  const base = Array.isArray(list) ? list : [];
  const minimum = Math.max(0, Number(minItems) || 0);
  const sanitized = base
    .slice(0, MAX_FOCUS_ITEMS)
    .map((item) => (typeof item === "string" ? item : ""));
  while (sanitized.length < minimum) sanitized.push("");
  return sanitized;
}

function normalizeTimeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .slice(0, 24)
    .map((block, idx) => ({
      id:
        typeof block?.id === "string" && block.id.trim()
          ? block.id.trim()
          : `block-${idx + 1}`,
      start: typeof block?.start === "string" ? block.start : "",
      end: typeof block?.end === "string" ? block.end : "",
      subject: typeof block?.subject === "string" ? block.subject : "",
      task: typeof block?.task === "string" ? block.task : "",
    }))
    .filter((block) => block.start || block.end || block.subject || block.task);
}

function normalizeMilestones(milestones) {
  if (!Array.isArray(milestones)) return [];
  return milestones
    .slice(0, 16)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function queueId(mode, key) {
  return `${mode}:${key}`;
}

function normalizeQueue(queue = []) {
  const map = new Map();
  for (const item of queue) {
    if (!item?.id || !item?.mode || !item?.key) continue;
    const prev = map.get(item.id);
    const nextTime = new Date(item.updatedAt || 0).getTime();
    const prevTime = prev ? new Date(prev.updatedAt || 0).getTime() : -1;
    if (!prev || nextTime >= prevTime) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

async function readQueue(uid) {
  if (!uid) return [];
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeQueue(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

async function writeQueue(uid, queue) {
  if (!uid) return [];
  const normalized = normalizeQueue(queue);

  // Limit queue size to prevent unbounded growth
  const limitedQueue = normalized.slice(-MAX_QUEUE_ITEMS);

  if (limitedQueue.length === 0) {
    await AsyncStorage.removeItem(QUEUE_KEY(uid));
    return [];
  }
  await AsyncStorage.setItem(QUEUE_KEY(uid), JSON.stringify(limitedQueue));
  return limitedQueue;
}

async function getQueuedPlan(uid, mode, key) {
  const queue = await readQueue(uid);
  return queue.find((item) => item.id === queueId(mode, key)) || null;
}

async function enqueuePlan(uid, mode, key, plan) {
  const queue = await readQueue(uid);
  const id = queueId(mode, key);
  const updatedAt = new Date().toISOString();
  const next = normalizeQueue([
    ...queue.filter((item) => item.id !== id),
    { id, mode, key, plan, updatedAt },
  ]);
  await writeQueue(uid, next);
  return next;
}

async function removeQueuedPlan(uid, mode, key) {
  const queue = await readQueue(uid);
  const id = queueId(mode, key);
  const next = queue.filter((item) => item.id !== id);
  await writeQueue(uid, next);
  return next;
}

async function saveCache(uid, mode, key, plan) {
  if (!uid) return;
  try {
    const serialized = JSON.stringify(plan);
    // Skip if data is too large
    if (serialized.length > MAX_CACHE_SIZE_BYTES) {
      console.warn(
        "Planner cache too large, skipping save:",
        serialized.length,
        "bytes"
      );
      return;
    }
    await AsyncStorage.setItem(CACHE_KEY(uid, mode, key), serialized);
  } catch (_err) {
    console.error("Failed to save planner cache:", _err);
  }
}

async function loadCache(uid, mode, key) {
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY(uid, mode, key));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function dayDocRef(uid, dayKey) {
  ensureUid(uid);
  return doc(db, "users", uid, DAY_COLLECTION, dayKey);
}

function weekDocRef(uid, weekKey) {
  ensureUid(uid);
  return doc(db, "users", uid, WEEK_COLLECTION, weekKey);
}

function monthDocRef(uid, monthKey) {
  ensureUid(uid);
  return doc(db, "users", uid, MONTH_COLLECTION, monthKey);
}

export function toDayKey(dateInput = new Date()) {
  const date = normalizeDate(dateInput);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function toWeekKey(dateInput = new Date()) {
  const { year, week } = getIsoWeekParts(dateInput);
  return `${year}-W${pad2(week)}`;
}

export function toMonthKey(dateInput = new Date()) {
  const date = normalizeDate(dateInput);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function getPlannerKeys(dateInput = new Date()) {
  return {
    dayKey: toDayKey(dateInput),
    weekKey: toWeekKey(dateInput),
    monthKey: toMonthKey(dateInput),
  };
}

export function normalizeDayPlan(data = {}) {
  return {
    priorities: normalizeFocusList(data.priorities),
    timeBlocks: normalizeTimeBlocks(data.timeBlocks),
    notes: typeof data.notes === "string" ? data.notes : "",
  };
}

export function normalizeWeekPlan(data = {}) {
  return {
    goals: normalizeFocusList(data.goals),
    notes: typeof data.notes === "string" ? data.notes : "",
  };
}

export function normalizeMonthPlan(data = {}) {
  return {
    goals: normalizeFocusList(data.goals),
    milestones: normalizeMilestones(data.milestones),
    notes: typeof data.notes === "string" ? data.notes : "",
  };
}

export async function loadDayPlan(uid, dateInput = new Date(), options = {}) {
  const dayKey = toDayKey(dateInput);
  const queued = await getQueuedPlan(uid, "day", dayKey);
  if (queued?.plan) {
    return {
      ...DEFAULT_DAY_PLAN,
      ...normalizeDayPlan(queued.plan),
      dayKey,
      queued: true,
    };
  }

  const cached = await loadCache(uid, "day", dayKey);
  if (options?.isOnline === false) {
    if (cached) {
      return {
        ...DEFAULT_DAY_PLAN,
        ...normalizeDayPlan(cached),
        dayKey,
        cached: true,
      };
    }
    return { ...DEFAULT_DAY_PLAN, dayKey };
  }

  if (cached && options?.preferCache) {
    return {
      ...DEFAULT_DAY_PLAN,
      ...normalizeDayPlan(cached),
      dayKey,
      cached: true,
    };
  }

  const ref = dayDocRef(uid, dayKey);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await saveCache(uid, "day", dayKey, DEFAULT_DAY_PLAN);
    return { ...DEFAULT_DAY_PLAN, dayKey };
  }

  const normalized = {
    ...DEFAULT_DAY_PLAN,
    ...normalizeDayPlan(snap.data()),
    dayKey,
  };
  await saveCache(uid, "day", dayKey, normalized);
  return normalized;
}

export async function saveDayPlan(
  uid,
  dateInput = new Date(),
  plan = {},
  options = {}
) {
  const dayKey = toDayKey(dateInput);
  const ref = dayDocRef(uid, dayKey);
  const normalizedPlan = normalizeDayPlan(plan);
  await saveCache(uid, "day", dayKey, normalizedPlan);

  if (options?.isOnline === false) {
    await enqueuePlan(uid, "day", dayKey, normalizedPlan);
    return { ...normalizedPlan, dayKey, queued: true };
  }

  try {
    await setDoc(
      ref,
      {
        ...normalizedPlan,
        dayKey,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await removeQueuedPlan(uid, "day", dayKey);
    return { ...normalizedPlan, dayKey, queued: false };
  } catch (error) {
    if (options?.queueOnError !== false) {
      await enqueuePlan(uid, "day", dayKey, normalizedPlan);
      return { ...normalizedPlan, dayKey, queued: true };
    }
    throw error;
  }
}

export async function loadWeekPlan(uid, dateInput = new Date(), options = {}) {
  const weekKey = toWeekKey(dateInput);
  const queued = await getQueuedPlan(uid, "week", weekKey);
  if (queued?.plan) {
    return {
      ...DEFAULT_WEEK_PLAN,
      ...normalizeWeekPlan(queued.plan),
      weekKey,
      queued: true,
    };
  }

  const cached = await loadCache(uid, "week", weekKey);
  if (options?.isOnline === false) {
    if (cached) {
      return {
        ...DEFAULT_WEEK_PLAN,
        ...normalizeWeekPlan(cached),
        weekKey,
        cached: true,
      };
    }
    return { ...DEFAULT_WEEK_PLAN, weekKey };
  }

  if (cached && options?.preferCache) {
    return {
      ...DEFAULT_WEEK_PLAN,
      ...normalizeWeekPlan(cached),
      weekKey,
      cached: true,
    };
  }

  const ref = weekDocRef(uid, weekKey);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await saveCache(uid, "week", weekKey, DEFAULT_WEEK_PLAN);
    return { ...DEFAULT_WEEK_PLAN, weekKey };
  }

  const normalized = {
    ...DEFAULT_WEEK_PLAN,
    ...normalizeWeekPlan(snap.data()),
    weekKey,
  };
  await saveCache(uid, "week", weekKey, normalized);
  return normalized;
}

export async function saveWeekPlan(
  uid,
  dateInput = new Date(),
  plan = {},
  options = {}
) {
  const weekKey = toWeekKey(dateInput);
  const ref = weekDocRef(uid, weekKey);
  const normalizedPlan = normalizeWeekPlan(plan);
  await saveCache(uid, "week", weekKey, normalizedPlan);

  if (options?.isOnline === false) {
    await enqueuePlan(uid, "week", weekKey, normalizedPlan);
    return { ...normalizedPlan, weekKey, queued: true };
  }

  try {
    await setDoc(
      ref,
      {
        ...normalizedPlan,
        weekKey,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await removeQueuedPlan(uid, "week", weekKey);
    return { ...normalizedPlan, weekKey, queued: false };
  } catch (error) {
    if (options?.queueOnError !== false) {
      await enqueuePlan(uid, "week", weekKey, normalizedPlan);
      return { ...normalizedPlan, weekKey, queued: true };
    }
    throw error;
  }
}

export async function loadMonthPlan(uid, dateInput = new Date(), options = {}) {
  const monthKey = toMonthKey(dateInput);
  const queued = await getQueuedPlan(uid, "month", monthKey);
  if (queued?.plan) {
    return {
      ...DEFAULT_MONTH_PLAN,
      ...normalizeMonthPlan(queued.plan),
      monthKey,
      queued: true,
    };
  }

  const cached = await loadCache(uid, "month", monthKey);
  if (options?.isOnline === false) {
    if (cached) {
      return {
        ...DEFAULT_MONTH_PLAN,
        ...normalizeMonthPlan(cached),
        monthKey,
        cached: true,
      };
    }
    return { ...DEFAULT_MONTH_PLAN, monthKey };
  }

  if (cached && options?.preferCache) {
    return {
      ...DEFAULT_MONTH_PLAN,
      ...normalizeMonthPlan(cached),
      monthKey,
      cached: true,
    };
  }

  const ref = monthDocRef(uid, monthKey);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await saveCache(uid, "month", monthKey, DEFAULT_MONTH_PLAN);
    return { ...DEFAULT_MONTH_PLAN, monthKey };
  }

  const normalized = {
    ...DEFAULT_MONTH_PLAN,
    ...normalizeMonthPlan(snap.data()),
    monthKey,
  };
  await saveCache(uid, "month", monthKey, normalized);
  return normalized;
}

export async function saveMonthPlan(
  uid,
  dateInput = new Date(),
  plan = {},
  options = {}
) {
  const monthKey = toMonthKey(dateInput);
  const ref = monthDocRef(uid, monthKey);
  const normalizedPlan = normalizeMonthPlan(plan);
  await saveCache(uid, "month", monthKey, normalizedPlan);

  if (options?.isOnline === false) {
    await enqueuePlan(uid, "month", monthKey, normalizedPlan);
    return { ...normalizedPlan, monthKey, queued: true };
  }

  try {
    await setDoc(
      ref,
      {
        ...normalizedPlan,
        monthKey,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await removeQueuedPlan(uid, "month", monthKey);
    return { ...normalizedPlan, monthKey, queued: false };
  } catch (error) {
    if (options?.queueOnError !== false) {
      await enqueuePlan(uid, "month", monthKey, normalizedPlan);
      return { ...normalizedPlan, monthKey, queued: true };
    }
    throw error;
  }
}

export async function flushPlannerQueue(uid) {
  const queue = await readQueue(uid);
  if (!queue.length) return { flushed: 0, remaining: 0 };

  const remaining = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      if (item.mode === "day") {
        const ref = dayDocRef(uid, item.key);
        const normalized = normalizeDayPlan(item.plan);
        await setDoc(
          ref,
          {
            ...normalized,
            dayKey: item.key,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await saveCache(uid, "day", item.key, normalized);
      } else if (item.mode === "week") {
        const ref = weekDocRef(uid, item.key);
        const normalized = normalizeWeekPlan(item.plan);
        await setDoc(
          ref,
          {
            ...normalized,
            weekKey: item.key,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await saveCache(uid, "week", item.key, normalized);
      } else if (item.mode === "month") {
        const ref = monthDocRef(uid, item.key);
        const normalized = normalizeMonthPlan(item.plan);
        await setDoc(
          ref,
          {
            ...normalized,
            monthKey: item.key,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await saveCache(uid, "month", item.key, normalized);
      } else {
        remaining.push(item);
        continue;
      }
      flushed += 1;
    } catch {
      remaining.push(item);
    }
  }

  await writeQueue(uid, remaining);
  return { flushed, remaining: remaining.length };
}

export async function getPlannerQueueCount(uid) {
  const queue = await readQueue(uid);
  return queue.length;
}
