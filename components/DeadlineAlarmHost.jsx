import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeadlineAlarmModal, {
  useDeadlineAlarmScheduler,
} from "./DeadlineAlarmModal";
import { auth, getDb } from "../config/firebase";
import { useNotifications } from "../context/NotificationContext";
import {
  CACHE_KEYS,
  OFFLINE_QUEUE_KEYS,
  loadFromCache,
  saveToCache,
  useOffline,
} from "../context/OfflineContext";
import {
  logAlarmHostDuplicateSuppressed,
  logForegroundCatchupSuppressed,
  logStartupHandoffSkipped,
} from "../utils/alarmDiagnostics";
import {
  buildTaskCompletionUpdate,
  isTaskCompleted,
  normalizeTaskDateInput,
} from "../utils/academicTaskModel";
import { cancelDeadlineAlarms } from "../utils/deadlineAlarmBackground";
import { warnIfDev } from "../utils/logger";
import { forceStopNativeAlarm, stopActiveNativeAlarm } from "../utils/nativeAlarm";
import {
  findOfflineQueuedTask,
  isLocalOnlyTaskId,
  mergePendingTasksWithOfflineQueue,
  removeOfflineQueuedTask,
  readOfflineCreateQueue,
} from "../utils/offlineTaskQueue";
import { subscribeDeadlineAlarmOpenRequests } from "../utils/deadlineAlarmBridge";
import { publishTaskMutation } from "../utils/taskMutationBridge";

const CATCHUP_SUPPRESSION_MS = 60 * 1000;

function normalizeDateToISO(value) {
  const parsed = normalizeTaskDateInput(value);
  return parsed ? parsed.toISOString() : value;
}

function normalizeAssignmentDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    ...data,
    dueAt: normalizeDateToISO(data.dueAt),
    createdAt: normalizeDateToISO(data.createdAt),
    completedAt: normalizeDateToISO(data.completedAt),
  };
}

function getRequestKey(request = {}) {
  return [
    request.focusTaskId,
    request.alarmStage || "none",
    request.dueAtMs || "none",
    request.sourceId || "none",
    request.alarmAction || "open",
  ].join(":");
}

function getTaskDueAtMs(task) {
  const direct = Number(task?.dueAtMs);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return normalizeTaskDateInput(task?.dueAt)?.getTime?.() ?? null;
}

function getSessionKey({ taskId, stage, dueAtMs, sourceId }) {
  return [
    taskId || "none",
    stage || "none",
    Number.isFinite(Number(dueAtMs)) ? String(Number(dueAtMs)) : "none",
    sourceId || "none",
  ].join(":");
}

async function settleNativeAlarmHandoff() {
  const withTimeout = (promise) =>
    Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
    ]).catch(() => false);

  const stopped = await withTimeout(stopActiveNativeAlarm());
  if (!stopped) {
    await withTimeout(forceStopNativeAlarm());
  }
}

async function queueOfflineCompletion(uid, taskId, queuedAt = new Date()) {
  if (!uid || !taskId) return [];
  const key = OFFLINE_QUEUE_KEYS.completeAssignments(uid);
  let current = [];

  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    current = Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    current = [];
  }

  const next = [
    ...current.filter((item) => item?.id !== taskId),
    {
      id: taskId,
      action: "complete",
      queuedAt:
        normalizeTaskDateInput(queuedAt)?.toISOString?.() ??
        new Date().toISOString(),
    },
  ];

  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

