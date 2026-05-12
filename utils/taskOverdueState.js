import AsyncStorage from "@react-native-async-storage/async-storage";
import { OVERDUE_CHAIN } from "./deadlineConstants";

const KEYS = {
  checkpoint: (taskId) => `task_overdue_checkpoint_${taskId}`,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const CHAIN_INDEX = new Map(
  OVERDUE_CHAIN.map((entry, index) => [entry.key, index])
);
const CHAIN_ENTRY = new Map(OVERDUE_CHAIN.map((entry) => [entry.key, entry]));

function normalizeMs(value, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!allowZero && parsed <= 0) return null;
  return parsed;
}

function getChainEntry(key) {
  return CHAIN_ENTRY.get(key) || null;
}

export function compareOverdueStageOrder(a, b) {
  const aIndex = CHAIN_INDEX.get(a);
  const bIndex = CHAIN_INDEX.get(b);
  const hasA = Number.isInteger(aIndex);
  const hasB = Number.isInteger(bIndex);

  if (hasA && hasB) return aIndex - bIndex;
  if (hasA) return 1;
  if (hasB) return -1;
  return 0;
}

function getStageDelayMs(key) {
  const entry = getChainEntry(key);
  return Number.isFinite(entry?.delayMs) ? entry.delayMs : null;
}

function resolveNext8AMFromMs(referenceMs) {
  const anchor = normalizeMs(referenceMs, { allowZero: true });
  const base = Number.isFinite(anchor) ? new Date(anchor) : new Date();
  const at8 = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    8,
    0,
    0,
    0
  );
  if (at8.getTime() > base.getTime()) {
    return at8.getTime();
  }
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + 1,
    8,
    0,
    0,
    0
  ).getTime();
}

export function resolveIntendedTriggerAt(
  stageKey,
  dueAtMs,
  nowMs = Date.now()
) {
  const resolvedDueAtMs = normalizeMs(dueAtMs);
  if (!Number.isFinite(resolvedDueAtMs)) return null;

  if (stageKey === "daily") {
    const firstDailyTrigger = resolveFirstDailyTrigger(resolvedDueAtMs);
    if (!Number.isFinite(firstDailyTrigger)) return null;
    const referenceMs = normalizeMs(nowMs, { allowZero: true });
    if (!Number.isFinite(referenceMs) || referenceMs <= firstDailyTrigger) {
      return firstDailyTrigger;
    }
    const elapsedDays =
      Math.floor((referenceMs - firstDailyTrigger) / DAY_MS) + 1;
    return firstDailyTrigger + elapsedDays * DAY_MS;
  }

  const delayMs = stageKey === "due" ? 0 : getStageDelayMs(stageKey);
  if (!Number.isFinite(delayMs)) return null;
  return resolvedDueAtMs + delayMs;
}

export function resolveFirstDailyTrigger(dueAtMs) {
  const resolvedDueAtMs = normalizeMs(dueAtMs);
  if (!Number.isFinite(resolvedDueAtMs)) return null;
  const plusThreeHours =
    resolveIntendedTriggerAt("+3h", resolvedDueAtMs) ?? resolvedDueAtMs;
  return resolveNext8AMFromMs(plusThreeHours);
}

export function resolveDailyAckBucket(dueAtMs, nowMs = Date.now()) {
  const resolvedDueAtMs = normalizeMs(dueAtMs);
  const resolvedNowMs = normalizeMs(nowMs, { allowZero: true });
  const firstDailyTrigger = resolveFirstDailyTrigger(resolvedDueAtMs);
  if (
    !Number.isFinite(resolvedDueAtMs) ||
    !Number.isFinite(resolvedNowMs) ||
    !Number.isFinite(firstDailyTrigger) ||
    resolvedNowMs < firstDailyTrigger
  ) {
    return 0;
  }
  return Math.floor((resolvedNowMs - firstDailyTrigger) / DAY_MS) + 1;
}

