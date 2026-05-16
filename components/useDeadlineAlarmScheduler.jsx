/**
 * components/useDeadlineAlarmScheduler.js
 *
 * CHANGES IN THIS VERSION:
 * - [FIX] foregroundModalEnabled is now respected as true by default — when due
 *   time hits while app is foreground, modal opens automatically.
 * - [FIX] When modal opens from the interval checker (foreground), the shade
 *   notification for that task is cancelled immediately — no duplicate surfaces.
 * - [FIX] When modal opens for any alarm, all shade notifications for that task
 *   are cancelled so only the modal shows.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { isTaskCompleted } from "../utils/academicTaskModel";
import {
  DEADLINE_NOTIF_TYPE,
  displayAlarmNotification,
  displayLeadNotification,
} from "../utils/deadlineAlarmBackground";
import {
  FOREGROUND_THRESHOLDS,
  OVERDUE_CHAIN,
} from "../utils/deadlineConstants";
import { dismissDeadlinePresentations } from "../utils/deadlineNotifications";
import { warnIfDev } from "../utils/logger";
import { buildDeadlineNotificationId } from "../utils/notificationIds";
import {
  resolveCurrentOverdueStageInfo,
  resolveDailyAckBucket as resolveStoredDailyAckBucket,
} from "../utils/taskOverdueState";
import { parseDueDate, resolveTaskDueDate } from "./DeadlineAlarmModal.helpers";

const ACK_STORE_KEY = "deadline_alarm_acks_v1";
const ACK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 3_000;
const LEAD_STAGE_KEYS = new Set(["1d", "2h", "30m", "5m"]);
const PERSISTENT_ALARM_STAGE_KEYS = new Set([
  "due",
  "+15m",
  "+1h",
  "+3h",
  "daily",
]);

const OVERDUE_THRESHOLDS = OVERDUE_CHAIN.filter(
  ({ key }) => key !== "due" && key !== "daily"
).map(({ key, delayMs: ms }) => ({
  key,
  ms,
  window:
    ms === 15 * 60 * 1000
      ? 5 * 60 * 1000
      : ms === 60 * 60 * 1000
        ? 10 * 60 * 1000
        : 15 * 60 * 1000,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadAcks() {
  try {
    const r = await AsyncStorage.getItem(ACK_STORE_KEY);
    const raw = r ? JSON.parse(r) : {};
    const now = Date.now();
    const cleaned = {};
    for (const [key, val] of Object.entries(raw)) {
      const savedAt =
        typeof val === "object" && Number.isFinite(val.savedAt)
          ? val.savedAt
          : now;
      if (now - savedAt < ACK_EXPIRY_MS) {
        cleaned[key] = val;
      }
    }
    await AsyncStorage.setItem(ACK_STORE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch (err) {
    warnIfDev("useDeadlineAlarmScheduler: failed to parse ack storage:", err);
    return {};
  }
}

async function saveAcks(acks) {
  try {
    const stamped = {};
    for (const [key, val] of Object.entries(acks)) {
      stamped[key] =
        typeof val === "object"
          ? val
          : { triggered: true, savedAt: Date.now() };
    }
    await AsyncStorage.setItem(ACK_STORE_KEY, JSON.stringify(stamped));
  } catch (err) {
    warnIfDev("useDeadlineAlarmScheduler: failed to save acks:", err);
  }
}

function buildAckKey(taskId, thresholdKey) {
  return `${taskId}:${thresholdKey}`;
}

function formatLeadLabel(thresholdKey) {
  switch (thresholdKey) {
    case "1d":
      return "1 day";
    case "2h":
      return "2 hours";
    case "30m":
      return "30 min";
    case "5m":
      return "5 min";
    default:
      return "soon";
  }
}

function buildForegroundLeadTitle(thresholdKey) {
  return `\u23F0 Due in ${formatLeadLabel(thresholdKey)}`;
}

function buildForegroundLeadBody(task) {
  const due = resolveTaskDueDate(task);
  const taskTitle = task?.title ?? "Task";
  const subjectLabel = task?.subject ?? task?.subjectName ?? "General";
  if (!due) {
    return `${taskTitle} • ${subjectLabel}`;
  }

  const dueStr = due.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${taskTitle} • ${subjectLabel} — ${dueStr}`;
}

function getDailyAckBucket(dueMs, nowMs) {
  return resolveStoredDailyAckBucket(dueMs, nowMs);
}

function resolveAckKeyForThreshold(task, thresholdKey, nowMs) {
  if (!thresholdKey) return null;
  if (thresholdKey !== "daily") return thresholdKey;

  const due =
    resolveTaskDueDate(task) ?? (task?.dueAt ? parseDueDate(task.dueAt) : null);
  const dueMs = due?.getTime?.();
  const bucket = getDailyAckBucket(dueMs, nowMs);
  return bucket > 0 ? `daily_${bucket}` : "daily";
}

function findTriggeredThreshold(
  task,
  lastCheckedAt,
  nowMs,
  { deadlineWarningEnabled = true, pendingAcksRef } = {}
) {
  if (isTaskCompleted(task) || deadlineWarningEnabled === false) return null;

  const due = resolveTaskDueDate(task);
  if (!due) return null;

  const dueMs = due.getTime();
  if (nowMs >= dueMs) {
    const currentStageInfo = resolveCurrentOverdueStageInfo(dueMs, nowMs);
    if (!currentStageInfo?.key) return null;
    const ackKey = resolveAckKeyForThreshold(task, currentStageInfo.key, nowMs);
    if (!ackKey) return null;
    if (pendingAcksRef?.current?.has(buildAckKey(task.id, ackKey))) {
      return null;
    }
    return {
      thresholdKey: currentStageInfo.key,
      ackKey,
      intendedTriggerAtMs: currentStageInfo.triggerAtMs ?? null,
    };
  }

  for (const threshold of FOREGROUND_THRESHOLDS) {
    if (threshold.key === "due") continue;

    const triggerAt = dueMs - threshold.ms;
    const crossedSinceLast = triggerAt > lastCheckedAt && triggerAt <= nowMs;
    const withinWindow =
      nowMs >= triggerAt && nowMs <= triggerAt + threshold.window;

    if (crossedSinceLast || withinWindow) {
      const ackKey = threshold.key;
      if (pendingAcksRef?.current?.has(buildAckKey(task.id, ackKey))) {
        return null;
      }
      return { thresholdKey: threshold.key, ackKey };
    }
  }

  return null;
}

function saveOverdueAckEntries(acks, taskId, dueAt, nowMs) {
  const dueMs = parseDueDate(dueAt)?.getTime?.();
  if (!Number.isFinite(dueMs) || nowMs < dueMs) return;

  OVERDUE_THRESHOLDS.forEach((threshold) => {
    if (nowMs >= dueMs + threshold.ms) {
      acks[buildAckKey(taskId, threshold.key)] = true;
    }
  });

  const dailyBucket = getDailyAckBucket(dueMs, nowMs);
  for (let bucket = 1; bucket <= dailyBucket; bucket += 1) {
    acks[buildAckKey(taskId, `daily_${bucket}`)] = true;
  }
}

/**
 * [FIX] Cancel ALL shade notifications for a task when modal opens —
 * covers due, all overdue stages, and display variants.
 * This prevents the modal + shade duplicate.
 */
