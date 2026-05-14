  import AsyncStorage from "@react-native-async-storage/async-storage";
  import { normalizeTaskDateInput } from "./academicTaskModel";
  import { warnIfDev } from "./logger";

  export const LOCAL_TASK_ID_PREFIX = "local_";
  export const PENDING_CREATE_KEY = (uid) => `pending_create_${uid}`;

  const TASK_DATE_FIELDS = [
    "dueAt",
    "createdAt",
    "completedAt",
    "updatedAt",
    "startedAt",
    "customReminderAt",
  ];

  function isFirestoreSentinel(value) {
    // Firestore FieldValue sentinels have an internal _methodName property
    return (
      value !== null &&
      typeof value === "object" &&
      typeof value._methodName === "string"
    );
  }

  function hydrateTaskDates(task = {}) {
    const hydrated = { ...task };
    TASK_DATE_FIELDS.forEach((field) => {
      const val = task[field];
      if (isFirestoreSentinel(val)) {
        // Replace sentinel with current time so the queue item isn't dropped
        hydrated[field] = new Date();
        warnIfDev(`offlineTaskQueue: replaced Firestore sentinel in field "${field}" with Date.now()`);
        return;
      }
      if (val === null) {
        hydrated[field] = null;
        return;
      }
      const parsed = normalizeTaskDateInput(val);
      if (parsed) {
        hydrated[field] = parsed;
      } else if (val === undefined) {
        delete hydrated[field];
      } else {
        delete hydrated[field];
      }
    });
    return hydrated;
  }

  function normalizeQueueItem(item = {}) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) return null;

    const payload =
      item?.payload && typeof item.payload === "object"
        ? hydrateTaskDates(item.payload)
        : null;
    if (!payload) return null;

    const queuedAtDate = normalizeTaskDateInput(item?.queuedAt) || new Date();
    return {
      id,
      payload,
      queuedAt: queuedAtDate.toISOString(),
    };
  }

  export function isLocalOnlyTaskId(taskId) {
    return typeof taskId === "string" && taskId.startsWith(LOCAL_TASK_ID_PREFIX);
  }

  export function buildOfflineTaskFromQueueItem(item) {
    const normalized = normalizeQueueItem(item);
    if (!normalized) return null;
    const { id: _ignoredId, ...restPayload } = normalized.payload;
    return {
      ...restPayload,
      id: normalized.id,
      localOnly: true,
      queuedAt: normalized.queuedAt,
    };
  }

  export function mergePendingTasksWithOfflineQueue(
    pendingTasks = [],
    queueItems = []
  ) {
    const merged = new Map();
    pendingTasks.forEach((task) => {
      if (!task?.id) return;
      merged.set(task.id, task);
    });
    queueItems.forEach((item) => {
      const task = buildOfflineTaskFromQueueItem(item);
      if (!task?.id || merged.has(task.id)) return;
      merged.set(task.id, task);
    });
    return Array.from(merged.values());
  }

  export async function readOfflineCreateQueue(uid) {
    try {
      const raw = await AsyncStorage.getItem(PENDING_CREATE_KEY(uid));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeQueueItem).filter(Boolean);
    } catch (err) {
      warnIfDev("offlineTaskQueue: failed to read create queue:", err);
      return [];
    }
  }

  export async function writeOfflineCreateQueue(uid, queue) {
    try {
      const normalized = Array.isArray(queue)
        ? queue.map(normalizeQueueItem).filter(Boolean)
        : [];
      if (!normalized.length) {
        await AsyncStorage.removeItem(PENDING_CREATE_KEY(uid));
        return;
      }
      await AsyncStorage.setItem(
        PENDING_CREATE_KEY(uid),
        JSON.stringify(normalized)
      );
    } catch (err) {
      warnIfDev("offlineTaskQueue: failed to write create queue:", err);
      throw err;
    }
  }

  export async function findOfflineQueuedTask(uid, taskId) {
    const queue = await readOfflineCreateQueue(uid);
    const item = queue.find((entry) => entry.id === taskId);
    return buildOfflineTaskFromQueueItem(item);
  }

  export async function removeOfflineQueuedTask(uid, taskId) {
    const queue = await readOfflineCreateQueue(uid);
    const next = queue.filter((item) => item.id !== taskId);
    await writeOfflineCreateQueue(uid, next);
    return next;
  }

  export function prepareQueuedTaskPayloadForFirestore(payload = {}) {
    return hydrateTaskDates(payload);
  }