export function resolveCurrentOverdueStageInfo(dueAtMs, nowMs = Date.now()) {
  const resolvedDueAtMs = normalizeMs(dueAtMs);
  const resolvedNowMs = normalizeMs(nowMs, { allowZero: true });
  if (
    !Number.isFinite(resolvedDueAtMs) ||
    !Number.isFinite(resolvedNowMs) ||
    resolvedNowMs < resolvedDueAtMs
  ) {
    return null;
  }

  const dueTriggerAt = resolveIntendedTriggerAt("due", resolvedDueAtMs);
  const plus15TriggerAt = resolveIntendedTriggerAt("+15m", resolvedDueAtMs);
  if (Number.isFinite(plus15TriggerAt) && resolvedNowMs < plus15TriggerAt) {
    return { key: "due", triggerAtMs: dueTriggerAt };
  }

  const plus1hTriggerAt = resolveIntendedTriggerAt("+1h", resolvedDueAtMs);
  if (Number.isFinite(plus1hTriggerAt) && resolvedNowMs < plus1hTriggerAt) {
    return { key: "+15m", triggerAtMs: plus15TriggerAt };
  }

  const plus3hTriggerAt = resolveIntendedTriggerAt("+3h", resolvedDueAtMs);
  if (Number.isFinite(plus3hTriggerAt) && resolvedNowMs < plus3hTriggerAt) {
    return { key: "+1h", triggerAtMs: plus1hTriggerAt };
  }

  const firstDailyTrigger = resolveFirstDailyTrigger(resolvedDueAtMs);
  if (Number.isFinite(firstDailyTrigger) && resolvedNowMs < firstDailyTrigger) {
    return { key: "+3h", triggerAtMs: plus3hTriggerAt };
  }

  const dailyBucket = resolveDailyAckBucket(resolvedDueAtMs, resolvedNowMs);
  if (dailyBucket > 0 && Number.isFinite(firstDailyTrigger)) {
    return {
      key: "daily",
      triggerAtMs: firstDailyTrigger + (dailyBucket - 1) * DAY_MS,
      bucket: dailyBucket,
    };
  }

  return { key: "+3h", triggerAtMs: plus3hTriggerAt };
}

export function resolveCurrentOverdueStage(dueAtMs, nowMs = Date.now()) {
  return resolveCurrentOverdueStageInfo(dueAtMs, nowMs)?.key ?? null;
}

export function resolveNextCheckpoint(currentKey, dueAtMs, nowMs = Date.now()) {
  const resolvedDueAtMs = normalizeMs(dueAtMs);
  const resolvedKey = CHAIN_INDEX.has(currentKey) ? currentKey : "due";

  if (resolvedKey === "daily") {
    const dailyEntry = getChainEntry("daily");
    if (!dailyEntry) return null;
    return {
      ...dailyEntry,
      triggerAtMs: resolveIntendedTriggerAt(
        "daily",
        resolvedDueAtMs,
        Number(nowMs) + 1
      ),
    };
  }

  const currentIndex = CHAIN_INDEX.get(resolvedKey);
  if (!Number.isInteger(currentIndex)) return null;

  const nextEntry =
    OVERDUE_CHAIN[currentIndex + 1] ?? OVERDUE_CHAIN[OVERDUE_CHAIN.length - 1];
  if (!nextEntry?.key) return null;

  const triggerAtMs =
    nextEntry.key === "daily"
      ? resolveIntendedTriggerAt("daily", resolvedDueAtMs, Number(nowMs) + 1)
      : resolveIntendedTriggerAt(nextEntry.key, resolvedDueAtMs, nowMs);

  return { ...nextEntry, triggerAtMs };
}

export async function getCheckpoint(taskId) {
  try {
    const key = KEYS.checkpoint(taskId);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && !parsed.key && parsed.stage) {
      parsed.key = parsed.stage;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function advanceCheckpoint(taskId, currentKey, dueAtMs = null) {
  const nextCheckpoint = resolveNextCheckpoint(currentKey, dueAtMs, Date.now());
  if (!nextCheckpoint?.key) return null;
  await setCheckpoint(
    taskId,
    nextCheckpoint.key,
    Number.isFinite(nextCheckpoint.triggerAtMs)
      ? nextCheckpoint.triggerAtMs
      : null
  );
  return nextCheckpoint;
}

export async function clearCheckpoint(taskId) {
  try {
    const key = KEYS.checkpoint(taskId);
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function setCheckpoint(taskId, key, triggerAtMs = null) {
  try {
    const storageKey = KEYS.checkpoint(taskId);
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        key,
        scheduledAt: Date.now(),
        triggerAtMs: Number.isFinite(triggerAtMs) ? triggerAtMs : null,
      })
    );
  } catch (err) {
    warnIfDev(
      `[setCheckpoint] Failed to persist checkpoint for ${taskId}: ${err.message}`
    );
  }
}
