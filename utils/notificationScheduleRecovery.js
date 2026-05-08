import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_RESCHEDULE_KEY = "pending_reschedule_v1";
const TASK_RESCHEDULE_PREFIX = "reschedule_intent_v1";

function buildTaskReschedulePrefix(uid) {
  return `${TASK_RESCHEDULE_PREFIX}:${uid}:`;
}

function parseJson(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function readPendingNotificationReschedule() {
  const raw = await AsyncStorage.getItem(PENDING_RESCHEDULE_KEY);
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed.uid !== "string" || !parsed.uid) return null;
  return parsed;
}

export async function writePendingNotificationReschedule({
  uid,
  taskId = null,
  reason = "manual_refresh",
  queuedAt = Date.now(),
} = {}) {
  if (typeof uid !== "string" || !uid) return;
  const payload = {
    uid,
    taskId: typeof taskId === "string" && taskId.trim() ? taskId.trim() : null,
    reason:
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : "manual_refresh",
    queuedAt:
      Number.isFinite(Number(queuedAt)) && Number(queuedAt) > 0
        ? Number(queuedAt)
        : Date.now(),
  };
  await AsyncStorage.setItem(PENDING_RESCHEDULE_KEY, JSON.stringify(payload));
}

export async function clearPendingNotificationReschedule(uid = null) {
  if (typeof uid === "string" && uid) {
    const current = await readPendingNotificationReschedule();
    if (current?.uid && current.uid !== uid) return;
  }
  await AsyncStorage.removeItem(PENDING_RESCHEDULE_KEY);
}

export function getTaskRescheduleIntentKey(uid, taskId) {
  if (typeof uid !== "string" || !uid) return "";
  if (typeof taskId !== "string" || !taskId.trim()) return "";
  return `${buildTaskReschedulePrefix(uid)}${taskId.trim()}`;
}

export async function writeTaskRescheduleIntent(
  uid,
  taskId,
  { reason = "task_update", queuedAt = Date.now() } = {}
) {
  const key = getTaskRescheduleIntentKey(uid, taskId);
  if (!key) return;
  const payload = {
    uid,
    taskId: taskId.trim(),
    reason:
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : "task_update",
    queuedAt:
      Number.isFinite(Number(queuedAt)) && Number(queuedAt) > 0
        ? Number(queuedAt)
        : Date.now(),
  };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

export async function clearTaskRescheduleIntent(uid, taskId) {
  const key = getTaskRescheduleIntentKey(uid, taskId);
  if (!key) return;
  await AsyncStorage.removeItem(key);
}

export async function listTaskRescheduleIntents(uid) {
  if (typeof uid !== "string" || !uid) return [];
  const prefix = buildTaskReschedulePrefix(uid);
  const keys = await AsyncStorage.getAllKeys();
  return keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((taskId) => typeof taskId === "string" && taskId);
}

export async function clearTaskRescheduleIntents(uid, taskIds = null) {
  if (typeof uid !== "string" || !uid) return;
  const resolvedTaskIds = Array.isArray(taskIds)
    ? taskIds.filter((taskId) => typeof taskId === "string" && taskId)
    : await listTaskRescheduleIntents(uid);
  if (resolvedTaskIds.length === 0) return;
  const keys = resolvedTaskIds
    .map((taskId) => getTaskRescheduleIntentKey(uid, taskId))
    .filter(Boolean);
  if (keys.length === 0) return;
  await AsyncStorage.multiRemove(keys);
}
