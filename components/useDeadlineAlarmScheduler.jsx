import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseDueDate } from "./DeadlineAlarmModal.helpers";
import { warnIfDev } from "../utils/logger";

const ACK_STORE_KEY = "deadline_alarm_acks_v1";
const ACK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CHECK_INTERVAL_MS = 15_000;
const OVERDUE_BUCKET_MS = 5 * 60 * 1000;

export const FOREGROUND_THRESHOLDS = [
  { key: "1d", ms: 24 * 60 * 60 * 1000, window: 5 * 60 * 1000 },
  { key: "2h", ms: 2 * 60 * 60 * 1000, window: 3 * 60 * 1000 },
  { key: "30m", ms: 30 * 60 * 1000, window: 2 * 60 * 1000 },
  { key: "due", ms: 0, window: 10 * 60 * 1000 },
];

async function loadAcks() {
  try {
    const r = await AsyncStorage.getItem(ACK_STORE_KEY);
    const raw = r ? JSON.parse(r) : {};
    const now = Date.now();
    const cleaned = {};
    for (const [key, val] of Object.entries(raw)) {
      const savedAt = typeof val === "object" && Number.isFinite(val.savedAt) ? val.savedAt : now;
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
      stamped[key] = typeof val === "object" ? val : { triggered: true, savedAt: Date.now() };
    }
    await AsyncStorage.setItem(ACK_STORE_KEY, JSON.stringify(stamped));
  } catch (err) {
    warnIfDev("useDeadlineAlarmScheduler: failed to save acks:", err);
  }
}

function ackKey(taskId, thresholdKey) {
  return `${taskId}:${thresholdKey}`;
}

function findTriggeredThreshold(task, lastCheckedAt, nowMs) {
  if (task?.completed) return null;

  const due = parseDueDate(task?.dueAt);
  if (!due) return null;

  const dueMs = due.getTime();
  if (nowMs >= dueMs) {
    const crossedDue = dueMs > lastCheckedAt && dueMs <= nowMs;
    if (crossedDue) {
      return "due";
    }
    const overdueBucket = Math.floor((nowMs - dueMs) / OVERDUE_BUCKET_MS);
    return `overdue_${overdueBucket}`;
  }

  for (const threshold of FOREGROUND_THRESHOLDS) {
    if (threshold.key === "due") continue;

    const triggerAt = dueMs - threshold.ms;
    const crossedSinceLast = triggerAt > lastCheckedAt && triggerAt <= nowMs;
    const withinWindow = nowMs >= triggerAt && nowMs <= triggerAt + threshold.window;

    if (crossedSinceLast || withinWindow) {
      return threshold.key;
    }
  }

  return null;
}

function saveOverdueAckBuckets(acks, taskId, dueAt, nowMs) {
  const dueMs = parseDueDate(dueAt)?.getTime?.();
  if (!Number.isFinite(dueMs) || nowMs < dueMs) return;

  const currentBucket = Math.floor((nowMs - dueMs) / OVERDUE_BUCKET_MS);
  for (let bucket = 0; bucket <= currentBucket; bucket += 1) {
    acks[ackKey(taskId, `overdue_${bucket}`)] = true;
  }
}

export function useDeadlineAlarmScheduler(pendingTasks = []) {
  const [alarmVisible, setAlarmVisible] = useState(false);
  const alarmQueueRef = useRef([]);
  const [activeAlarm, setActiveAlarm] = useState(null);
  const acksRef = useRef({});
  const lastCheckedAtRef = useRef(Date.now());

  const dismissAlarm = useCallback(() => {
    setAlarmVisible(false);
    setActiveAlarm(null);
  }, []);

  useEffect(() => {
    loadAcks()
      .then((a) => {
        acksRef.current = a;
      })
      .catch((err) => {
        warnIfDev("useDeadlineAlarmScheduler: failed to load acks:", err);
        acksRef.current = {};
      });
  }, []);

  const checkAlarms = useCallback(() => {
    const nowMs = Date.now();
    const lastCheckedAt = lastCheckedAtRef.current || nowMs;
    lastCheckedAtRef.current = nowMs;

    for (const task of pendingTasks) {
      if (task?.completed) continue;

      const triggeredThreshold = findTriggeredThreshold(task, lastCheckedAt, nowMs);
      if (!triggeredThreshold) continue;

      const key = ackKey(task.id, triggeredThreshold);
      if (acksRef.current[key]) continue;

      // Check not already in queue
      if (alarmQueueRef.current.find(q => q.taskId === task.id)) continue;

      alarmQueueRef.current.push({ taskId: task.id, task, thresholdKey: triggeredThreshold });
    }

    if (!activeAlarm && alarmQueueRef.current.length > 0) {
      setActiveAlarm(alarmQueueRef.current[0]);
      setAlarmVisible(true);
    }
  }, [activeAlarm, pendingTasks]);

  useEffect(() => {
    lastCheckedAtRef.current = Date.now();
    checkAlarms();
    const id = setInterval(checkAlarms, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkAlarms]);

  const persistCurrentAlarmAck = useCallback(async () => {
    if (!activeAlarm) return;

    const nowMs = Date.now();
    let resolvedThresholdKey = activeAlarm.thresholdKey;
    if (!resolvedThresholdKey) {
      const task = activeAlarm.task;
      resolvedThresholdKey = findTriggeredThreshold(
        task,
        nowMs - CHECK_INTERVAL_MS,
        nowMs
      );
    }

    if (resolvedThresholdKey) {
      acksRef.current[ackKey(activeAlarm.task.id, resolvedThresholdKey)] = true;
    }
    saveOverdueAckBuckets(acksRef.current, activeAlarm.task.id, activeAlarm.task?.dueAt, nowMs);
    await saveAcks(acksRef.current);
  }, [activeAlarm]);

  const acknowledgeAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    await persistCurrentAlarmAck();
    alarmQueueRef.current.shift();
    const next = alarmQueueRef.current[0] || null;
    setActiveAlarm(next);
    setAlarmVisible(!!next);
  }, [activeAlarm, persistCurrentAlarmAck]);

  const markDoneAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    await persistCurrentAlarmAck();
    alarmQueueRef.current.shift();
    const next = alarmQueueRef.current[0] || null;
    setActiveAlarm(next);
    setAlarmVisible(!!next);
  }, [activeAlarm, persistCurrentAlarmAck]);

  const showAlarmForTask = useCallback((task, thresholdKey = null) => {
    if (!task || task?.completed) return;
    const entry = { taskId: task.id, task, thresholdKey };
    if (alarmQueueRef.current.find(q => q.taskId === task.id)) return;
    alarmQueueRef.current.push(entry);
    if (!activeAlarm) {
      setActiveAlarm(entry);
      setAlarmVisible(true);
    }
  }, [activeAlarm]);

  const snoozeAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    alarmQueueRef.current.shift();
    const next = alarmQueueRef.current[0] || null;
    setActiveAlarm(next);
    setAlarmVisible(!!next);
  }, [activeAlarm]);

  return {
    alarmVisible,
    alarmTask: activeAlarm?.task ?? null,
    alarmThresholdKey: activeAlarm?.thresholdKey ?? null,
    acknowledgeAlarm,
    dismissAlarm,
    markDoneAlarm,
    showAlarmForTask,
    snoozeAlarm,
  };
}