export default function DeadlineAlarmHost() {
  const { isOnline, refreshPendingSyncSummary } = useOffline();
  const {
    settings: notificationSettings,
    clearTaskAlarmSuppression,
    rescheduleAll,
  } = useNotifications() ?? {};
  const [tasks, setTasks] = useState([]);
  const [session, setSession] = useState(null);
  const [suppressionVersion, setSuppressionVersion] = useState(0);
  const handledSourceIdsRef = useRef(new Set());
  const handledRequestKeysRef = useRef(new Set());
  const activeSessionKeyRef = useRef(null);
  const suppressedCatchupsRef = useRef(new Map());
  const taskMap = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      if (task?.id) map.set(task.id, task);
    });
    return map;
  }, [tasks]);

  const schedulerTasks = useMemo(() => {
    const now = Date.now();
    for (const [key, expiresAt] of suppressedCatchupsRef.current.entries()) {
      if (expiresAt <= now) {
        suppressedCatchupsRef.current.delete(key);
      }
    }

    return tasks.filter((task) => {
      const dueAtMs = getTaskDueAtMs(task);
      if (!task?.id || !Number.isFinite(dueAtMs)) return true;
      const prefix = `${task.id}:`;
      for (const [key, expiresAt] of suppressedCatchupsRef.current.entries()) {
        if (expiresAt > now && key.startsWith(prefix) && key.includes(`:${dueAtMs}:`)) {
          return false;
        }
      }
      return true;
    });
  },
  // suppressionVersion intentionally forces a recompute when the ref-backed
  // suppression map changes without a stateful tasks update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tasks, suppressionVersion]);

  const {
    alarmVisible,
    alarmTask,
    alarmThresholdKey,
    notDoneAlarm,
    dismissAlarm,
    markDoneAlarm,
    showAlarmForTask,
  } = useDeadlineAlarmScheduler(schedulerTasks, {
    deadlineWarningEnabled: notificationSettings?.deadlineWarning !== false,
    foregroundModalEnabled: true,
  });

  const loadPendingTasks = useCallback(async () => {
    const user = auth.currentUser;
    if (!user?.uid) {
      setTasks([]);
      return [];
    }

    const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid)).catch(
      () => null
    );
    const queuedCreates = await readOfflineCreateQueue(user.uid).catch(() => []);
    const cachedPending = Array.isArray(cached?.data?.pending)
      ? cached.data.pending
      : [];
    const cachedMerged = mergePendingTasksWithOfflineQueue(
      cachedPending,
      queuedCreates
    ).filter((task) => !isTaskCompleted(task));

    if (cachedMerged.length > 0) {
      setTasks(cachedMerged);
    }

    if (!isOnline) {
      setTasks(cachedMerged);
      return cachedMerged;
    }

    try {
      const snap = await getDocs(
        query(
          collection(getDb(), "assignments"),
          where("userId", "==", user.uid),
          where("completed", "==", false),
          orderBy("dueAt")
        )
      );
      const remotePending = snap.docs
        .map(normalizeAssignmentDoc)
        .filter((task) => !isTaskCompleted(task));
      const merged = mergePendingTasksWithOfflineQueue(
        remotePending,
        queuedCreates
      ).filter((task) => !isTaskCompleted(task));

      setTasks(merged);
      await saveToCache(CACHE_KEYS.assignments(user.uid), {
        ...(cached?.data || {}),
        pending: merged,
      }).catch(() => {});
      return merged;
    } catch (err) {
      warnIfDev("DeadlineAlarmHost: failed to load pending tasks:", err);
      setTasks(cachedMerged);
      return cachedMerged;
    }
  }, [isOnline]);

  const resolveTaskForRequest = useCallback(
    async (request) => {
      const user = auth.currentUser;
      if (!request?.focusTaskId || !user?.uid) return null;

      const existing = taskMap.get(request.focusTaskId);
      if (existing && !isTaskCompleted(existing)) return existing;

      if (isLocalOnlyTaskId(request.focusTaskId)) {
        const offlineTask = await findOfflineQueuedTask(
          user.uid,
          request.focusTaskId
        ).catch(() => null);
        if (offlineTask && !isTaskCompleted(offlineTask)) return offlineTask;
      }

      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid)).catch(
        () => null
      );
      const cachedTask = (cached?.data?.pending || []).find(
        (task) => task?.id === request.focusTaskId
      );
      if (cachedTask && !isTaskCompleted(cachedTask)) return cachedTask;

      const snap = await getDoc(
        doc(getDb(), "assignments", request.focusTaskId)
      ).catch(() => null);
      if (!snap?.exists?.()) return null;
      const task = normalizeAssignmentDoc(snap);
      return isTaskCompleted(task) ? null : task;
    },
    [taskMap]
  );

  const openAlarmRequest = useCallback(
    async (request) => {
      if (!request?.focusTaskId) return;
      if (request.sourceId && handledSourceIdsRef.current.has(request.sourceId)) {
        await logAlarmHostDuplicateSuppressed(
          request.focusTaskId,
          "source_already_handled",
          {
            stage: request.alarmStage ?? null,
            sourceId: request.sourceId,
          }
        ).catch(() => {});
        return;
      }

      const requestKey = getRequestKey(request);
      if (handledRequestKeysRef.current.has(requestKey)) {
        await logAlarmHostDuplicateSuppressed(
          request.focusTaskId,
          "request_key_already_handled",
          {
            stage: request.alarmStage ?? null,
            sourceId: request.sourceId ?? null,
            requestKey,
          }
        ).catch(() => {});
        return;
      }

      const task = await resolveTaskForRequest(request);
      if (!task) {
        await logStartupHandoffSkipped(
          request.focusTaskId,
          "task_not_found_for_host",
          {
            alarmStage: request.alarmStage ?? null,
            sourceId: request.sourceId ?? null,
          }
        ).catch(() => {});
        return;
      }

      const dueAtMs = Number(request.dueAtMs) || getTaskDueAtMs(task);
      const sessionKey = getSessionKey({
        taskId: task.id,
        stage: request.alarmStage || null,
        dueAtMs,
        sourceId: request.sourceId || null,
      });
      if (activeSessionKeyRef.current === sessionKey && alarmVisible) {
        await logAlarmHostDuplicateSuppressed(task.id, "session_already_active", {
          stage: request.alarmStage ?? null,
          sourceId: request.sourceId ?? null,
          dueAtMs,
        }).catch(() => {});
        return;
      }

      handledRequestKeysRef.current.add(requestKey);
      if (request.sourceId) {
        handledSourceIdsRef.current.add(request.sourceId);
      }

      if (request.nativeHandoff) {
        await settleNativeAlarmHandoff();
      }

      setSession({
        taskId: task.id,
        stage: request.alarmStage || null,
        dueAtMs,
        sourceId: request.sourceId || null,
        sessionKey,
        pendingAction:
          request.alarmAction === "markdone" || request.alarmAction === "notdone"
            ? request.alarmAction
            : null,
        nativeHandoff: false,
      });
      activeSessionKeyRef.current = sessionKey;
      showAlarmForTask(task, request.alarmStage || null);
    },
    [alarmVisible, resolveTaskForRequest, showAlarmForTask]
  );

  useEffect(() => {
    void loadPendingTasks();
  }, [loadPendingTasks]);

  useEffect(() => {
    return subscribeDeadlineAlarmOpenRequests((request) => {
      void openAlarmRequest(request);
    });
  }, [openAlarmRequest]);

  useEffect(() => {
    if (!alarmVisible) {
      setSession(null);
      activeSessionKeyRef.current = null;
    }
  }, [alarmVisible]);

  const suppressCurrentCatchup = useCallback(
    async (reason) => {
      const taskId = alarmTask?.id;
      if (!taskId) return;
      const dueAtMs = getTaskDueAtMs(alarmTask);
      const stage = alarmThresholdKey || session?.stage || null;
      if (!Number.isFinite(dueAtMs)) return;
      const key = getSessionKey({
        taskId,
        stage,
        dueAtMs,
        sourceId: session?.sourceId || null,
      });
      suppressedCatchupsRef.current.set(key, Date.now() + CATCHUP_SUPPRESSION_MS);
      activeSessionKeyRef.current = null;
      setSuppressionVersion((value) => value + 1);
      await logForegroundCatchupSuppressed(taskId, reason, {
        stage,
        dueAtMs,
        sourceId: session?.sourceId || null,
        suppressionMs: CATCHUP_SUPPRESSION_MS,
      }).catch(() => {});
    },
    [alarmTask, alarmThresholdKey, session]
  );

  const markCompleteFromModal = useCallback(async () => {
    const task = alarmTask;
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user?.uid) {
      await logStartupHandoffSkipped(task.id, "missing_user_on_modal_done", {
        stage: alarmThresholdKey ?? session?.stage ?? null,
        sourceId: session?.sourceId ?? null,
      }).catch(() => {});
      return;
    }

    const completionUpdate = buildTaskCompletionUpdate(new Date());
    const completedTask = { ...task, ...completionUpdate };

    await suppressCurrentCatchup("modal_done");
    setTasks((prev) => prev.filter((item) => item.id !== task.id));
    setSession(null);
    await markDoneAlarm?.();

    const cacheKey = CACHE_KEYS.assignments(user.uid);
    const cachedAssignments = await loadFromCache(cacheKey).catch(() => null);
    const cachedPending = Array.isArray(cachedAssignments?.data?.pending)
      ? cachedAssignments.data.pending
      : [];
    const cachedDone = Array.isArray(cachedAssignments?.data?.done)
      ? cachedAssignments.data.done
      : [];

    await saveToCache(cacheKey, {
      ...(cachedAssignments?.data || {}),
      pending: cachedPending.filter((item) => item?.id !== task.id),
      done: [
        completedTask,
        ...cachedDone.filter((item) => item?.id !== task.id),
      ],
    }).catch(() => {});

    if (isLocalOnlyTaskId(task.id)) {
      await removeOfflineQueuedTask(user.uid, task.id).catch(() => {});
      publishTaskMutation({
        type: "completed",
        taskId: task.id,
        userId: user.uid,
        completedTask,
        completedAt: completedTask.completedAt ?? null,
        source: "deadline_alarm_modal",
      });
    } else {
      publishTaskMutation({
        type: "completed",
        taskId: task.id,
        userId: user.uid,
        completedTask,
        completedAt: completedTask.completedAt ?? null,
        source: "deadline_alarm_modal",
      });

      if (isOnline) {
        try {
          await updateDoc(doc(getDb(), "assignments", task.id), completionUpdate);
        } catch (err) {
          warnIfDev(
            "DeadlineAlarmHost: remote completion failed, queueing offline sync:",
            err
          );
          await queueOfflineCompletion(
            user.uid,
            task.id,
            completedTask.completedAt
          ).catch(() => {});
        }
      } else {
        await queueOfflineCompletion(
          user.uid,
          task.id,
          completedTask.completedAt
        ).catch(() => {});
      }
    }

    await cancelDeadlineAlarms(task).catch(() => {});
    await clearTaskAlarmSuppression?.(task.id).catch(() => {});
    await refreshPendingSyncSummary?.(user.uid).catch(() => {});
    await rescheduleAll?.().catch(() => {});
    dismissAlarm?.();
  }, [
    alarmThresholdKey,
    alarmTask,
    clearTaskAlarmSuppression,
    dismissAlarm,
    markDoneAlarm,
    refreshPendingSyncSummary,
    rescheduleAll,
    session,
    suppressCurrentCatchup,
    isOnline,
  ]);

  return (
    <DeadlineAlarmModal
      visible={alarmVisible}
      task={alarmTask}
      thresholdKey={alarmThresholdKey}
      onNotDone={async () => {
        await suppressCurrentCatchup("modal_notdone");
        setSession(null);
        await notDoneAlarm?.();
      }}
      onMarkDone={markCompleteFromModal}
      pendingAction={session?.pendingAction ?? null}
      nativeHandoff={Boolean(session?.nativeHandoff)}
    />
  );
}
