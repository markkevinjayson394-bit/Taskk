import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { resolveTaskDueDate } from "./academicTaskModel";
import { warnIfDev } from "./logger";
import {
    mergePendingTasksWithOfflineQueue,
    readOfflineCreateQueue,
} from "./offlineTaskQueue";
import { isPlannerTask } from "./taskFilters";

function isIncompleteTask(task = {}) {
  if (!task) return false;
  if (task.completed === true || task.status === "done") return false;
  if (task.plannerArchived || isPlannerTask(task)) return false;
  return true;
}

async function readRemotePendingTasks(userId) {
  if (!userId) return [];
  const snap = await getDocs(
    query(
      collection(db, "assignments"),
      where("userId", "==", userId),
      where("completed", "==", false)
    )
  );
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export function getTaskDueAtMs(task) {
  const dueAt = resolveTaskDueDate(task);
  if (!(dueAt instanceof Date)) return null;
  const dueAtMs = dueAt.getTime();
  return Number.isFinite(dueAtMs) ? dueAtMs : null;
}

export function isSchedulablePendingTask(task = {}) {
  return isIncompleteTask(task) && Number.isFinite(getTaskDueAtMs(task));
}

export function getOverdueTasks(tasks = [], nowMs = Date.now()) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => {
      const dueAtMs = getTaskDueAtMs(task);
      return (
        isIncompleteTask(task) &&
        !isPlannerTask(task) &&
        Number.isFinite(dueAtMs) &&
        dueAtMs <= nowMs
      );
    })
    .sort((a, b) => getTaskDueAtMs(a) - getTaskDueAtMs(b));
}

export async function readSchedulablePendingTasks(
  userId,
  { warnContext = "pendingTasks" } = {}
) {
  if (!userId) return [];

  const [remoteResult, localResult] = await Promise.allSettled([
    readRemotePendingTasks(userId),
    readOfflineCreateQueue(userId),
  ]);

  if (remoteResult.status === "rejected") {
    warnIfDev(
      `[${warnContext}] remote pending lookup failed:`,
      remoteResult.reason
    );
  }
  if (localResult.status === "rejected") {
    warnIfDev(
      `[${warnContext}] local pending lookup failed:`,
      localResult.reason
    );
  }

  const remoteTasks =
    remoteResult.status === "fulfilled" ? remoteResult.value : [];
  const queueItems =
    localResult.status === "fulfilled" ? localResult.value : [];

  return mergePendingTasksWithOfflineQueue(remoteTasks, queueItems).filter(
    isSchedulablePendingTask
  );
}
