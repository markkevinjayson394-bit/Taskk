import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics"; // FIX: haptic feedback
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"; // FIX: useFocusEffect
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyStateCard from "../../components/EmptyStateCard";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import {
  CACHE_KEYS,
  loadFromCache,
  saveToCache,
  useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { getTabBarContentBottomPadding } from "../../utils/tabBarLayout";
import {
  buildTaskCompletionUpdate,
  getTaskPriorityLevel,
  isTaskCompleted,
} from "../../utils/academicTaskModel";
import { cancelDeadlineAlarms } from "../../utils/deadlineAlarmBackground";
import {
  formatDeadlineCountdown,
  getUrgencyMeta,
} from "../../utils/deadlineTime";
import { reportWarning } from "../../utils/logger";
import { subscribeTaskMutations } from "../../utils/taskMutationBridge";

const PRIORITY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const TYPE_ICON = {
  assignment: "document-text",
  quiz: "help-circle",
  exam: "school",
  project: "construct",
};
const FILTERS = ["All", "Planner", "High", "Medium", "Low"];
const PENDING_UPDATES_KEY = (uid) => `pending_complete_${uid}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_REFRESH_COOLDOWN_MS = 10 * 1000;

const normalizeDateToISO = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const next = value.toDate();
    return Number.isNaN(next?.getTime?.()) ? null : next.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const next = new Date(value);
    return Number.isNaN(next.getTime()) ? null : next.toISOString();
  }
  return null;
};

const parseDateValue = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const next = value.toDate();
    return Number.isNaN(next?.getTime?.()) ? null : next;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const next = new Date(value);
    return Number.isNaN(next.getTime()) ? null : next;
  }
  return null;
};

const formatDurationCompact = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return "Done in <1m";
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if ((days === 0 && hours === 0) || minutes > 0) parts.push(`${minutes}m`);
  return `Done in ${parts.slice(0, 2).join(" ")}`;
};

const formatDurationValue = (ms) =>
  formatDurationCompact(ms).replace(/^Done in /, "");

const getCompletionDurationMs = (task) => {
  const completedAt = parseDateValue(task?.completedAt);
  const createdAt = parseDateValue(task?.createdAt);
  if (!completedAt || !createdAt) return null;
  const elapsed = completedAt.getTime() - createdAt.getTime();
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : null;
};

const getCompletionDurationLabel = (task) => {
  const elapsed = getCompletionDurationMs(task);
  if (!elapsed) return "Done";
  return formatDurationCompact(elapsed);
};

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getTaskSectionKey = (task, now) => {
  const due = parseDateValue(task?.dueAt);
  if (!due) return "upcoming";
  if (due < now) return "overdue";
  if (isSameDay(due, now)) return "today";
  return "upcoming";
};

const splitPendingSections = (tasks = [], now = new Date()) => {
  const bucket = {
    overdue: [],
    today: [],
    upcoming: [],
  };
  for (const task of tasks) {
    bucket[getTaskSectionKey(task, now)].push(task);
  }
  return [
    {
      key: "overdue",
      label: "Overdue",
      items: bucket.overdue,
      color: "#ef4444",
    },
    { key: "today", label: "Due Today", items: bucket.today, color: "#f59e0b" },
    {
      key: "upcoming",
      label: "Upcoming",
      items: bucket.upcoming,
      color: "#22c55e",
    },
  ].filter((section) => section.items.length > 0);
};

const URGENCY_VISUALS = {
  none: { bg: "#e2e8f0", icon: "calendar-clear-outline" },
  overdue: { bg: "#fee2e2", icon: "alert-circle-outline" },
  critical: { bg: "#fee2e2", icon: "alarm-outline" },
  urgent: { bg: "#fef3c7", icon: "warning-outline" },
  soon: { bg: "#dbeafe", icon: "time-outline" },
  upcoming: { bg: "#dcfce7", icon: "calendar-outline" },
};

const getUrgencyPresentation = (deadlineMs, nowMs) => {
  const urgency = getUrgencyMeta(deadlineMs, nowMs);
  return {
    ...urgency,
    ...(URGENCY_VISUALS[urgency.severity] || URGENCY_VISUALS.none),
  };
};

const normalizePendingUpdates = (queue = []) => {
  const deduped = new Map();
  for (const item of queue) {
    if (!item?.id || !item?.action) continue;
    deduped.set(`${item.action}:${item.id}`, {
      id: item.id,
      action: item.action,
      queuedAt: item.queuedAt || new Date().toISOString(),
    });
  }
  return Array.from(deduped.values());
};

const normalizeFilterParam = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) return "All";
  const matched = FILTERS.find(
    (item) => item.toLowerCase() === raw.trim().toLowerCase()
  );
  return matched || "All";
};

const parsePlannerRef = (plannerRef) => {
  if (typeof plannerRef !== "string") return null;

  const dayMatch = plannerRef.match(/^planner:day:([^:]+):block:(.+)$/);
  if (dayMatch) {
    return { mode: "day", dayKey: dayMatch[1], blockId: dayMatch[2] };
  }

  const monthMatch = plannerRef.match(
    /^planner:month:(\d{4}-\d{2}):milestone:(\d+)$/
  );
  if (monthMatch) {
    return {
      mode: "month",
      monthKey: monthMatch[1],
      milestoneIndex: Number(monthMatch[2]),
    };
  }

  return null;
};

export default function Assignments() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { focusTaskId, filter: filterParam } = useLocalSearchParams();
  const {
    isOnline,
    markSynced,
    refreshPendingSyncSummary,
    pendingSyncSummary,
  } = useOffline();
  const { rescheduleAll } = useNotifications();
  const insets = useSafeAreaInsets();

  const [assignments, setAssignments] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [filter, setFilter] = useState(() => normalizeFilterParam(filterParam));
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [visiblePending, setVisiblePending] = useState(15);
  const [visibleHistory, setVisibleHistory] = useState(15);
  const [nowTick, setNowTick] = useState(() => new Date());
  const PAGE_SIZE = 15;
  const highlightedTaskId =
    typeof focusTaskId === "string" && focusTaskId ? focusTaskId : "";

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flushingRef = useRef(false);
  const loadInFlightRef = useRef(null);
  const lastAutoRefreshAtRef = useRef(0);
  const previousOnlineRef = useRef(isOnline);
  const stripArchived = (items = []) =>
    items.filter((item) => !item?.plannerArchived);

  const readPendingQueue = useCallback(async (uid) => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(uid));
      if (!raw) return [];
      return normalizePendingUpdates(JSON.parse(raw));
    } catch (err) {
      reportWarning(err, {
        message: "Failed to read pending assignment queue.",
        tags: { location: "assignments_pending_queue_read" },
        extra: { userId: uid },
      });
      return [];
    }
  }, []);

  const writePendingQueue = useCallback(
    async (uid, queue) => {
      if (!queue.length) {
        await AsyncStorage.removeItem(PENDING_UPDATES_KEY(uid));
        await refreshPendingSyncSummary(uid);
        return;
      }
      await AsyncStorage.setItem(
        PENDING_UPDATES_KEY(uid),
        JSON.stringify(queue)
      );
      await refreshPendingSyncSummary(uid);
    },
    [refreshPendingSyncSummary]
  );

  const refreshPendingCount = useCallback(
    async (uid) => {
      const queue = await readPendingQueue(uid);
      await writePendingQueue(uid, queue);
      setPendingCount(queue.length);
      return queue;
    },
    [readPendingQueue, writePendingQueue]
  );

  const queueCompletionUpdate = async (
    uid,
    id,
    queuedAt = new Date().toISOString()
  ) => {
    const queue = await readPendingQueue(uid);
    const next = normalizePendingUpdates([
      ...queue,
      { id, action: "complete", queuedAt },
    ]);
    await writePendingQueue(uid, next);
    setPendingCount(next.length);
  };

  // FIX: auto-refresh list when navigating back from task screens
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        const now = Date.now();
        if (now - lastAutoRefreshAtRef.current < AUTO_REFRESH_COOLDOWN_MS) {
          return;
        }
        lastAutoRefreshAtRef.current = now;
        if (isOnline) {
          await flushPendingUpdates();
        }
        if (active) {
          await load();
        }
      };
      run();
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline])
  );

  useEffect(() => {
    return subscribeTaskMutations((event) => {
      if (
        event?.type !== "completed" ||
        event.userId !== auth.currentUser?.uid
      ) {
        return;
      }
      setAssignments((prev) => prev.filter((item) => item?.id !== event.taskId));
      setHistory((prev) => {
        const next = prev.filter((item) => item?.id !== event.taskId);
        return event.completedTask ? [event.completedTask, ...next] : next;
      });
    });
  }, []);

  // When back online, flush any queued "complete" actions
  useEffect(() => {
    const wasOnline = previousOnlineRef.current;
    previousOnlineRef.current = isOnline;
    if (!isOnline || wasOnline) return;

    lastAutoRefreshAtRef.current = Date.now();
    void flushPendingUpdates().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    const tick = setInterval(() => {
      setNowTick(new Date());
    }, 60 * 1000);
    return () => clearInterval(tick);
  }, []);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const queueReminderRefresh = useCallback(
    (reason, extra = {}) => {
      void rescheduleAll().catch((error) => {
        reportWarning(error, {
          message: "Failed to refresh reminders after an assignments change.",
          tags: { location: "assignments_reschedule", reason },
          extra,
        });
      });
    },
    [rescheduleAll]
  );

  useEffect(() => {
    if (!highlightedTaskId) return;
    if (history.some((item) => item.id === highlightedTaskId)) {
      setShowHistory(true);
    }
  }, [highlightedTaskId, history]);

  useEffect(() => {
    const nextFilter = normalizeFilterParam(filterParam);
    setFilter((previous) => (previous === nextFilter ? previous : nextFilter));
  }, [filterParam]);

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return loadInFlightRef.current;

    loadInFlightRef.current = (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        await refreshPendingCount(user.uid);

        if (!isOnline) {
          const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
          if (cached?.data) {
            const { pending, done } = cached.data;
            setAssignments(stripArchived(pending || []));
            setHistory(stripArchived(done || []));
          }
          setRefreshing(false);
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }).start();
          return;
        }

        try {
      // [FIX 2] Added where("completed", "==", false) so Firestore only returns
      // pending tasks, and orderBy("dueAt", "asc") so tasks are always returned
      // in due-date order — preventing buried tasks from undefined ordering.
      // Done tasks are fetched separately with their own query below.
      const pendingSnap = await getDocs(
        query(
          collection(db, "assignments"),
          where("userId", "==", user.uid),
          where("completed", "==", false),
          orderBy("dueAt", "asc")
        )
      );
      const doneSnap = await getDocs(
        query(
          collection(db, "assignments"),
          where("userId", "==", user.uid),
          where("completed", "==", true),
          orderBy("dueAt", "desc")
        )
      );

      const now = new Date();

      const normalizeDoc = (d) => ({
        id: d.id,
        ...d.data(),
        dueAt: normalizeDateToISO(d.data().dueAt),
        createdAt: normalizeDateToISO(d.data().createdAt),
        completedAt: normalizeDateToISO(d.data().completedAt),
      });

      const allPending = pendingSnap.docs.map(normalizeDoc);
      const allDone = doneSnap.docs.map(normalizeDoc);

      const visiblePendingItems = stripArchived(allPending);
      const visibleDoneItems = stripArchived(allDone);

      // Sort pending: overdue first, then by priority within each group.
      // Firestore orderBy(dueAt) gives us time-ordered results; we re-sort
      // here only to float overdue tasks above upcoming ones.
      const pending = visiblePendingItems
        .filter((a) => !isTaskCompleted(a))
        .sort((a, b) => {
          const aDue = new Date(a.dueAt),
            bDue = new Date(b.dueAt);
          const aOver = aDue < now,
            bOver = bDue < now;
          if (aOver !== bOver) return aOver ? -1 : 1;
          return (
            (Number(a.priorityLevel) || getTaskPriorityLevel(a.priority)) -
            (Number(b.priorityLevel) || getTaskPriorityLevel(b.priority))
          );
        });

      const done = visibleDoneItems.filter((a) => isTaskCompleted(a));

      setAssignments(pending);
      setHistory(done);
      setVisiblePending(PAGE_SIZE);
      setVisibleHistory(PAGE_SIZE);
      await saveToCache(CACHE_KEYS.assignments(user.uid), { pending, done });
      await markSynced(user.uid);
        } catch (_err) {
          const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
          if (cached?.data) {
            setAssignments(stripArchived(cached.data.pending || []));
            setHistory(stripArchived(cached.data.done || []));
          }
        } finally {
          setRefreshing(false);
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }).start();
        }
      } finally {
        loadInFlightRef.current = null;
      }
    })();

    return loadInFlightRef.current;
  }, [isOnline, fadeAnim, refreshPendingCount, markSynced]);

  const markComplete = async (id) => {
    const user = auth.currentUser;
    if (!user) return;

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const completed = assignments.find((a) => a.id === id);
    const completionUpdate = buildTaskCompletionUpdate(new Date());

    // [FIX 3] Await cancelDeadlineAlarms BEFORE mutating state so we don't
    // have a race where the task disappears from the list while alarms are
    // still being cancelled, and so completed tasks never briefly appear in
    // the pending list due to optimistic state updates racing with the cancel.
    if (completed) {
      try {
        await cancelDeadlineAlarms(completed);
      } catch (err) {
        reportWarning(err, {
          message: "Failed to cancel deadline alarms on task completion.",
          tags: { location: "assignments_mark_complete_cancel_alarms" },
          extra: { taskId: id, userId: user.uid },
        });
      }
    }

    // Optimistic UI update — remove from pending, add to history
    setAssignments((prev) => prev.filter((a) => a.id !== id));
    if (completed)
      setHistory((prev) => [{ ...completed, ...completionUpdate }, ...prev]);

    if (isOnline) {
      try {
        await updateDoc(doc(db, "assignments", id), completionUpdate);
        await markSynced(user.uid);
        queueReminderRefresh("assignment_complete", { taskId: id });
        const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
        if (cached?.data) {
          const updated = {
            pending: (cached.data.pending || []).filter((a) => a.id !== id),
            done: [
              { ...completed, ...completionUpdate },
              ...(cached.data.done || []),
            ],
          };
          await saveToCache(CACHE_KEYS.assignments(user.uid), updated);
        }
      } catch (err) {
        reportWarning(err, {
          message: "Failed to mark assignment complete online. Queuing sync.",
          tags: { location: "assignments_mark_complete" },
          extra: { taskId: id, userId: user.uid },
        });
        await queueCompletionUpdate(user.uid, id);
        Alert.alert(
          "Saved Offline",
          "Couldn't reach the server. This update will sync automatically."
        );
      }
    } else {
      await queueCompletionUpdate(user.uid, id);
      Alert.alert(
        "Saved Offline",
        "Task marked as done. It will sync when you're back online.",
        [{ text: "OK" }]
      );
    }
  };

  const flushPendingUpdates = async () => {
    if (flushingRef.current || !isOnline) return false;
    const user = auth.currentUser;
    if (!user) return false;

    flushingRef.current = true;
    try {
      const queue = await refreshPendingCount(user.uid);
      if (queue.length === 0) return false;

      const remaining = [];
      let flushed = 0;

      for (const item of queue) {
        try {
          if (item.action === "complete") {
            await updateDoc(
              doc(db, "assignments", item.id),
              buildTaskCompletionUpdate(new Date(item.queuedAt))
            );
            flushed++;
          } else {
            remaining.push(item);
          }
        } catch (error) {
          reportWarning(error, {
            message: "Failed to flush pending assignment update.",
            tags: { location: "assignments_flush_pending" },
            extra: { taskId: item.id, userId: user.uid },
          });
          remaining.push(item);
        }
      }

      await writePendingQueue(user.uid, remaining);
      setPendingCount(remaining.length);

      if (flushed > 0) {
        await markSynced(user.uid);
        queueReminderRefresh("assignments_flush_pending", {
          flushedCount: flushed,
          userId: user.uid,
        });
        return true;
      }
      return false;
    } finally {
      flushingRef.current = false;
    }
  };

  const openPlannerFromTask = useCallback(
    (task) => {
      const parsed = parsePlannerRef(task?.plannerRef);
      if (!parsed) {
        router.push("/(tabs)/CalendarPlannerScreen");
        return;
      }

      if (parsed.mode === "day" && parsed.dayKey && parsed.blockId) {
        router.push({
          pathname: "/(tabs)/CalendarPlannerScreen",
          params: {
            dayKey: parsed.dayKey,
            focusBlockId: parsed.blockId,
            mode: "day",
          },
        });
        return;
      }

      if (
        parsed.mode === "month" &&
        parsed.monthKey &&
        Number.isInteger(parsed.milestoneIndex) &&
        parsed.milestoneIndex >= 0
      ) {
        router.push({
          pathname: "/(tabs)/CalendarPlannerScreen",
          params: {
            monthKey: parsed.monthKey,
            focusMilestoneIndex: String(parsed.milestoneIndex),
            mode: "month",
          },
        });
        return;
      }

      router.push("/(tabs)/CalendarPlannerScreen");
    },
    [router]
  );

  const searchLower = deferredSearchQuery.toLowerCase().trim();
  const allFiltered = useMemo(
    () =>
      filter === "All"
        ? assignments
        : filter === "Planner"
          ? assignments.filter((a) => a.source === "planner")
          : assignments.filter(
              (a) => a.priority?.toLowerCase() === filter.toLowerCase()
            ),
    [assignments, filter]
  );
  const finalFiltered = useMemo(
    () =>
      searchLower
        ? allFiltered.filter(
            (a) =>
              a.title?.toLowerCase().includes(searchLower) ||
              (a.subjectName || a.subject || "")
                .toLowerCase()
                .includes(searchLower)
          )
        : allFiltered,
    [allFiltered, searchLower]
  );
  const filtered = useMemo(
    () => finalFiltered.slice(0, visiblePending),
    [finalFiltered, visiblePending]
  );
  const pendingSections = useMemo(
    () => splitPendingSections(filtered, nowTick),
    [filtered, nowTick]
  );
  const hasMorePending = finalFiltered.length > visiblePending;
  const visibleHistoryItems = useMemo(
    () => history.slice(0, visibleHistory),
    [history, visibleHistory]
  );
  const hasMoreHistory = history.length > visibleHistory;

  const overdueCount = useMemo(
    () =>
      assignments.filter((a) => {
        const due = a.dueAt ? new Date(a.dueAt) : null;
        return due && due < nowTick;
      }).length,
    [assignments, nowTick]
  );
  const completedThisWeek = useMemo(
    () =>
      history.filter((task) => {
        const completedAt = parseDateValue(task?.completedAt);
        if (!completedAt) return false;
        return nowTick.getTime() - completedAt.getTime() <= 7 * DAY_MS;
      }).length,
    [history, nowTick]
  );
  const averageCompletionMs = useMemo(() => {
    const completionDurations = history
      .map((task) => getCompletionDurationMs(task))
      .filter((value) => Number.isFinite(value) && value > 0);
    return completionDurations.length > 0
      ? completionDurations.reduce((sum, value) => sum + value, 0) /
          completionDurations.length
      : null;
  }, [history]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#f59e0b" />
      <OfflineBanner />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: getTabBarContentBottomPadding(insets.bottom),
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (isOnline) {
                setRefreshing(true);
                load();
              }
            }}
            colors={["#f59e0b"]}
            tintColor="#f59e0b"
            enabled={isOnline}
          />
        }
      >
        <View
          style={[
            styles.hero,
            { backgroundColor: "#f59e0b", paddingTop: insets.top + 16 },
          ]}
        >
          <View style={styles.heroCircle} />
          <View style={styles.heroCircle2} />
          <Text style={styles.heroSub}>Your tasks</Text>
          <Text style={styles.heroTitle}>Tasks</Text>
          <Text style={styles.heroMeta}>
            Assignment | Quiz | Exam | Project
          </Text>
          {pendingCount > 0 && (
            <View style={styles.syncPill}>
              <Ionicons name="cloud-upload-outline" size={13} color="#fff" />
              <Text style={styles.syncPillText}>
                {pendingCount} update{pendingCount > 1 ? "s" : ""} waiting to
                sync
              </Text>
            </View>
          )}
          {Number(pendingSyncSummary?.create || 0) > 0 && (
            <View
              style={[
                styles.syncPill,
                { backgroundColor: "rgba(14,165,233,0.28)", marginTop: 6 },
              ]}
            >
              <Ionicons name="add-circle-outline" size={13} color="#fff" />
              <Text style={styles.syncPillText}>
                {pendingSyncSummary.create} new task
                {pendingSyncSummary.create > 1 ? "s" : ""} saved offline
              </Text>
            </View>
          )}
          <View style={styles.statsRow}>
            {[
              { label: "Pending", value: assignments.length, color: "#fff" },
              { label: "Done", value: history.length, color: "#fff" },
              {
                label: "Overdue",
                value: overdueCount,
                color: overdueCount > 0 ? "#fecaca" : "#fff",
              },
            ].map((s) => (
              <View
                key={s.label}
                style={[
                  styles.statBox,
                  { backgroundColor: "rgba(255,255,255,0.2)" },
                ]}
              >
                <Text style={[styles.statValue, { color: s.color }]}>
                  {s.value}
                </Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <Animated.View style={{ opacity: fadeAnim }}>
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="search"
              size={18}
              color={colors.muted}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search tasks..."
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {FILTERS.map((f) => {
              const isActive = filter === f;
              const color =
                f === "Planner"
                  ? "#0ea5e9"
                  : f === "High"
                    ? "#ef4444"
                    : f === "Medium"
                      ? "#f59e0b"
                      : f === "Low"
                        ? "#22c55e"
                        : "#6366f1";
              return (
                <TouchableOpacity
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isActive ? color : colors.card,
                      borderColor: isActive ? color : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      { color: isActive ? "#fff" : colors.muted },
                    ]}
                  >
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {filtered.length === 0 ? (
            <EmptyStateCard
              title={
                searchQuery
                  ? `No results for "${searchQuery}"`
                  : filter === "All"
                    ? "No pending tasks"
                    : filter === "Planner"
                      ? "No planner-linked tasks"
                      : `No ${filter.toLowerCase()} priority tasks`
              }
              message={
                searchQuery
                  ? "Try a different search term"
                  : filter === "Planner"
                    ? "Create or link tasks from Planner time blocks."
                    : "You are all caught up."
              }
              icon="checkmark-circle"
              style={{ margin: 16 }}
            />
          ) : (
            pendingSections.map((section) => (
              <View key={section.key}>
                <View style={styles.sectionHeaderRow}>
                  <View
                    style={[
                      styles.sectionDot,
                      { backgroundColor: section.color },
                    ]}
                  />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {section.label}
                  </Text>
                  <Text style={[styles.sectionCount, { color: colors.muted }]}>
                    {section.items.length}
                  </Text>
                </View>
                {section.items.map((a) => {
                  const due = a.dueAt ? new Date(a.dueAt) : null;
                  const over = due && due < nowTick;
                  const dueLabel = due
                    ? formatDeadlineCountdown(due, nowTick, { style: "short" })
                    : "";
                  const urgency = getUrgencyPresentation(
                    due?.getTime(),
                    nowTick.getTime()
                  );
                  const color = PRIORITY_COLOR[a.priority] || "#94a3b8";
                  const isHighlighted = Boolean(
                    highlightedTaskId && a.id === highlightedTaskId
                  );
                  const subtaskCount = Array.isArray(a.subtasks)
                    ? a.subtasks.length
                    : 0;
                  const doneSubtasks = Array.isArray(a.subtasks)
                    ? a.subtasks.filter((item) => item?.done).length
                    : 0;
                  const estimate = Number(a.estimatedMinutes);
                  const isPlannerLinked =
                    a.source === "planner" && !Boolean(a.plannerArchived);
                  return (
                    <View
                      key={a.id}
                      style={[
                        styles.taskCard,
                        {
                          backgroundColor: colors.card,
                          borderLeftColor: color,
                        },
                        isHighlighted
                          ? { borderWidth: 1.5, borderColor: colors.primary }
                          : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.taskIconBox,
                          { backgroundColor: color + "15" },
                        ]}
                      >
                        <Ionicons
                          name={TYPE_ICON[a.type] || "document-text"}
                          size={18}
                          color={color}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.taskTitle, { color: colors.text }]}
                          numberOfLines={2}
                        >
                          {a.title}
                        </Text>
                        <Text style={[styles.taskSub, { color: colors.muted }]}>
                          {a.subjectName || a.subject || "General"}
                          {subtaskCount > 0
                            ? ` | Checklist ${doneSubtasks}/${subtaskCount}`
                            : ""}
                        </Text>
                        <View style={styles.taskMetaRow}>
                          <View
                            style={[
                              styles.urgencyPill,
                              { backgroundColor: urgency.bg },
                            ]}
                          >
                            <Ionicons
                              name={urgency.icon}
                              size={11}
                              color={urgency.color}
                            />
                            <Text
                              style={[
                                styles.urgencyText,
                                { color: urgency.color },
                              ]}
                            >
                              {urgency.label}
                            </Text>
                          </View>
                          {isPlannerLinked ? (
                            <View
                              style={[
                                styles.metaPill,
                                {
                                  backgroundColor: isDark
                                    ? "#082f49"
                                    : "#e0f2fe",
                                },
                              ]}
                            >
                              <Ionicons
                                name="link-outline"
                                size={11}
                                color={isDark ? "#7dd3fc" : "#0369a1"}
                              />
                              <Text
                                style={[
                                  styles.metaPillText,
                                  {
                                    color: isDark ? "#bae6fd" : "#0369a1",
                                  },
                                ]}
                              >
                                Planner linked
                              </Text>
                            </View>
                          ) : null}
                          {Number.isFinite(estimate) && estimate > 0 ? (
                            <View
                              style={[
                                styles.metaPill,
                                {
                                  backgroundColor: isDark
                                    ? "#1e293b"
                                    : "#f8fafc",
                                },
                              ]}
                            >
                              <Ionicons
                                name="timer-outline"
                                size={11}
                                color={colors.muted}
                              />
                              <Text
                                style={[
                                  styles.metaPillText,
                                  { color: colors.muted },
                                ]}
                              >
                                {formatDurationValue(estimate * 60000)}
                              </Text>
                            </View>
                          ) : null}
                          {due ? (
                            <View
                              style={[
                                styles.duePill,
                                {
                                  backgroundColor: over
                                    ? "#fef2f2"
                                    : isDark
                                      ? "#1e293b"
                                      : "#f8fafc",
                                },
                              ]}
                            >
                              <Ionicons
                                name="time-outline"
                                size={11}
                                color={over ? "#ef4444" : colors.muted}
                              />
                              <Text
                                style={[
                                  styles.dueText,
                                  { color: over ? "#ef4444" : colors.muted },
                                ]}
                              >
                                {dueLabel}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.taskActionsCol}>
                        {isPlannerLinked ? (
                          <TouchableOpacity
                            style={[
                              styles.openPlannerBtn,
                              {
                                borderColor: colors.primary,
                                backgroundColor: isDark ? "#0f172a" : "#eff6ff",
                              },
                            ]}
                            onPress={() => openPlannerFromTask(a)}
                            activeOpacity={0.75}
                          >
                            <Ionicons
                              name="calendar-outline"
                              size={12}
                              color={colors.primary}
                            />
                            <Text
                              style={[
                                styles.openPlannerText,
                                { color: colors.primary },
                              ]}
                            >
                              Plan
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={[styles.doneBtn, { backgroundColor: color }]}
                          onPress={() => markComplete(a.id)}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="checkmark" size={14} color="#fff" />
                          <Text style={styles.doneBtnText}>Done</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
          {hasMorePending && (
            <TouchableOpacity
              style={[styles.loadMoreBtn, { borderColor: colors.border }]}
              onPress={() => setVisiblePending((prev) => prev + PAGE_SIZE)}
            >
              <Text style={[styles.loadMoreText, { color: colors.text }]}>
                Load more tasks
              </Text>
            </TouchableOpacity>
          )}

          {history.length > 0 && (
            <View
              style={[
                styles.historyInsights,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.historyInsightItem}>
                <Ionicons name="calendar-outline" size={14} color="#6366f1" />
                <Text
                  style={[styles.historyInsightText, { color: colors.text }]}
                >
                  {completedThisWeek} completed in the last 7 days
                </Text>
              </View>
              <View style={styles.historyInsightItem}>
                <Ionicons
                  name="speedometer-outline"
                  size={14}
                  color="#22c55e"
                />
                <Text
                  style={[styles.historyInsightText, { color: colors.text }]}
                >
                  {averageCompletionMs
                    ? `Average finish time: ${formatDurationValue(averageCompletionMs)}`
                    : "Average finish time: not enough data"}
                </Text>
              </View>
            </View>
          )}

          {history.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.historyToggle}
                onPress={() => setShowHistory((v) => !v)}
              >
                <View style={styles.historyToggleInner}>
                  <Text
                    style={[styles.historyToggleText, { color: colors.muted }]}
                  >
                    {showHistory ? "Hide" : "Show"} Completed ({history.length})
                  </Text>
                  <Ionicons
                    name={showHistory ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                </View>
              </TouchableOpacity>
              {showHistory &&
                visibleHistoryItems.map((a) => {
                  const isHighlighted = Boolean(
                    highlightedTaskId && a.id === highlightedTaskId
                  );
                  const isPlannerLinked =
                    a.source === "planner" && !Boolean(a.plannerArchived);
                  return (
                    <View
                      key={a.id}
                      style={[
                        styles.historyRow,
                        { backgroundColor: isDark ? "#1e293b" : "#f8fafc" },
                        isHighlighted
                          ? { borderWidth: 1.5, borderColor: colors.primary }
                          : null,
                      ]}
                    >
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color="#22c55e"
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.historyText, { color: colors.muted }]}
                          numberOfLines={1}
                        >
                          {a.title}
                        </Text>
                        <Text
                          style={[styles.historyMeta, { color: colors.muted }]}
                          numberOfLines={1}
                        >
                          {isPlannerLinked
                            ? `${getCompletionDurationLabel(a)} | From Planner`
                            : getCompletionDurationLabel(a)}
                        </Text>
                      </View>
                      {isPlannerLinked ? (
                        <TouchableOpacity
                          style={[
                            styles.historyPlanBtn,
                            {
                              borderColor: colors.primary,
                              backgroundColor: isDark ? "#0f172a" : "#eff6ff",
                            },
                          ]}
                          onPress={() => openPlannerFromTask(a)}
                          activeOpacity={0.75}
                        >
                          <Ionicons
                            name="calendar-outline"
                            size={12}
                            color={colors.primary}
                          />
                          <Text
                            style={[
                              styles.historyPlanText,
                              { color: colors.primary },
                            ]}
                          >
                            Plan
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })}
              {showHistory && hasMoreHistory && (
                <TouchableOpacity
                  style={[styles.loadMoreBtn, { borderColor: colors.border }]}
                  onPress={() => setVisibleHistory((prev) => prev + PAGE_SIZE)}
                >
                  <Text style={[styles.loadMoreText, { color: colors.text }]}>
                    Load more completed
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingTop: 56,
    paddingBottom: 24,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroCircle: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -40,
    right: -30,
  },
  heroCircle2: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 58,
  },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 4,
  },
  heroMeta: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 12,
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 10,
  },
  syncPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  statBox: { flex: 1, borderRadius: 12, padding: 10, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "800" },
  statLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500" },
  filters: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterText: { fontSize: 12, fontWeight: "700" },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
  },
  sectionDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { fontSize: 14, fontWeight: "800", flex: 1 },
  sectionCount: { fontSize: 12, fontWeight: "700" },
  taskCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 18,
    borderLeftWidth: 4,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  taskIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  taskTitle: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
  taskSub: { fontSize: 12, marginTop: 2 },
  taskMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  urgencyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  urgencyText: { fontSize: 11, fontWeight: "700" },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  metaPillText: { fontSize: 11, fontWeight: "600" },
  duePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dueText: { fontSize: 11, fontWeight: "700" },
  taskActionsCol: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  openPlannerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  openPlannerText: { fontSize: 11, fontWeight: "700" },
  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  doneBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 13, fontWeight: "700" },
  historyInsights: {
    marginHorizontal: 16,
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  historyInsightItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyInsightText: { fontSize: 12, fontWeight: "600", flex: 1 },
  historyToggle: { marginHorizontal: 16, marginTop: 14, paddingVertical: 6 },
  historyToggleInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyToggleText: { fontSize: 13, fontWeight: "700" },
  historyRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  historyText: { fontSize: 13, fontWeight: "700" },
  historyMeta: { fontSize: 11, marginTop: 2 },
  historyPlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  historyPlanText: { fontSize: 11, fontWeight: "700" },
});
