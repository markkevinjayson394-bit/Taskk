/**
 * utils/overdueAutoLaunch.js
 *
 * Queries Firestore and the local offline create queue for the most overdue
 * incomplete task.
 *
 * This is Android-only. On iOS the launcher function is a no-op.
 *
 * Cooldown: once triggered, will not re-trigger for COOLDOWN_MS to avoid
 * spamming the user every time they resume the app.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "../config/firebase";
import { DEADLINE_NOTIF_TYPE } from "./deadlineAlarmBackground";
import { warnIfDev } from "./logger";
import {
    canScheduleExactAlarms,
    isNativeAlarmSupported,
    scheduleNativeAlarm,
} from "./nativeAlarm";
import {
    buildManagedNotificationData,
    buildNotificationId,
} from "./notificationIds";
import {
    buildOfflineTaskFromQueueItem,
    readOfflineCreateQueue,
} from "./offlineTaskQueue";
import { isPlannerTask } from "./taskFilters";
import { resolveCurrentOverdueStageInfo } from "./taskOverdueState";

const COOLDOWN_MS = 5 * 60 * 1000;
const COOLDOWN_KEY = "overdue_auto_launch_last_triggered_v1";
const TRIGGER_DELAY_MS = 3_000;
const RECOVERY_STAGE_KEYS = new Set(["+15m", "+1h", "+3h", "daily"]);

function getTaskDueAtMs(task) {
  const raw = task?.dueAt;
  // Firestore Timestamp objects have a .toDate() method
  const normalized = typeof raw?.toDate === "function" ? raw.toDate() : raw;
  const dueAtMs = new Date(normalized).getTime();
  return Number.isFinite(dueAtMs) ? dueAtMs : null;
}

async function getMostOverdueRemoteTask(userId) {
  const now = new Date();
  const q = query(
    collection(db, "assignments"),
    where("userId", "==", userId),
    where("completed", "==", false),
    where("dueAt", "<=", now),
    orderBy("dueAt", "asc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  const task = { id: docSnap.id, ...docSnap.data() };
  if (isPlannerTask(task)) return null;
  if (task.status === "done" || task.completed === true) return null;
  return task;
}

async function getMostOverdueLocalTask(userId) {
  const queue = await readOfflineCreateQueue(userId);
  const nowMs = Date.now();
  const overdueTasks = queue
    .map((item) => buildOfflineTaskFromQueueItem(item))
    .filter((task) => {
      if (!task || isPlannerTask(task)) return false;
      if (task.status === "done" || task.completed === true) return false;
      const dueAtMs = getTaskDueAtMs(task);
      return Number.isFinite(dueAtMs) && dueAtMs <= nowMs;
    })
    .sort((a, b) => getTaskDueAtMs(a) - getTaskDueAtMs(b));
  return overdueTasks[0] || null;
}

function pickMostOverdueTask(tasks = []) {
  return (
    tasks
      .filter(Boolean)
      .sort((a, b) => getTaskDueAtMs(a) - getTaskDueAtMs(b))[0] || null
  );
}

export async function getMostOverdueTask(userId) {
  if (!userId) return null;

  const [remoteResult, localResult] = await Promise.allSettled([
    getMostOverdueRemoteTask(userId),
    getMostOverdueLocalTask(userId),
  ]);

  if (remoteResult.status === "rejected") {
    warnIfDev(
      "[overdueAutoLaunch] remote overdue lookup failed:",
      remoteResult.reason
    );
  }
  if (localResult.status === "rejected") {
    warnIfDev(
      "[overdueAutoLaunch] local overdue lookup failed:",
      localResult.reason
    );
  }

  return pickMostOverdueTask([
    remoteResult.status === "fulfilled" ? remoteResult.value : null,
    localResult.status === "fulfilled" ? localResult.value : null,
  ]);
}

async function isInCooldown(userId) {
  const key = `${COOLDOWN_KEY}_${userId}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    const lastTriggered = Number(raw);
    if (!Number.isFinite(lastTriggered)) return false;
    return Date.now() - lastTriggered < COOLDOWN_MS;
  } catch {
    return false;
  }
}

async function stampCooldown(userId) {
  const key = `${COOLDOWN_KEY}_${userId}`;
  try {
    await AsyncStorage.setItem(key, String(Date.now()));
  } catch {
    // non-critical
  }
}

export async function checkAndAutoLaunchOverdueAlarm(userId, opts = {}) {
  if (Platform.OS !== "android") return;
  if (!isNativeAlarmSupported) return;
  if (opts.hasPendingAction) return;
  if (!opts.skipCooldown && (await isInCooldown(userId))) return;

  const exactResult = await canScheduleExactAlarms();
  if (exactResult?.status !== "success" || exactResult?.value !== true) {
    warnIfDev(
      "[overdueAutoLaunch] Exact alarm permission not granted - skipping"
    );
    return;
  }

  const task = await getMostOverdueTask(userId);
  if (!task) return;

  const dueAtMs = getTaskDueAtMs(task);
  if (!Number.isFinite(dueAtMs)) return;
  const currentStageInfo = resolveCurrentOverdueStageInfo(dueAtMs, Date.now());
  const stageKey =
    typeof currentStageInfo?.key === "string" ? currentStageInfo.key : "due";
  if (!RECOVERY_STAGE_KEYS.has(stageKey)) {
    warnIfDev(
      `[overdueAutoLaunch] Skipping auto-launch for ${task.id}: native due alarm should own the due moment`
    );
    return;
  }
  const taskTitle =
    typeof task.title === "string" && task.title.trim()
      ? task.title.trim()
      : "Task";
  const subject = task.subject ?? task.subjectName ?? "General";
  const overdueMin = Math.round((Date.now() - dueAtMs) / 60_000);
  const body =
    '"' +
    taskTitle +
    '" (' +
    subject +
    ") is " +
    overdueMin +
    " min overdue. Mark it done or acknowledge.";

  const alarmId = buildNotificationId("auto-overdue", task.id, "open");
  const payload = buildManagedNotificationData(alarmId, {
    type: DEADLINE_NOTIF_TYPE,
    notificationType: DEADLINE_NOTIF_TYPE,
    taskId: task.id,
    taskTitle,
    subject,
    dueAtMs: Number.isFinite(dueAtMs) ? dueAtMs : null,
    acknowledgeRequired: true,
    stage: stageKey,
    intendedTriggerAtMs: currentStageInfo?.triggerAtMs ?? dueAtMs,
    scheduledAtMs: Date.now(),
    deliveryPath: "app_open_catchup",
  });

  const result = await scheduleNativeAlarm({
    alarmId,
    triggerAt: Date.now() + TRIGGER_DELAY_MS,
    title: "Task Overdue",
    body,
    payload,
  });

  if (result) {
    warnIfDev(
      '[overdueAutoLaunch] Scheduled auto-launch alarm for task "' +
        taskTitle +
        '" (' +
        task.id +
        ")"
    );
    await stampCooldown(userId);
  } else {
    warnIfDev(
      "[overdueAutoLaunch] scheduleNativeAlarm returned null - alarm not scheduled"
    );
  }
}