async function cancelAllShadeNotificationsForTask(taskId) {
  if (!taskId) return;
  await dismissDeadlinePresentations(taskId);
}

async function cancelNotifeeAlarmNotifications(alarmEntry) {
  if (!alarmEntry?.task?.id) return;
  await dismissDeadlinePresentations(alarmEntry.task.id, {
    thresholdKey: alarmEntry.thresholdKey || null,
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDeadlineAlarmScheduler(
  pendingTasks = [],
  { deadlineWarningEnabled = true, foregroundModalEnabled = true } = {}
) {
  const [alarmVisible, setAlarmVisible] = useState(false);
  const alarmQueueRef = useRef([]);
  const checkAlarmsRef = useRef(null);
  const [activeAlarm, setActiveAlarm] = useState(null);
  const acksRef = useRef({});
  const [acksLoaded, setAcksLoaded] = useState(false);
  const lastCheckedAtRef = useRef(Date.now() - 2_000);
  const prevTaskIdsRef = useRef(new Set());
  const pendingAcksRef = useRef(new Set());

  const activateNextAlarm = useCallback(() => {
    const next = alarmQueueRef.current.shift() || null;
    setActiveAlarm(next);
    setAlarmVisible(Boolean(next));

    // [FIX] When a modal activates, cancel all shade notifications for that
    // task immediately — no duplicate modal + shade surfaces.
    if (next?.task?.id) {
      cancelAllShadeNotificationsForTask(next.task.id).catch(() => {});
    }
  }, []);

  const dismissAlarm = useCallback(() => {
    setAlarmVisible(false);
    setActiveAlarm(null);
  }, []);

  useEffect(() => {
    loadAcks()
      .then((a) => {
        acksRef.current = a;
        setAcksLoaded(true);
      })
      .catch((err) => {
        warnIfDev("useDeadlineAlarmScheduler: failed to load acks:", err);
        acksRef.current = {};
        setAcksLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (deadlineWarningEnabled !== false) return;
    alarmQueueRef.current = [];
    setAlarmVisible(false);
    setActiveAlarm(null);
  }, [deadlineWarningEnabled]);

  const checkAlarms = useCallback(() => {
    if (!pendingTasks?.length) {
      return;
    }

    const nowMs = Date.now();
    const lastCheckedAt = lastCheckedAtRef.current || nowMs;
    lastCheckedAtRef.current = nowMs;

    if (deadlineWarningEnabled === false) {
      return;
    }

    for (const task of pendingTasks) {
      if (isTaskCompleted(task)) continue;

      const triggered = findTriggeredThreshold(task, lastCheckedAt, nowMs, {
        deadlineWarningEnabled,
        pendingAcksRef,
      });
      if (!triggered) continue;

      const key = buildAckKey(task.id, triggered.ackKey);
      if (acksRef.current[key]) continue;

      // [FIX] foregroundModalEnabled is now true by default.
      // When false: only post shade notification (background-only mode).
      // When true: open modal AND cancel the shade notification.
      if (foregroundModalEnabled === false) {
        // Background-only mode: post shade notification, skip modal.
        if (
          AppState.currentState === "active" &&
          Platform.OS === "android" &&
          (LEAD_STAGE_KEYS.has(triggered.thresholdKey) ||
            PERSISTENT_ALARM_STAGE_KEYS.has(triggered.thresholdKey))
        ) {
          const due = resolveTaskDueDate(task);
          const dueAtMs = due?.getTime() ?? null;
          const notifId = buildDeadlineNotificationId(
            task.id,
            triggered.thresholdKey
          );
          const subjectLabel = task.subject ?? task.subjectName ?? "General";
          const baseData = {
            type: DEADLINE_NOTIF_TYPE,
            notificationType: DEADLINE_NOTIF_TYPE,
            taskId: task.id,
            taskTitle: task.title ?? "",
            subject: subjectLabel,
            dueAtMs,
            stage: triggered.thresholdKey,
            intendedTriggerAtMs: triggered.intendedTriggerAtMs ?? null,
            scheduledAtMs: Date.now(),
            deliveryPath: "foreground_catchup",
          };
          if (LEAD_STAGE_KEYS.has(triggered.thresholdKey)) {
            displayLeadNotification({
              id: notifId,
              title: buildForegroundLeadTitle(triggered.thresholdKey),
              body: buildForegroundLeadBody(task),
              data: {
                ...baseData,
                acknowledgeRequired: false,
                isLeadTime: true,
                alarmKind: "lead_notice",
              },
            }).catch(() => {});
          } else {
            displayAlarmNotification({
              id: notifId,
              title: `⏰ ${task.title ?? "Task"} is due NOW`,
              body: `"${task.title}" (${subjectLabel}) — tap Open or Not Done.`,
              data: {
                type: DEADLINE_NOTIF_TYPE,
                notificationType: DEADLINE_NOTIF_TYPE,
                taskId: task.id,
                taskTitle: task.title ?? "",
                subject: subjectLabel,
                dueAtMs,
                acknowledgeRequired: true,
                isLeadTime: false,
                stage: triggered.thresholdKey,
                intendedTriggerAtMs: triggered.intendedTriggerAtMs ?? null,
                scheduledAtMs: Date.now(),
                deliveryPath: "foreground_catchup",
              },
              isOngoing: true,
            }).catch(() => {});
          }
        }
        pendingAcksRef.current.add(key);
        continue;
      }

      // [FIX] foregroundModalEnabled === true:
      // Modal opens. Shade notification is cancelled inside activateNextAlarm
      // via cancelAllShadeNotificationsForTask. Do NOT post a duplicate shade
      // notification here when the modal is going to open.
      pendingAcksRef.current.add(key);

      if (
        alarmQueueRef.current.find(
          (q) =>
            q.taskId === task.id && q.thresholdKey === triggered.thresholdKey
        )
      )
        continue;

      alarmQueueRef.current.push({
        taskId: task.id,
        task,
        thresholdKey: triggered.thresholdKey,
        ackKey: triggered.ackKey,
      });
    }

    if (!activeAlarm && alarmQueueRef.current.length > 0) {
      activateNextAlarm();
    }
  }, [
    activeAlarm,
    activateNextAlarm,
    deadlineWarningEnabled,
    foregroundModalEnabled,
    pendingTasks,
  ]);

  useEffect(() => {
    if (activeAlarm) return;
    if (alarmQueueRef.current.length === 0) return;
    activateNextAlarm();
  }, [activeAlarm, activateNextAlarm]);

  useEffect(() => {
    checkAlarmsRef.current = checkAlarms;
  }, [checkAlarms]);

  useEffect(() => {
    let appStateSub = null;
    const handleAppStateChange = (nextState) => {
      if (nextState === "active") {
        lastCheckedAtRef.current = Date.now() - CHECK_INTERVAL_MS - 1500;
        checkAlarmsRef.current?.();
      }
    };

    if (AppState.addEventListener) {
      appStateSub = AppState.addEventListener("change", handleAppStateChange);
    }

    return () => {
      if (appStateSub) {
        appStateSub.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (!acksLoaded) return;
    lastCheckedAtRef.current = Date.now() - 2_000;
    checkAlarmsRef.current?.();
    const id = setInterval(() => {
      lastCheckedAtRef.current = Math.min(
        lastCheckedAtRef.current,
        Date.now() - CHECK_INTERVAL_MS - 500
      );
      checkAlarmsRef.current?.();
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [acksLoaded]);

  useEffect(() => {
    const currentIds = new Set(pendingTasks.map((t) => t.id));
    const hasNewTask = [...currentIds].some(
      (id) => !prevTaskIdsRef.current.has(id)
    );
    if (hasNewTask) {
      lastCheckedAtRef.current = Date.now() - CHECK_INTERVAL_MS - 1000;
    }
    prevTaskIdsRef.current = currentIds;
    checkAlarmsRef.current?.();
  }, [pendingTasks]);

  const persistCurrentAlarmAck = useCallback(async () => {
    if (!activeAlarm) return;

    const nowMs = Date.now();
    let resolvedThreshold = null;
    if (activeAlarm.thresholdKey) {
      resolvedThreshold = {
        thresholdKey: activeAlarm.thresholdKey,
        ackKey:
          activeAlarm.ackKey ||
          resolveAckKeyForThreshold(
            activeAlarm.task,
            activeAlarm.thresholdKey,
            nowMs
          ),
      };
    } else {
      resolvedThreshold = findTriggeredThreshold(
        activeAlarm.task,
        nowMs - CHECK_INTERVAL_MS,
        nowMs,
        { deadlineWarningEnabled: true }
      );
    }

    if (resolvedThreshold?.ackKey) {
      acksRef.current[
        buildAckKey(activeAlarm.task.id, resolvedThreshold.ackKey)
      ] = true;
    }
    saveOverdueAckEntries(
      acksRef.current,
      activeAlarm.task.id,
      resolveTaskDueDate(activeAlarm.task)?.toISOString() ??
        activeAlarm.task?.dueAt,
      nowMs
    );
    await saveAcks(acksRef.current);
    if (resolvedThreshold?.ackKey) {
      pendingAcksRef.current.delete(
        buildAckKey(activeAlarm.task.id, resolvedThreshold.ackKey)
      );
    }
  }, [activeAlarm]);

  const acknowledgeAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    await cancelNotifeeAlarmNotifications(activeAlarm);
    await persistCurrentAlarmAck();
    activateNextAlarm();
  }, [activeAlarm, activateNextAlarm, persistCurrentAlarmAck]);

  const markDoneAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    await cancelNotifeeAlarmNotifications(activeAlarm);
    await persistCurrentAlarmAck();
    activateNextAlarm();
  }, [activeAlarm, activateNextAlarm, persistCurrentAlarmAck]);

  const showAlarmForTask = useCallback(
    (task, thresholdKey = null) => {
      if (!task || isTaskCompleted(task)) {
        return;
      }

      if (activeAlarm && activeAlarm.taskId === task.id) {
        if (thresholdKey && thresholdKey !== activeAlarm.thresholdKey) {
          setActiveAlarm((prev) =>
            prev ? { ...prev, thresholdKey, task } : prev
          );
        }
        setAlarmVisible(true);
        // [FIX] Cancel shade notifications when modal becomes visible
        cancelAllShadeNotificationsForTask(task.id).catch(() => {});
        return;
      }

      const entry = {
        taskId: task.id,
        task,
        thresholdKey,
        ackKey: resolveAckKeyForThreshold(task, thresholdKey, Date.now()),
      };

      const existingIdx = alarmQueueRef.current.findIndex(
        (q) => q.taskId === task.id
      );
      if (existingIdx !== -1) {
        if (thresholdKey) {
          alarmQueueRef.current[existingIdx] = {
            ...alarmQueueRef.current[existingIdx],
            thresholdKey,
            task,
            ackKey: resolveAckKeyForThreshold(task, thresholdKey, Date.now()),
          };
        }
        if (!activeAlarm && existingIdx === 0) {
          activateNextAlarm();
        }
        return;
      }

      alarmQueueRef.current.push(entry);
      if (!activeAlarm) {
        activateNextAlarm();
      }
    },
    [activeAlarm, activateNextAlarm]
  );

  const snoozeAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    await cancelNotifeeAlarmNotifications(activeAlarm);
    activateNextAlarm();
  }, [activeAlarm, activateNextAlarm]);

  const notDoneAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    await cancelNotifeeAlarmNotifications(activeAlarm);
    await persistCurrentAlarmAck();
    activateNextAlarm();
  }, [activeAlarm, activateNextAlarm, persistCurrentAlarmAck]);

  return {
    alarmVisible,
    alarmTask: activeAlarm?.task ?? null,
    alarmThresholdKey: activeAlarm?.thresholdKey ?? null,
    acknowledgeAlarm,
    notDoneAlarm,
    dismissAlarm,
    markDoneAlarm,
    showAlarmForTask,
    snoozeAlarm,
  };
}
