import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "task_overdue_checkpoints";

export const OVERDUE_CHAIN = [
  { key: "due", delayMs: 0 },
  { key: "+15m", delayMs: 15 * 60 * 1000 },
  { key: "+1h", delayMs: 60 * 60 * 1000 },
  { key: "+3h", delayMs: 3 * 60 * 60 * 1000 },
  { key: "daily", delayMs: null },
];

export async function getCheckpoint(taskId) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[taskId] ?? null;
  } catch {
    return null;
  }
}

export async function advanceCheckpoint(taskId, currentStage) {
  const raw = await AsyncStorage.getItem(KEY);
  const map = raw ? JSON.parse(raw) : {};
  const idx = OVERDUE_CHAIN.findIndex((c) => c.key === currentStage);
  const next = OVERDUE_CHAIN[idx + 1] ?? null;
  if (next) {
    map[taskId] = { stage: next.key, scheduledAt: Date.now() };
  } else {
    map[taskId] = { stage: "daily", scheduledAt: Date.now() };
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
  return next;
}

export async function clearCheckpoint(taskId) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const map = raw ? JSON.parse(raw) : {};
    delete map[taskId];
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export async function setCheckpoint(taskId, stage) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[taskId] = { stage, scheduledAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}