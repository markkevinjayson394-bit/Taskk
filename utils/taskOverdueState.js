import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNext8AM } from "./alarmTimeHelpers.js";
import { OVERDUE_CHAIN } from "./deadlineConstants";

const KEYS = {
  checkpoint: (taskId) => `task_overdue_checkpoint_${taskId}`,
};

export async function getCheckpoint(taskId) {
  try {
    const key = KEYS.checkpoint(taskId);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Normalize old format that stored 'stage' instead of 'key'
    if (parsed && !parsed.key && parsed.stage) {
      parsed.key = parsed.stage;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function advanceCheckpoint(taskId, currentKey, dueAtMs = null) {
  const resolvedDueAtMs = Number.isFinite(Number(dueAtMs))
    ? Number(dueAtMs)
    : null;

  // If daily, always schedule next 8AM
  if (currentKey === "daily") {
    const nextTrigger = getNext8AM().getTime();
    await setCheckpoint(taskId, "daily", nextTrigger);
    const lastChainEntry = OVERDUE_CHAIN[OVERDUE_CHAIN.length - 1];
    return { ...lastChainEntry, triggerAtMs: nextTrigger };
  }

  // If this is a lead-time key (not in OVERDUE_CHAIN), start from "due"
  const validKeys = new Set(OVERDUE_CHAIN.map((c) => c.key));
  const resolvedKey = validKeys.has(currentKey) ? currentKey : "due";

  const idx = OVERDUE_CHAIN.findIndex((c) => c.key === resolvedKey);
  if (idx === -1 || idx === OVERDUE_CHAIN.length - 1) {
    // Already at end of chain → go to daily
    const nextTrigger = getNext8AM().getTime();
    await setCheckpoint(taskId, "daily", nextTrigger);
    const lastChainEntry = OVERDUE_CHAIN[OVERDUE_CHAIN.length - 1];
    return { ...lastChainEntry, triggerAtMs: nextTrigger };
  }

  const next = OVERDUE_CHAIN[idx + 1];
  const estimatedTriggerMs = Number.isFinite(next.delayMs)
    ? resolvedDueAtMs && resolvedDueAtMs > 0
      ? resolvedDueAtMs + next.delayMs
      : Date.now() + next.delayMs
    : null;
  await setCheckpoint(taskId, next.key, estimatedTriggerMs);
  return next;
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
  } catch {
    // ignore
  }
}
