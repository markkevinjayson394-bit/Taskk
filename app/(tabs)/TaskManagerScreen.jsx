import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
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
  Platform,
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
import DeadlineAlarmModal, {
  useDeadlineAlarmScheduler,
} from "../../components/DeadlineAlarmModal";
import EmptyStateCard from "../../components/EmptyStateCard";
import OfflineBanner from "../../components/OfflineBanner";
import TaskEditorModal from "../../components/task-manager/TaskEditorModal";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import {
  CACHE_KEYS,
  loadFromCache,
  saveToCache,
  useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { loadAllPlans } from "../../features/tab-modules/CalendarPlannerScreen.helpers";
import {
  SubjectBreakdown,
  TaskCard,
  WorkloadBanner,
} from "../../features/tab-modules/TaskManagerScreen.components";
import {
  AUTO_REFRESH_COOLDOWN_MS,
  buildQuickDueOptions,
  calculateWorkloadScore,
  CREATE_PRIORITY_OPTIONS,
  DAY_MS,
  DEFAULT_MANUAL_TASK_REMINDER_POLICY,
  ensureGeneralSubjectOption,
  extractScheduleSubjectNames,
  extractStudentScheduleProfile,
  FILTERS,
  formatDurationMs,
  formatEstimatedMinutes,
  GENERAL_SUBJECT,
  GENERAL_SUBJECT_ID,
  GENERAL_SUBJECT_OPTION,
  getDefaultDueAt,
  getPreferredCreateSubject,
  getQuickCreateDueAt,
  getQuickSnoozePlan,
  getSectionKey,
  getTaskSubjectId,
  normalizeDateToISO,
  normalizeFilterParam,
  normalizePendingUpdates,
  normalizeRouteString,
  normalizeSubjectOption,
  PAGE_SIZE,
  parseDueDate,
  parsePlannerRef,
  parseSubjectCatalogRaw,
  PENDING_UPDATES_KEY,
  SCHEDULE_SUBJECT_SOURCES,
  SORT_OPTIONS,
  sortSubjectOptions,
  SUBJECT_CATALOG_KEY,
  SUBJECT_FILTER_ALL_ID,
  TYPE_META,
  TYPE_ROWS,
} from "../../features/tab-modules/TaskManagerScreen.helpers";
import {
  buildSubjectIdFromName,
  buildTaskCompletionUpdate,
  buildTaskCreateData,
  getTaskPriorityLevel,
  isTaskCompleted,
  normalizeSubjectName,
  normalizeTaskPriority,
  normalizeTaskType,
} from "../../utils/academicTaskModel";
import { toLocalDayKey } from "../../utils/dateHelpers";
import { cancelDeadlineAlarms } from "../../utils/deadlineAlarmBackground";
import { reportError, reportWarning, warnIfDev } from "../../utils/logger";
import { syncCalendarDayPlans } from "../../utils/plannerTaskSync";
import { findBestScheduleDoc } from "../../utils/scheduleMatcher";

function buildTaskSubjectFields(subjectValue, subjectIdValue) {
  const subjectName = normalizeSubjectName(subjectValue || GENERAL_SUBJECT);
  return {
    subject: subjectName,
    subjectName,
    subjectId:
      String(subjectIdValue || "").trim() ||
      buildSubjectIdFromName(subjectName),
  };
}

function parseCustomReminderDate(value) {
  if (!value) return null;
  const parsed = new Date(value?.toDate?.() || value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidCustomReminder(reminderDate, dueDate) {
  if (!reminderDate || !dueDate) return false;
  if (!(reminderDate instanceof Date) || Number.isNaN(reminderDate.getTime())) {
    return false;
  }
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) {
    return false;
  }
  if (reminderDate <= new Date()) return false;
  if (reminderDate >= dueDate) return false;
  return true;
}

export default function TaskManagerScreen() {
  const router = useRouter();
  const {
    focusTaskId,
    showAlarm,
    pendingAction,
    dueAtMs,
    filter: filterParam,
    subject: subjectParam,
    subjectId: subjectIdParam,
  } = useLocalSearchParams();
  const routeDueAtMs = (() => {
    const raw = normalizeRouteString(dueAtMs);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const { colors, isDark } = useTheme();
  const { isOnline, markSynced, refreshPendingSyncSummary } = useOffline();

  // FIX: Destructure with fallbacks in case context is not yet initialized
  const {
    rescheduleAll,
    rescheduleDeadlineAlarmsForTask,
    clearTaskAlarmSuppression,
    cancelTodayDigestIfNoPendingTasks,
  } = useNotifications() ?? {};

  const insets = useSafeAreaInsets();

  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const {
    alarmVisible,
    alarmTask,
    notDoneAlarm,
    dismissAlarm,
    markDoneAlarm,
    showAlarmForTask,
  } = useDeadlineAlarmScheduler(tasks);
  const [filter, setFilter] = useState(() => normalizeFilterParam(filterParam));
  const [searchQuery, setSearchQuery] = useState("");
  const [subjectFilterId, setSubjectFilterId] = useState(SUBJECT_FILTER_ALL_ID);
  const [sortMode, setSortMode] = useState("dueSoon");
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [visiblePending, setVisiblePending] = useState(PAGE_SIZE);
  const [visibleHistory, setVisibleHistory] = useState(PAGE_SIZE);
  const [showHistory, setShowHistory] = useState(false);

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const [savingId, setSavingId] = useState("");
  const [showAnalytics, setShowAnalytics] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [newTaskSubject, setNewTaskSubject] = useState(GENERAL_SUBJECT);
  const [selectedSubjectId, setSelectedSubjectId] =
    useState(GENERAL_SUBJECT_ID);
  const [subjectOptions, setSubjectOptions] = useState([
    GENERAL_SUBJECT_OPTION,
  ]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [newTaskType, setNewTaskType] = useState("assignment");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDueAt, setNewTaskDueAt] = useState(() => getDefaultDueAt());
  const [customReminderAt, setCustomReminderAt] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState("");
  const [editingTask, setEditingTask] = useState(null);
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [showDueTimePicker, setShowDueTimePicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [snoozingId, setSnoozingId] = useState("");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flushingRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);
  const routeSubjectKeyRef = useRef("");
  const createSubjectAutoPickedRef = useRef(false);
  const scheduleSubjectsRef = useRef({
    key: "",
    names: [],
  });
  const pendingActionRef = useRef(null);
  const handledParamRef = useRef("");

  const highlightedTaskId =
    typeof focusTaskId === "string" && focusTaskId ? focusTaskId : "";
  const isEditMode = Boolean(editingTaskId);

  useEffect(() => {
    const next = normalizeFilterParam(filterParam);
    setFilter((prev) => (prev === next ? prev : next));
  }, [filterParam]);

  useEffect(() => {
    if (!subjectOptions.length) return;
    if (subjectOptions.some((option) => option.id === selectedSubjectId))
      return;
    const currentName = normalizeSubjectName(newTaskSubject || GENERAL_SUBJECT);
    const fallback =
      subjectOptions.find(
        (option) => option.name.toLowerCase() === currentName.toLowerCase()
      ) || subjectOptions.find((option) => option.name === GENERAL_SUBJECT);
    if (fallback?.id) setSelectedSubjectId(fallback.id);
  }, [subjectOptions, selectedSubjectId, newTaskSubject]);

  const routeSubjectRaw = normalizeRouteString(subjectParam);
  const routeSubjectName = routeSubjectRaw
    ? normalizeSubjectName(routeSubjectRaw)
    : "";
  const routeSubjectId = normalizeRouteString(subjectIdParam);

  useEffect(() => {
    const routeKey = `${routeSubjectId}|${routeSubjectName}`;
    if (!routeSubjectId && !routeSubjectName) return;
    if (routeSubjectKeyRef.current === routeKey) return;
    routeSubjectKeyRef.current = routeKey;

    if (routeSubjectId) {
      setSubjectFilterId(routeSubjectId);
      return;
    }

    if (!routeSubjectName) return;
    const match = subjectOptions.find(
      (option) => option.name.toLowerCase() === routeSubjectName.toLowerCase()
    );
    if (match?.id) {
      setSubjectFilterId(match.id);
      return;
    }
    setSubjectFilterId(buildSubjectIdFromName(routeSubjectName));
  }, [routeSubjectId, routeSubjectName, subjectOptions]);

  const scheduleCreateSubjectOptions = useMemo(() => {
    const scheduleOnly = subjectOptions.filter((option) =>
      SCHEDULE_SUBJECT_SOURCES.has(option.source)
    );
    const byName = new Map();
    scheduleOnly.forEach((option) => {
      const key = String(option.name || "")
        .trim()
        .toLowerCase();
      if (!key || byName.has(key)) return;
      byName.set(key, option);
    });

    const general = subjectOptions.find(
      (option) =>
        option.id === GENERAL_SUBJECT_ID || option.name === GENERAL_SUBJECT
    );
    const merged = [...byName.values()];
    if (general) merged.push(general);
    return sortSubjectOptions(merged);
  }, [subjectOptions]);

  const hasScheduleSubjectsForCreate = useMemo(
    () =>
      scheduleCreateSubjectOptions.some((option) =>
        SCHEDULE_SUBJECT_SOURCES.has(option.source)
      ),
    [scheduleCreateSubjectOptions]
  );

  const createSubjectOptions = useMemo(() => {
    if (hasScheduleSubjectsForCreate) {
      return ensureGeneralSubjectOption(scheduleCreateSubjectOptions);
    }
    return ensureGeneralSubjectOption(subjectOptions);
  }, [
    hasScheduleSubjectsForCreate,
    scheduleCreateSubjectOptions,
    subjectOptions,
  ]);

  const subjectPickerOptions = useMemo(() => {
    const options = isEditMode ? subjectOptions : createSubjectOptions;
    return ensureGeneralSubjectOption(options);
  }, [isEditMode, subjectOptions, createSubjectOptions]);

  const subjectPickerTitle = useMemo(
    () =>
      !isEditMode && hasScheduleSubjectsForCreate
        ? "Select Subject (From Schedule)"
        : "Select Subject",
    [isEditMode, hasScheduleSubjectsForCreate]
  );

  useEffect(() => {
    if (!showCreateModal || isEditMode) return;
    if (createSubjectAutoPickedRef.current) return;
    if (!createSubjectOptions.length) return;
    if (
      createSubjectOptions.length === 1 &&
      createSubjectOptions[0]?.id === GENERAL_SUBJECT_ID
    ) {
      return;
    }

    const preferred =
      createSubjectOptions.find((option) => option.id !== GENERAL_SUBJECT_ID) ||
      createSubjectOptions[0];
    if (!preferred) return;

    setNewTaskSubject(preferred.name);
    setSelectedSubjectId(preferred.id);
    createSubjectAutoPickedRef.current = true;
  }, [showCreateModal, isEditMode, createSubjectOptions]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        const now = Date.now();
        if (now - lastAutoRefreshAtRef.current < AUTO_REFRESH_COOLDOWN_MS) {
          return;
        }
        lastAutoRefreshAtRef.current = now;
        if (isOnline) await flushPendingUpdates();
        if (active) await load();
      };
      run();
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline])
  );

  // Handle opened-from-notification:
  useEffect(() => {
    if (showAlarm !== "1" || !focusTaskId) return;

    const handledKey = `${focusTaskId}:${routeDueAtMs ?? "none"}`;
    if (handledParamRef.current === handledKey) return;

    let active = true;
    const clearAlarmParams = () => {
      router.setParams({
        showAlarm: undefined,
        focusTaskId: undefined,
        pendingAction: undefined,
        dueAtMs: undefined,
      });
    };

    const fetchAndShow = async () => {
      pendingActionRef.current =
        pendingAction === "acknowledge" || pendingAction === "markdone"
          ? pendingAction
          : null;

      try {
        let taskToShow = tasks.find((task) => task.id === focusTaskId) || null;

        if (!taskToShow) {
          const snap = await getDoc(doc(db, "assignments", focusTaskId));
          if (!snap.exists()) {
            handledParamRef.current = handledKey;
            if (active) clearAlarmParams();
            return;
          }

          const taskData = snap.data() || {};
          if (taskData.completed) {
            handledParamRef.current = handledKey;
            if (active) clearAlarmParams();
            return;
          }

          taskToShow = { id: snap.id, ...taskData };
        }

        if (!taskToShow || taskToShow.completed || !active) {
          handledParamRef.current = handledKey;
          if (active) clearAlarmParams();
          return;
        }

        const resolvedDue =
          routeDueAtMs !== null
            ? {
                ...taskToShow,
                dueAt:
                  parseDueDate(taskToShow?.dueAt) || new Date(routeDueAtMs),
                dueAtMs: routeDueAtMs,
              }
            : taskToShow;

        // FIX: Guard showAlarmForTask before calling
        if (typeof showAlarmForTask === "function") {
          showAlarmForTask(resolvedDue);
        }
        handledParamRef.current = handledKey;
        clearAlarmParams();
      } catch (error) {
        warnIfDev(
          "TaskManagerScreen: failed to open task alarm from params:",
          error
        );
      }
    };

    fetchAndShow();
    return () => {
      active = false;
    };
  }, [
    showAlarm,
    focusTaskId,
    pendingAction,
    routeDueAtMs,
    tasks,
    showAlarmForTask,
    router,
  ]);

  useEffect(() => {
    if (isOnline) {
      lastAutoRefreshAtRef.current = Date.now();
      flushPendingUpdates().then(() => load());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const readQueue = async (uid) => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(uid));
      if (!raw) return [];
      return normalizePendingUpdates(JSON.parse(raw));
    } catch (err) {
      warnIfDev(
        "TaskManagerScreen: failed to read pending updates queue:",
        err
      );
      return [];
    }
  };

  const writeQueue = async (uid, queue) => {
    if (!queue.length) {
      await AsyncStorage.removeItem(PENDING_UPDATES_KEY(uid));
    } else {
      await AsyncStorage.setItem(
        PENDING_UPDATES_KEY(uid),
        JSON.stringify(queue)
      );
    }
    // FIX: Guard refreshPendingSyncSummary before calling
    if (typeof refreshPendingSyncSummary === "function") {
      await refreshPendingSyncSummary(uid);
    }
  };

  const refreshPendingCount = async (uid) => {
    const queue = await readQueue(uid);
    await writeQueue(uid, queue);
    setPendingCount(queue.length);
    return queue;
  };

  const queueCompletionUpdate = async (uid, id) => {
    const queue = await readQueue(uid);
    const next = normalizePendingUpdates([
      ...queue,
      { id, action: "complete", queuedAt: new Date().toISOString() },
    ]);
    await writeQueue(uid, next);
    setPendingCount(next.length);
  };

  const loadAdminScheduleSubjects = useCallback(
    async (uid) => {
      if (!uid || !isOnline) return [];
      try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (!userSnap.exists()) return [];
        const profile = extractStudentScheduleProfile(userSnap.data() || {});
        if (!profile) return [];

        const profileKey = [
          uid,
          profile.college,
          profile.course,
          profile.year,
          profile.section,
          profile.scheduleType,
        ].join("|");

        if (scheduleSubjectsRef.current.key === profileKey) {
          return scheduleSubjectsRef.current.names;
        }

        const scheduleMatch = await findBestScheduleDoc(db, profile);
        if (!scheduleMatch?.doc) {
          scheduleSubjectsRef.current = { key: profileKey, names: [] };
          return [];
        }

        const weekSchedule = scheduleMatch.doc.data()?.weekSchedule || {};
        const names = extractScheduleSubjectNames(weekSchedule);
        scheduleSubjectsRef.current = { key: profileKey, names };
        await saveToCache(CACHE_KEYS.schedule(uid) + "_week", weekSchedule);
        return names;
      } catch (err) {
        warnIfDev(
          "TaskManagerScreen: failed to load admin schedule subjects:",
          err
        );
        return [];
      }
    },
    [isOnline]
  );

  const loadSubjectOptions = useCallback(
    async (uid, assignmentItems = []) => {
      if (!uid) return;
      const byName = new Map();
      const sourcePriority = {
        default: 0,
        task: 1,
        schedule: 2,
        catalog: 3,
        schedule_admin: 4,
      };
      const addOption = (value, source = "other", idValue = "") => {
        const raw = typeof value === "string" ? value.trim() : "";
        if (!raw) return;
        const name = normalizeSubjectName(raw);
        const key = name.toLowerCase();
        if (!name || !key) return;
        const id = String(idValue || buildSubjectIdFromName(name)).trim();
        const next = { id: id || buildSubjectIdFromName(name), name, source };
        const prev = byName.get(key);
        if (!prev) {
          byName.set(key, next);
          return;
        }
        const prevPriority = sourcePriority[prev.source] ?? 0;
        const nextPriority = sourcePriority[source] ?? 0;
        const prefersSource = nextPriority > prevPriority;
        const prefersKnownId =
          (!prev.id || prev.id.startsWith("subject_")) && Boolean(idValue);
        if (prefersSource || prefersKnownId) byName.set(key, next);
      };

      addOption(GENERAL_SUBJECT, "default", GENERAL_SUBJECT_ID);

      assignmentItems.forEach((item) =>
        addOption(item?.subjectName || item?.subject, "task", item?.subjectId)
      );

      if (isOnline) {
        const adminScheduleSubjects = await loadAdminScheduleSubjects(uid);
        adminScheduleSubjects.forEach((name) =>
          addOption(name, "schedule_admin")
        );
      }

      try {
        const localRaw = await AsyncStorage.getItem(SUBJECT_CATALOG_KEY(uid));
        const localSubjects = parseSubjectCatalogRaw(localRaw);
        localSubjects.forEach((item) =>
          addOption(item.name, item.source || "catalog", item.id)
        );
      } catch (err) {
        warnIfDev(
          "TaskManagerScreen: failed to load local subject catalog:",
          err
        );
      }

      if (isOnline) {
        try {
          const snap = await getDocs(collection(db, "users", uid, "subjects"));
          snap.forEach((subjectDoc) => {
            const data = subjectDoc.data() || {};
            addOption(data?.name || data?.subject, "catalog", subjectDoc.id);
          });
        } catch (err) {
          warnIfDev(
            "TaskManagerScreen: failed to load remote subject catalog:",
            err
          );
        }
      }

      try {
        const scheduleCache = await loadFromCache(
          CACHE_KEYS.schedule(uid) + "_week"
        );
        const scheduleNames = extractScheduleSubjectNames(
          scheduleCache?.data || {}
        );
        scheduleNames.forEach((name) => addOption(name, "schedule"));
      } catch (err) {
        warnIfDev(
          "TaskManagerScreen: failed to load cached schedule subjects:",
          err
        );
      }

      const nextOptions = sortSubjectOptions(Array.from(byName.values()));
      setSubjectOptions(ensureGeneralSubjectOption(nextOptions));
    },
    [isOnline, loadAdminScheduleSubjects]
  );

  const syncTodayCalendarPlannerTasks = useCallback(
    async (uid, baseDate = new Date()) => {
      if (!uid || !isOnline) return null;
      try {
        const dayKey = toLocalDayKey(baseDate);
        const plans = await loadAllPlans();
        const dayPlans = (Array.isArray(plans) ? plans : []).filter(
          (plan) => String(plan?.dayKey || "").trim() === dayKey
        );
        return await syncCalendarDayPlans(uid, baseDate, dayKey, dayPlans);
      } catch (err) {
        warnIfDev(
          "TaskManagerScreen: failed to sync today's calendar plans:",
          err
        );
        return null;
      }
    },
    [isOnline]
  );

  async function load() {
    const user = auth.currentUser;
    if (!user) return;
    await refreshPendingCount(user.uid);

    if (!isOnline) {
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        const cachedPending = stripArchived(cached.data.pending || []);
        const cachedDone = stripArchived(cached.data.done || []);
        setTasks(cachedPending);
        setHistory(cachedDone);
        await loadSubjectOptions(user.uid, [...cachedPending, ...cachedDone]);
      } else {
        await loadSubjectOptions(user.uid, []);
      }
      setRefreshing(false);
      animateIn();
      return;
    }

    try {
      await syncTodayCalendarPlannerTasks(user.uid, new Date());
      const snap = await getDocs(
        query(collection(db, "assignments"), where("userId", "==", user.uid))
      );
      const all = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        dueAt: normalizeDateToISO(d.data().dueAt),
        createdAt: normalizeDateToISO(d.data().createdAt),
        completedAt: normalizeDateToISO(d.data().completedAt),
      }));
      const visible = stripArchived(all);
      const pending = visible
        .filter((a) => !isTaskCompleted(a))
        .sort((a, b) => {
          const aDue = new Date(a.dueAt),
            bDue = new Date(b.dueAt);
          const now = new Date();
          if (aDue < now !== bDue < now) return aDue < now ? -1 : 1;
          return (
            (Number(a.priorityLevel) || getTaskPriorityLevel(a.priority)) -
            (Number(b.priorityLevel) || getTaskPriorityLevel(b.priority))
          );
        });
      const done = visible
        .filter((a) => isTaskCompleted(a))
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

      setTasks(pending);
      setHistory(done);
      setVisiblePending(PAGE_SIZE);
      setVisibleHistory(PAGE_SIZE);
      await loadSubjectOptions(user.uid, visible);

      const cachedPrev = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      await saveToCache(CACHE_KEYS.assignments(user.uid), {
        pending,
        done,
        ...(cachedPrev?.data || {}),
      });
      // FIX: Guard markSynced before calling
      if (typeof markSynced === "function") {
        await markSynced(user.uid);
      }
    } catch (err) {
      warnIfDev(
        "TaskManagerScreen: failed to load assignments from Firestore:",
        err
      );
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        const cachedPending = stripArchived(cached.data.pending || []);
        const cachedDone = stripArchived(cached.data.done || []);
        setTasks(cachedPending);
        setHistory(cachedDone);
        await loadSubjectOptions(user.uid, [...cachedPending, ...cachedDone]);
      } else {
        await loadSubjectOptions(user.uid, []);
      }
    } finally {
      setRefreshing(false);
      animateIn();
    }
  }

  function animateIn() {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      useNativeDriver: true,
    }).start();
  }

  function stripArchived(items = []) {
    return items.filter((i) => !i?.plannerArchived);
  }

  function resetTaskForm(overrides = {}) {
    setNewTaskTitle(overrides.title ?? "");
    setNewTaskSubject(overrides.subject ?? GENERAL_SUBJECT);
    setSelectedSubjectId(overrides.subjectId ?? GENERAL_SUBJECT_ID);
    setNewTaskType(overrides.type ?? "assignment");
    setNewTaskPriority(overrides.priority ?? "medium");
    setNewTaskDueAt(overrides.dueAt ?? getDefaultDueAt());
    setCustomReminderAt(null);
    setTitleError("");
    setShowDueDatePicker(false);
    setShowDueTimePicker(false);
    setShowReminderPicker(false);
    setShowSubjectPicker(false);
  }

  function openCreateTaskModal() {
    const preferredSubject = getPreferredCreateSubject({
      subjectFilterId,
      routeSubjectName,
      options: createSubjectOptions,
    });
    const subjectFields = buildTaskSubjectFields(
      preferredSubject?.name,
      preferredSubject?.id
    );
    resetTaskForm({
      subject: subjectFields.subjectName,
      subjectId: subjectFields.subjectId,
      dueAt: getQuickCreateDueAt(filter, nowTick),
    });
    setEditingTaskId("");
    setEditingTask(null);
    createSubjectAutoPickedRef.current = Boolean(preferredSubject);
    setShowCreateModal(true);
    const user = auth.currentUser;
    if (user) loadSubjectOptions(user.uid, [...tasks, ...history]);
  }

  function openEditTaskModal(task) {
    if (!task || creatingTask || deletingId || !isOnline) return;
    const user = auth.currentUser;
    const due = parseDueDate(task.dueAt);
    const resolvedDue = due || getDefaultDueAt();
    const subjectFields = buildTaskSubjectFields(
      task.subjectName || task.subject,
      task.subjectId
    );
    const parsedCustomReminder = parseCustomReminderDate(task.customReminderAt);
    setEditingTaskId(task.id);
    setEditingTask(task);
    setNewTaskTitle(String(task.title || ""));
    setTitleError("");
    setNewTaskSubject(subjectFields.subjectName);
    setSelectedSubjectId(subjectFields.subjectId);
    setNewTaskType(normalizeTaskType(task.type));
    setNewTaskPriority(normalizeTaskPriority(task.priority));
    setNewTaskDueAt(resolvedDue);
    setCustomReminderAt(
      isValidCustomReminder(parsedCustomReminder, resolvedDue)
        ? parsedCustomReminder
        : null
    );
    setShowDueDatePicker(false);
    setShowDueTimePicker(false);
    setShowReminderPicker(false);
    setShowSubjectPicker(false);
    setShowCreateModal(true);
    if (user) loadSubjectOptions(user.uid, [...tasks, ...history, task]);
  }

  function closeCreateTaskModal() {
    if (creatingTask) return;
    setShowDueDatePicker(false);
    setShowDueTimePicker(false);
    setShowReminderPicker(false);
    setShowSubjectPicker(false);
    setTitleError("");
    setEditingTaskId("");
    setEditingTask(null);
    setShowCreateModal(false);
  }

  function handleTaskTitleChange(value) {
    setNewTaskTitle(value);
    if (titleError) setTitleError("");
  }

  function selectSubjectOption(option) {
    const normalized = normalizeSubjectOption(option);
    if (!normalized) return;
    const subjectFields = buildTaskSubjectFields(
      normalized.name,
      normalized.id
    );
    setNewTaskSubject(subjectFields.subjectName);
    setSelectedSubjectId(subjectFields.subjectId);
    setShowSubjectPicker(false);
  }

  const dueDateLabel = useMemo(
    () =>
      newTaskDueAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [newTaskDueAt]
  );

  const dueTimeLabel = useMemo(
    () =>
      newTaskDueAt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
    [newTaskDueAt]
  );

  const customReminderLabel = useMemo(() => {
    if (!customReminderAt) return "No custom reminder set";
    return customReminderAt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [customReminderAt]);

  const customReminderLeadLabel = useMemo(() => {
    if (!customReminderAt) return "";
    return `${Math.round(
      (newTaskDueAt.getTime() - customReminderAt.getTime()) / 60000
    )} minutes before due`;
  }, [customReminderAt, newTaskDueAt]);

  function updateDueAt(nextDueAt) {
    if (!(nextDueAt instanceof Date) || Number.isNaN(nextDueAt.getTime())) {
      return;
    }
    setNewTaskDueAt(nextDueAt);
    if (customReminderAt && !isValidCustomReminder(customReminderAt, nextDueAt)) {
      setCustomReminderAt(null);
      Alert.alert(
        "Reminder Cleared",
        "Your custom reminder was cleared because it was no longer before the new due date."
      );
    }
  }

  function applyCustomReminderSelection(selectedReminder) {
    if (!selectedReminder) return;
    if (!isValidCustomReminder(selectedReminder, newTaskDueAt)) {
      Alert.alert(
        "Invalid Reminder",
        "Reminder must be before the due date and in the future."
      );
      return;
    }
    setCustomReminderAt(selectedReminder);
  }

  function openReminderPicker() {
    const now = new Date();
    if (
      !(newTaskDueAt instanceof Date) ||
      Number.isNaN(newTaskDueAt.getTime()) ||
      newTaskDueAt <= now
    ) {
      Alert.alert(
        "Set Due Date First",
        "Choose a future due date before setting a custom reminder."
      );
      return;
    }
    const pickerValue =
      customReminderAt && customReminderAt > now ? customReminderAt : now;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: "datetime",
        minimumDate: now,
        maximumDate: newTaskDueAt,
        onChange: (event, selected) => {
          if (event.type !== "set" || !selected) return;
          applyCustomReminderSelection(selected);
        },
      });
      return;
    }
    setShowReminderPicker(true);
  }

  const quickDueOptions = useMemo(
    () => buildQuickDueOptions(nowTick),
    [nowTick]
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // FIX: Guard rescheduleAll before invoking — this was the primary crash source
  const queueReminderRefresh = useCallback(
    (reason, extra = {}) => {
      if (typeof rescheduleAll !== "function") {
        warnIfDev(
          "TaskManagerScreen: rescheduleAll is not a function, skipping reminder refresh.",
          { reason }
        );
        return;
      }
      void rescheduleAll().catch((error) => {
        reportWarning(error, {
          message: "Failed to refresh reminders after a task change.",
          tags: { location: "task_manager_reschedule", reason },
          extra,
        });
      });
    },
    [rescheduleAll]
  );

  function handleDueDateChange(event, selectedValue) {
    if (event?.type === "dismissed" || !selectedValue) {
      setShowDueDatePicker(false);
      return;
    }
    const next = new Date(newTaskDueAt);
    next.setFullYear(
      selectedValue.getFullYear(),
      selectedValue.getMonth(),
      selectedValue.getDate()
    );
    updateDueAt(next);
    setShowDueDatePicker(false);
  }

  function handleDueTimeChange(event, selectedValue) {
    if (event?.type === "dismissed" || !selectedValue) {
      setShowDueTimePicker(false);
      return;
    }
    const next = new Date(newTaskDueAt);
    next.setHours(selectedValue.getHours(), selectedValue.getMinutes(), 0, 0);
    updateDueAt(next);
    setShowDueTimePicker(false);
  }

  function applyDueQuickOption(option) {
    const dueAt = parseDueDate(option?.dueAt);
    if (!dueAt) return;
    updateDueAt(dueAt);
    setShowDueDatePicker(false);
    setShowDueTimePicker(false);
  }

  async function handleSaveTask() {
    if (creatingTask) return;
    const user = auth.currentUser;
    if (!user) return;

    let newTaskId = null;

    const title = newTaskTitle.trim();
    const subjectFields = buildTaskSubjectFields(
      newTaskSubject,
      selectedSubjectId
    );
    const type = normalizeTaskType(newTaskType);
    const priority = normalizeTaskPriority(newTaskPriority);
    if (!title) {
      setTitleError("Please enter a task title.");
      return;
    }
    setTitleError("");
    if (!isOnline) {
      Alert.alert(
        "Offline",
        isEditMode
          ? "Task editing needs internet right now. Please reconnect and try again."
          : "New task creation needs internet right now. Please reconnect and try again."
      );
      return;
    }

    setCreatingTask(true);
    try {
      // Validate dueAt before Firestore
      const dueDate =
        newTaskDueAt instanceof Date && !Number.isNaN(newTaskDueAt.getTime())
          ? newTaskDueAt
          : getDefaultDueAt();
      if (Number.isNaN(dueDate.getTime())) {
        throw new Error("Invalid due date - cannot create task");
      }
      const dueAtTimestamp = Timestamp.fromDate(dueDate);
      const customReminderTimestamp = isValidCustomReminder(
        customReminderAt,
        dueDate
      )
        ? Timestamp.fromDate(customReminderAt)
        : null;

      if (isEditMode) {
        if (!editingTaskId) throw new Error("Missing task id for update.");
        const updatePayload = {
          title,
          ...subjectFields,
          dueAt: dueAtTimestamp,
          completed: false,
          status: "todo",
          type,
          priority,
          priorityLevel: getTaskPriorityLevel(priority),
          customReminderAt: customReminderTimestamp,
          ...(editingTask?.source === "planner"
            ? {}
            : { reminderPolicy: DEFAULT_MANUAL_TASK_REMINDER_POLICY }),
          updatedAt: serverTimestamp(),
        };
        // FIX: Guard cancelDeadlineAlarms before calling
        if (editingTask && typeof cancelDeadlineAlarms === "function") {
          await cancelDeadlineAlarms(editingTask);
        }
        await updateDoc(doc(db, "assignments", editingTaskId), updatePayload);
      } else {
        const createPayload = buildTaskCreateData(
          {
            userId: user.uid,
            title,
            ...subjectFields,
            dueAt: dueAtTimestamp,
            completed: false,
            status: "todo",
            type,
            priority,
            source: "manual",
            customReminderAt: customReminderTimestamp,
            reminderPolicy: DEFAULT_MANUAL_TASK_REMINDER_POLICY,
          },
          { createdAt: serverTimestamp() }
        );
        const docRef = await addDoc(
          collection(db, "assignments"),
          createPayload
        );
        newTaskId = docRef.id;
      }
      await load();

      // FIX: Guard rescheduleDeadlineAlarmsForTask before calling
      if (typeof rescheduleDeadlineAlarmsForTask === "function") {
        await rescheduleDeadlineAlarmsForTask(editingTaskId || newTaskId);
      }

      setShowCreateModal(false);
      setShowSubjectPicker(false);
      setEditingTaskId("");
      setEditingTask(null);
      setFilter("All");
      setSearchQuery("");
    } catch (error) {
      console.error(
        isEditMode ? "Failed to update task:" : "Failed to create task:",
        error
      );
      Alert.alert(
        isEditMode ? "Update failed" : "Create failed",
        error.message.includes("due date")
          ? "Invalid date selected. Please try again."
          : isEditMode
            ? "Could not update task. Please try again."
            : "Could not create task. Please try again."
      );
    } finally {
      setCreatingTask(false);
    }
  }

  async function quickSnoozeTask(task) {
    const user = auth.currentUser;
    if (!user || !task || snoozingId) return;

    if (!isOnline) {
      Alert.alert(
        "Offline",
        "Quick snooze needs internet right now. Please reconnect and try again."
      );
      return;
    }

    const snoozePlan = getQuickSnoozePlan(task, nowTick);
    if (!snoozePlan?.dueAt) return;

    setSnoozingId(task.id);
    const nextDueIso = normalizeDateToISO(snoozePlan.dueAt);

    setTasks((prev) =>
      prev.map((item) =>
        item.id === task.id ? { ...item, dueAt: nextDueIso } : item
      )
    );

    try {
      await updateDoc(doc(db, "assignments", task.id), {
        dueAt: Timestamp.fromDate(snoozePlan.dueAt),
        updatedAt: serverTimestamp(),
      });

      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        await saveToCache(CACHE_KEYS.assignments(user.uid), {
          ...cached.data,
          pending: (cached.data.pending || []).map((item) =>
            item.id === task.id ? { ...item, dueAt: nextDueIso } : item
          ),
        });
      }

      if (typeof markSynced === "function") {
        await markSynced(user.uid);
      }

      // FIX: Guard rescheduleDeadlineAlarmsForTask before calling
      if (typeof rescheduleDeadlineAlarmsForTask === "function") {
        await rescheduleDeadlineAlarmsForTask(task.id);
      }

      // FIX: Guard Haptics.selectionAsync before calling (was already using ?. but being explicit)
      await Haptics.selectionAsync?.();
    } catch (error) {
      reportError(error, {
        message: "Failed to snooze task.",
        tags: { location: "task_manager_snooze_task" },
        extra: { taskId: task.id },
      });
      await load();
      Alert.alert(
        "Snooze failed",
        "Could not postpone this task right now. Please try again."
      );
    } finally {
      setSnoozingId("");
    }
  }

  async function markComplete(id, { refreshReminders = true } = {}) {
    const user = auth.currentUser;
    if (!user || savingId) return;

    // FIX: Guard Haptics.notificationAsync before calling
    await Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Success);

    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const update = buildTaskCompletionUpdate(new Date());

    setSavingId(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setHistory((prev) => [{ ...task, ...update }, ...prev]);

    // FIX: Guard cancelDeadlineAlarms before calling
    if (task && typeof cancelDeadlineAlarms === "function") {
      await cancelDeadlineAlarms(task);
    }

    if (isOnline) {
      try {
        await updateDoc(doc(db, "assignments", id), update);
        if (typeof markSynced === "function") {
          await markSynced(user.uid);
        }
        if (typeof cancelTodayDigestIfNoPendingTasks === "function") {
          await cancelTodayDigestIfNoPendingTasks(user.uid);
        }
        if (refreshReminders) {
          queueReminderRefresh("task_complete", { taskId: id });
        }

        const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
        if (cached?.data) {
          await saveToCache(CACHE_KEYS.assignments(user.uid), {
            pending: (cached.data.pending || []).filter((a) => a.id !== id),
            done: [{ ...task, ...update }, ...(cached.data.done || [])],
          });
        }
      } catch (err) {
        warnIfDev(
          "TaskManagerScreen: failed to mark task complete online; queueing:",
          err
        );
        await queueCompletionUpdate(user.uid, id);
      }
    } else {
      await queueCompletionUpdate(user.uid, id);
    }
    setSavingId("");
  }

  function deleteTask(task) {
    if (!task || creatingTask || savingId || deletingId) return;
    const user = auth.currentUser;
    if (!user) return;

    if (!isOnline) {
      Alert.alert(
        "Offline",
        "Task deletion needs internet right now. Please reconnect and try again."
      );
      return;
    }

    const isPlannerLinked = task.source === "planner" && !task.plannerArchived;
    const warningText = isPlannerLinked
      ? "This task is linked from Planner. If the source block still exists, it may return after Planner sync."
      : "This action cannot be undone.";

    Alert.alert("Delete Task", `${task.title}\n\n${warningText}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingId(task.id);
          try {
            // FIX: Guard cancelDeadlineAlarms before calling
            if (typeof cancelDeadlineAlarms === "function") {
              await cancelDeadlineAlarms(task);
            }
            await deleteDoc(doc(db, "assignments", task.id));
            setTasks((prev) => prev.filter((item) => item.id !== task.id));
            setHistory((prev) => prev.filter((item) => item.id !== task.id));
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(task.id);
              return next;
            });
            if (editingTaskId === task.id) {
              setShowCreateModal(false);
              setShowSubjectPicker(false);
              setShowReminderPicker(false);
              setCustomReminderAt(null);
              setEditingTaskId("");
              setEditingTask(null);
            }
            if (typeof markSynced === "function") {
              await markSynced(user.uid);
            }
            await load();
            queueReminderRefresh("task_delete", { taskId: task.id });
          } catch (error) {
            reportError(error, {
              message: "Failed to delete task.",
              tags: { location: "task_manager_delete_task" },
              extra: { taskId: task.id },
            });
            Alert.alert(
              "Delete failed",
              "Could not delete task. Please try again."
            );
          } finally {
            setDeletingId("");
          }
        },
      },
    ]);
  }

  async function bulkComplete() {
    if (selectedIds.size === 0) return;
    const user = auth.currentUser;
    if (!user) return;
    Alert.alert(
      "Complete Selected",
      `Mark ${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""} as done?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete All",
          onPress: async () => {
            setBulkSaving(true);
            const update = buildTaskCompletionUpdate(new Date());
            const ids = Array.from(selectedIds);

            const completed = tasks.filter((t) => ids.includes(t.id));
            setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
            setHistory((prev) => [
              ...completed.map((t) => ({ ...t, ...update })),
              ...prev,
            ]);

            for (const t of completed) {
              // FIX: Guard cancelDeadlineAlarms before calling
              if (typeof cancelDeadlineAlarms === "function") {
                await cancelDeadlineAlarms(t);
              }
              if (isOnline) {
                try {
                  await updateDoc(doc(db, "assignments", t.id), update);
                } catch (err) {
                  warnIfDev(
                    "TaskManagerScreen: failed to bulk-complete task online; queueing:",
                    err
                  );
                  await queueCompletionUpdate(user.uid, t.id);
                }
              } else {
                await queueCompletionUpdate(user.uid, t.id);
              }
            }

            if (isOnline) {
              if (typeof markSynced === "function") {
                await markSynced(user.uid);
              }
              if (typeof cancelTodayDigestIfNoPendingTasks === "function") {
                await cancelTodayDigestIfNoPendingTasks(user.uid);
              }
              queueReminderRefresh("task_bulk_complete", {
                taskIds: ids,
                count: ids.length,
              });
            }
            setSelectedIds(new Set());
            setIsBulkMode(false);
            setBulkSaving(false);
          },
        },
      ]
    );
  }

  async function flushPendingUpdates() {
    if (flushingRef.current || !isOnline) return;
    const user = auth.currentUser;
    if (!user) return;
    flushingRef.current = true;
    try {
      const queue = await refreshPendingCount(user.uid);
      if (!queue.length) return;
      const remaining = [];
      for (const item of queue) {
        try {
          if (item.action === "complete") {
            await updateDoc(
              doc(db, "assignments", item.id),
              buildTaskCompletionUpdate(new Date(item.queuedAt))
            );
          } else {
            remaining.push(item);
          }
        } catch (err) {
          warnIfDev(
            "TaskManagerScreen: failed to flush queued task update:",
            err
          );
          remaining.push(item);
        }
      }
      await writeQueue(user.uid, remaining);
      setPendingCount(remaining.length);
      if (remaining.length < queue.length) {
        if (typeof markSynced === "function") {
          await markSynced(user.uid);
        }
        queueReminderRefresh("task_flush_pending", {
          flushedCount: queue.length - remaining.length,
        });
      }
    } finally {
      flushingRef.current = false;
    }
  }

  const openPlannerFromTask = useCallback(
    (task) => {
      const parsed = parsePlannerRef(task?.plannerRef);
      if (!parsed) {
        router.push("/(tabs)/CalendarPlannerScreen");
        return;
      }
      if (parsed.mode === "calendar-day" && parsed.dayKey) {
        router.push({
          pathname: "/(tabs)/CalendarPlannerScreen",
          params: {
            dayKey: parsed.dayKey,
            focusPlanId: parsed.planId,
          },
        });
      } else if (parsed.mode === "day" && parsed.dayKey) {
        router.push({
          pathname: "/(tabs)/CalendarPlannerScreen",
          params: {
            dayKey: parsed.dayKey,
            focusPlanId: parsed.blockId,
          },
        });
      } else if (
        parsed.mode === "month" &&
        parsed.monthKey &&
        parsed.milestoneIndex > 0
      ) {
        router.push({
          pathname: "/(tabs)/CalendarPlannerScreen",
          params: {
            monthKey: parsed.monthKey,
            focusMilestoneIndex: String(parsed.milestoneIndex),
            mode: "month",
          },
        });
      } else {
        router.push("/(tabs)/CalendarPlannerScreen");
      }
    },
    [router]
  );

  // Analytics / Derived values
  const workloadScore = useMemo(() => calculateWorkloadScore(tasks), [tasks]);

  const overdueCount = useMemo(
    () =>
      tasks.filter((t) => {
        const d = parseDueDate(t.dueAt);
        return d && d < nowTick;
      }).length,
    [tasks, nowTick]
  );

  const totalEstimatedMinutes = useMemo(
    () => tasks.reduce((sum, t) => sum + (Number(t.estimatedMinutes) || 0), 0),
    [tasks]
  );

  const completedThisWeek = useMemo(
    () =>
      history.filter((t) => {
        const c = parseDueDate(t.completedAt);
        return c && nowTick.getTime() - c.getTime() <= 7 * DAY_MS;
      }).length,
    [history, nowTick]
  );

  const avgCompletionMs = useMemo(() => {
    const ms = history
      .map((t) => {
        const c = parseDueDate(t.completedAt),
          cr = parseDueDate(t.createdAt);
        if (!c || !cr) return null;
        const diff = c - cr;
        return diff > 0 ? diff : null;
      })
      .filter(Boolean);
    return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  }, [history]);

  const subjectFilterOptions = useMemo(() => {
    const base = [
      { id: SUBJECT_FILTER_ALL_ID, name: "All Subjects" },
      ...subjectOptions,
    ];
    if (
      subjectFilterId !== SUBJECT_FILTER_ALL_ID &&
      !base.some((option) => option.id === subjectFilterId)
    ) {
      base.push({
        id: subjectFilterId,
        name: routeSubjectName || "Selected subject",
        source: "route",
      });
    }
    return base;
  }, [subjectOptions, subjectFilterId, routeSubjectName]);

  const sortLabel =
    SORT_OPTIONS.find((option) => option.key === sortMode)?.label ||
    SORT_OPTIONS[0].label;
  const activeSubjectFilterName =
    subjectFilterOptions.find((option) => option.id === subjectFilterId)
      ?.name || "Selected subject";

  const openSortPicker = () => {
    Alert.alert("Sort Tasks", "Choose how to order pending tasks.", [
      ...SORT_OPTIONS.map((option) => ({
        text: option.label + (option.key === sortMode ? " (Current)" : ""),
        onPress: () => setSortMode(option.key),
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const filtered = useMemo(() => {
    const q = deferredSearchQuery.toLowerCase().trim();
    const result = tasks.filter((t) => {
      if (filter === "Today") {
        const due = parseDueDate(t.dueAt);
        const endToday = new Date(nowTick);
        endToday.setHours(23, 59, 59, 999);
        if (
          !due ||
          due > endToday ||
          due < new Date(nowTick).setHours(0, 0, 0, 0)
        )
          return false;
      } else if (filter === "Overdue") {
        const due = parseDueDate(t.dueAt);
        if (!due || due >= nowTick) return false;
      } else if (filter === "Planner") {
        if (t.source !== "planner") return false;
      } else if (filter === "High" && t.priority !== "high") return false;
      else if (filter === "Medium" && t.priority !== "medium") return false;
      else if (filter === "Low" && t.priority !== "low") return false;
      if (
        subjectFilterId !== SUBJECT_FILTER_ALL_ID &&
        getTaskSubjectId(t) !== subjectFilterId
      ) {
        return false;
      }
      if (q) {
        return (
          t.title?.toLowerCase().includes(q) ||
          (t.subjectName || t.subject || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
    if (sortMode === "priority") {
      return result.sort(
        (a, b) =>
          getTaskPriorityLevel(b.priority) - getTaskPriorityLevel(a.priority)
      );
    }
    if (sortMode === "subject") {
      return result.sort((a, b) => {
        const aSubject = normalizeSubjectName(a.subjectName || a.subject || "");
        const bSubject = normalizeSubjectName(b.subjectName || b.subject || "");
        const bySubject = aSubject.localeCompare(bSubject);
        if (bySubject !== 0) return bySubject;
        const aDue =
          parseDueDate(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bDue =
          parseDueDate(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        return aDue - bDue;
      });
    }
    return result.sort((a, b) => {
      const aDue = parseDueDate(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      const bDue = parseDueDate(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });
  }, [tasks, filter, deferredSearchQuery, nowTick, subjectFilterId, sortMode]);

  const sections = useMemo(() => {
    const buckets = { overdue: [], today: [], week: [], upcoming: [] };
    filtered.forEach((t) => buckets[getSectionKey(t, nowTick)].push(t));
    return [
      {
        key: "overdue",
        label: "Overdue",
        color: "#ef4444",
        items: buckets.overdue,
      },
      {
        key: "today",
        label: "Due Today",
        color: "#f59e0b",
        items: buckets.today,
      },
      {
        key: "week",
        label: "This Week",
        color: "#0ea5e9",
        items: buckets.week,
      },
      {
        key: "upcoming",
        label: "Upcoming",
        color: "#22c55e",
        items: buckets.upcoming,
      },
    ].filter((s) => s.items.length > 0);
  }, [filtered, nowTick]);

  const visibleSections = useMemo(() => {
    let remaining = visiblePending;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.slice(0, remaining),
        _consumed: (() => {
          const n = Math.min(s.items.length, remaining);
          remaining = Math.max(0, remaining - n);
          return n;
        })(),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, visiblePending]);

  const visibleTaskSummary =
    filtered.length === 1
      ? "1 visible task"
      : `${filtered.length} visible tasks`;

  const hasMorePending = filtered.length > visiblePending;
  const visibleHistoryItems = history.slice(0, visibleHistory);
  const sectionCountByKey = useMemo(
    () =>
      new Map(sections.map((section) => [section.key, section.items.length])),
    [sections]
  );
  const taskCounts = useMemo(() => {
    const bySubject = new Map();
    let overdue = 0;
    let high = 0;
    let planner = 0;

    tasks.forEach((task) => {
      const due = parseDueDate(task.dueAt);
      if (due && due < nowTick) overdue += 1;
      if (task.priority === "high") high += 1;
      if (task.source === "planner") planner += 1;

      const subjectId = getTaskSubjectId(task);
      bySubject.set(subjectId, (bySubject.get(subjectId) || 0) + 1);
    });

    return { overdue, high, planner, bySubject };
  }, [tasks, nowTick]);

  // Render
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#f59e0b" />
      <OfflineBanner />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
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
        {/* Hero */}
        <View style={[styles.hero, { paddingTop: insets.top + 16 }]}>
          <View style={styles.heroCircle} />
          <View style={styles.heroCircle2} />
          <Text style={styles.heroSub}>Your academic tasks</Text>
          <Text style={styles.heroTitle}>Task Manager</Text>
          <Text style={styles.heroMeta}>
            Assignment | Quiz | Exam | Project
          </Text>

          {pendingCount > 0 && (
            <View style={styles.syncPill}>
              <Ionicons name="cloud-upload-outline" size={12} color="#fff" />
              <Text style={styles.syncPillText}>
                {pendingCount} update{pendingCount > 1 ? "s" : ""} waiting to
                sync
              </Text>
            </View>
          )}

          <View style={styles.statsRow}>
            {[
              { label: "Pending", value: tasks.length, color: "#fff" },
              { label: "Done", value: history.length, color: "#fff" },
              {
                label: "Overdue",
                value: overdueCount,
                color: overdueCount > 0 ? "#fecaca" : "#fff",
              },
            ].map((s) => (
              <View key={s.label} style={[styles.statBox]}>
                <Text style={[styles.statValue, { color: s.color }]}>
                  {s.value}
                </Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
            {totalEstimatedMinutes > 0 && (
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: "#fff" }]}>
                  {formatEstimatedMinutes(totalEstimatedMinutes)}
                </Text>
                <Text style={styles.statLabel}>Est. work</Text>
              </View>
            )}
          </View>
        </View>

        <Animated.View style={{ opacity: fadeAnim }}>
          <WorkloadBanner
            score={workloadScore}
            colors={colors}
            isDark={isDark}
          />
          <View
            style={[
              styles.controlsCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.controlsHeader}>
              <Text style={[styles.controlsTitle, { color: colors.text }]}>
                Plan the list
              </Text>
              <Text style={[styles.controlsMeta, { color: colors.muted }]}>
                {visibleTaskSummary} | {filter === "All" ? "All views" : filter}{" "}
                | {sortLabel}
              </Text>
            </View>

            <Text style={[styles.controlLabel, { color: colors.muted }]}>
              Search
            </Text>
            <View
              style={[
                styles.searchWrap,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="search"
                size={17}
                color={colors.muted}
                style={{ marginRight: 7 }}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search tasks or subjects..."
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <Ionicons
                    name="close-circle"
                    size={17}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.controlLabel, { color: colors.muted }]}>
              Quick filters
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {FILTERS.map((f) => {
                const isActive = filter === f;
                const chipColor =
                  f === "Overdue"
                    ? "#ef4444"
                    : f === "Today"
                      ? "#f59e0b"
                      : f === "Planner"
                        ? colors.primary
                        : f === "High"
                          ? "#ef4444"
                          : f === "Medium"
                            ? "#f59e0b"
                            : f === "Low"
                              ? "#22c55e"
                              : "#6366f1";
                const countBadge =
                  f === "Overdue"
                    ? taskCounts.overdue
                    : f === "High"
                      ? taskCounts.high
                      : f === "Planner"
                        ? taskCounts.planner
                        : null;
                return (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setFilter(f)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: isActive
                          ? chipColor
                          : colors.background,
                        borderColor: isActive ? chipColor : colors.border,
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
                    {countBadge !== null &&
                      countBadge !== undefined &&
                      countBadge > 0 && (
                        <View
                          style={[
                            styles.filterBadge,
                            {
                              backgroundColor: isActive
                                ? "rgba(255,255,255,0.3)"
                                : chipColor + "22",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.filterBadgeText,
                              { color: isActive ? "#fff" : chipColor },
                            ]}
                          >
                            {countBadge}
                          </Text>
                        </View>
                      )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.subjectFilterHeader}>
              <Text
                style={[styles.subjectFilterLabel, { color: colors.muted }]}
              >
                Subject scope
              </Text>
              <TouchableOpacity
                style={[
                  styles.sortBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={openSortPicker}
              >
                <Ionicons
                  name="swap-vertical-outline"
                  size={13}
                  color={colors.primary}
                />
                <Text style={[styles.sortBtnText, { color: colors.primary }]}>
                  {sortLabel}
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subjectFilters}
            >
              {subjectFilterOptions.map((option) => {
                const isActive = subjectFilterId === option.id;
                const count =
                  option.id === SUBJECT_FILTER_ALL_ID
                    ? tasks.length
                    : taskCounts.bySubject.get(option.id) || 0;
                return (
                  <TouchableOpacity
                    key={option.id}
                    onPress={() => setSubjectFilterId(option.id)}
                    style={[
                      styles.subjectFilterChip,
                      {
                        backgroundColor: isActive
                          ? colors.primary
                          : colors.background,
                        borderColor: isActive ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.subjectFilterText,
                        { color: isActive ? "#fff" : colors.muted },
                      ]}
                    >
                      {option.name}
                    </Text>
                    {count > 0 ? (
                      <View
                        style={[
                          styles.subjectFilterBadge,
                          {
                            backgroundColor: isActive
                              ? "rgba(255,255,255,0.3)"
                              : colors.highlight,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.subjectFilterBadgeText,
                            { color: isActive ? "#fff" : colors.primary },
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.toolbarRow}>
              <View style={styles.toolbarGroup}>
                <TouchableOpacity
                  style={[
                    styles.toolbarBtn,
                    {
                      backgroundColor: isBulkMode
                        ? colors.primary
                        : colors.background,
                      borderColor: isBulkMode ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    setIsBulkMode((v) => !v);
                    setSelectedIds(new Set());
                  }}
                >
                  <Ionicons
                    name={
                      isBulkMode ? "checkmark-done" : "checkmark-done-outline"
                    }
                    size={14}
                    color={isBulkMode ? "#fff" : colors.muted}
                  />
                  <Text
                    style={[
                      styles.toolbarBtnText,
                      { color: isBulkMode ? "#fff" : colors.muted },
                    ]}
                  >
                    {isBulkMode ? `${selectedIds.size} selected` : "Select"}
                  </Text>
                </TouchableOpacity>

                {isBulkMode && selectedIds.size > 0 && (
                  <TouchableOpacity
                    style={[
                      styles.toolbarBtn,
                      {
                        backgroundColor: "#22c55e",
                        borderColor: "#22c55e",
                        opacity: bulkSaving ? 0.6 : 1,
                      },
                    ]}
                    onPress={bulkComplete}
                    disabled={bulkSaving}
                  >
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={14}
                      color="#fff"
                    />
                    <Text style={[styles.toolbarBtnText, { color: "#fff" }]}>
                      {bulkSaving ? "Completing..." : "Complete All"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.toolbarGroup}>
                <TouchableOpacity
                  style={[
                    styles.toolbarBtn,
                    {
                      backgroundColor: showAnalytics
                        ? colors.highlight
                        : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setShowAnalytics((v) => !v)}
                >
                  <Ionicons
                    name="bar-chart-outline"
                    size={14}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.toolbarBtnText, { color: colors.primary }]}
                  >
                    Analytics
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: colors.primary }]}
                  onPress={openCreateTaskModal}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>New Task</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.controlsSummaryRow}>
              <View
                style={[
                  styles.controlsSummaryPill,
                  { backgroundColor: isDark ? "#0f172a" : "#f8fbff" },
                ]}
              >
                <Text
                  style={[styles.controlsSummaryText, { color: colors.text }]}
                >
                  {filter}
                </Text>
              </View>
              <View
                style={[
                  styles.controlsSummaryPill,
                  { backgroundColor: isDark ? "#0f172a" : "#f8fbff" },
                ]}
              >
                <Text
                  style={[styles.controlsSummaryText, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {activeSubjectFilterName}
                </Text>
              </View>
              <View
                style={[
                  styles.controlsSummaryPill,
                  { backgroundColor: isDark ? "#0f172a" : "#f8fbff" },
                ]}
              >
                <Text
                  style={[styles.controlsSummaryText, { color: colors.text }]}
                >
                  {sortLabel}
                </Text>
              </View>
            </View>
          </View>

          {/* Analytics panel */}
          {showAnalytics && (
            <View
              style={[
                styles.analyticsCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.analyticsHeader}>
                <Text style={[styles.analyticsTitle, { color: colors.text }]}>
                  Weekly Snapshot
                </Text>
                <Text
                  style={[styles.analyticsSubtitle, { color: colors.muted }]}
                >
                  Completed, finish time, and overdue work at a glance.
                </Text>
              </View>
              <View style={styles.analyticsRow}>
                <View
                  style={[
                    styles.analyticsStat,
                    {
                      backgroundColor: isDark ? "#0f172a" : "#f8fbff",
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.analyticsValue, { color: colors.text }]}>
                    {completedThisWeek}
                  </Text>
                  <Text
                    style={[styles.analyticsLabel, { color: colors.muted }]}
                  >
                    Done this week
                  </Text>
                </View>
                <View
                  style={[
                    styles.analyticsStat,
                    {
                      backgroundColor: isDark ? "#0f172a" : "#f8fbff",
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.analyticsValue, { color: colors.text }]}>
                    {avgCompletionMs ? formatDurationMs(avgCompletionMs) : "-"}
                  </Text>
                  <Text
                    style={[styles.analyticsLabel, { color: colors.muted }]}
                  >
                    Avg. finish time
                  </Text>
                </View>
                <View
                  style={[
                    styles.analyticsStat,
                    {
                      backgroundColor: isDark ? "#0f172a" : "#f8fbff",
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.analyticsValue,
                      { color: overdueCount > 0 ? "#ef4444" : colors.text },
                    ]}
                  >
                    {overdueCount}
                  </Text>
                  <Text
                    style={[styles.analyticsLabel, { color: colors.muted }]}
                  >
                    Overdue
                  </Text>
                </View>
              </View>
              <SubjectBreakdown
                tasks={tasks}
                colors={colors}
                isDark={isDark}
                nowTick={nowTick}
              />
            </View>
          )}

          {/* Task sections */}
          {filtered.length === 0 ? (
            <EmptyStateCard
              title={
                searchQuery
                  ? `No results for "${searchQuery}"`
                  : subjectFilterId !== SUBJECT_FILTER_ALL_ID
                    ? `No tasks for ${activeSubjectFilterName}`
                    : filter === "All"
                      ? "No pending tasks"
                      : filter === "Planner"
                        ? "No planner-linked tasks"
                        : `No ${filter.toLowerCase()} tasks`
              }
              message={
                searchQuery
                  ? "Try a different search term."
                  : subjectFilterId !== SUBJECT_FILTER_ALL_ID
                    ? "Try another subject or switch to All Subjects."
                    : filter === "Planner"
                      ? "Create time blocks in the Planner to auto-generate linked tasks."
                      : "You're all caught up - great work!"
              }
              icon="checkmark-circle-outline"
              style={{ marginHorizontal: 16, marginTop: 12 }}
            />
          ) : (
            visibleSections.map((section) => (
              <View key={section.key}>
                <View style={styles.sectionHeader}>
                  <View
                    style={[
                      styles.sectionDot,
                      { backgroundColor: section.color },
                    ]}
                  />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {section.label}
                  </Text>
                  <View
                    style={[
                      styles.sectionCount,
                      { backgroundColor: section.color + "18" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionCountText,
                        { color: section.color },
                      ]}
                    >
                      {sectionCountByKey.get(section.key) || 0}
                    </Text>
                  </View>
                </View>
                <View style={styles.taskList}>
                  {section.items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      nowTick={nowTick}
                      colors={colors}
                      isDark={isDark}
                      isSelected={selectedIds.has(t.id)}
                      isBulkMode={isBulkMode}
                      isHighlighted={Boolean(
                        highlightedTaskId && t.id === highlightedTaskId
                      )}
                      savingMode={savingId === t.id}
                      snoozingMode={snoozingId === t.id}
                      deletingMode={deletingId === t.id}
                      onDone={() => markComplete(t.id)}
                      onSnooze={() => quickSnoozeTask(t)}
                      onEdit={() => openEditTaskModal(t)}
                      canEdit={isOnline}
                      onDelete={() => deleteTask(t)}
                      onOpenPlanner={() => openPlannerFromTask(t)}
                      onToggleSelect={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) {
                            next.delete(t.id);
                          } else {
                            next.add(t.id);
                          }
                          return next;
                        });
                      }}
                    />
                  ))}
                </View>
              </View>
            ))
          )}

          {hasMorePending && (
            <TouchableOpacity
              style={[
                styles.loadMoreBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
              onPress={() => setVisiblePending((prev) => prev + PAGE_SIZE)}
            >
              <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                Load more tasks ({filtered.length - visiblePending} remaining)
              </Text>
            </TouchableOpacity>
          )}

          {/* History */}
          {history.length > 0 && (
            <>
              <TouchableOpacity
                style={[
                  styles.historyToggle,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                onPress={() => setShowHistory((v) => !v)}
              >
                <View style={styles.historyToggleInner}>
                  <View
                    style={[
                      styles.historyToggleIconBox,
                      { backgroundColor: isDark ? "#0f172a" : "#eff6ff" },
                    ]}
                  >
                    <Ionicons
                      name="checkmark-done-circle-outline"
                      size={16}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.historyToggleCopy}>
                    <Text
                      style={[
                        styles.historyToggleTitle,
                        { color: colors.text },
                      ]}
                    >
                      Completed History
                    </Text>
                    <Text
                      style={[
                        styles.historyToggleMeta,
                        { color: colors.muted },
                      ]}
                    >
                      {history.length} finished task
                      {history.length === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Ionicons
                    name={showHistory ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                    style={{ marginLeft: "auto" }}
                  />
                </View>
              </TouchableOpacity>

              {showHistory && (
                <View style={styles.historyList}>
                  {visibleHistoryItems.map((t) => {
                    const cMs = (() => {
                      const c = parseDueDate(t.completedAt),
                        cr = parseDueDate(t.createdAt);
                      if (!c || !cr) return null;
                      const d = c - cr;
                      return d > 0 ? d : null;
                    })();
                    const isPlannerLinked = t.source === "planner";
                    return (
                      <View
                        key={t.id}
                        style={[
                          styles.historyRow,
                          { backgroundColor: isDark ? "#1e293b" : "#f8fafc" },
                          highlightedTaskId === t.id && {
                            borderWidth: 1.5,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Ionicons
                          name="checkmark-circle"
                          size={15}
                          color="#22c55e"
                        />
                        <View style={styles.historyContent}>
                          <Text
                            style={[styles.historyText, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {t.title}
                          </Text>
                          <View style={styles.historyMetaRow}>
                            <Text
                              style={[
                                styles.historyMeta,
                                { color: colors.muted },
                              ]}
                              numberOfLines={1}
                            >
                              {formatDurationMs(cMs)}
                            </Text>
                            {isPlannerLinked && (
                              <View
                                style={[
                                  styles.historyPlannerPill,
                                  {
                                    backgroundColor: isDark
                                      ? "#082f49"
                                      : "#e0f2fe",
                                  },
                                ]}
                              >
                                <Ionicons
                                  name="link-outline"
                                  size={10}
                                  color={isDark ? "#7dd3fc" : "#0369a1"}
                                />
                                <Text
                                  style={[
                                    styles.historyPlannerText,
                                    { color: isDark ? "#bae6fd" : "#0369a1" },
                                  ]}
                                >
                                  Planner
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                        <View style={styles.historyActions}>
                          {isPlannerLinked && (
                            <TouchableOpacity
                              style={[
                                styles.historyPlanBtn,
                                {
                                  borderColor: colors.primary,
                                  backgroundColor: isDark
                                    ? "#0f172a"
                                    : "#eff6ff",
                                },
                              ]}
                              onPress={() => openPlannerFromTask(t)}
                            >
                              <Ionicons
                                name="calendar-outline"
                                size={11}
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
                          )}
                          <TouchableOpacity
                            style={[
                              styles.historyDeleteBtn,
                              {
                                borderColor: "#fecaca",
                                backgroundColor: isDark ? "#3f1d1d" : "#fff1f2",
                                opacity: deletingId === t.id ? 0.65 : 1,
                              },
                            ]}
                            onPress={() => deleteTask(t)}
                            disabled={Boolean(deletingId === t.id)}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={11}
                              color="#ef4444"
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  {history.length > visibleHistory && (
                    <TouchableOpacity
                      style={[
                        styles.loadMoreBtn,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.card,
                        },
                      ]}
                      onPress={() =>
                        setVisibleHistory((prev) => prev + PAGE_SIZE)
                      }
                    >
                      <Text
                        style={[styles.loadMoreText, { color: colors.primary }]}
                      >
                        Load more completed
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          )}

          <View style={{ height: 32 }} />
        </Animated.View>
      </ScrollView>

      {/* Create / Edit modal */}
      <TaskEditorModal
        visible={showCreateModal}
        onClose={closeCreateTaskModal}
        colors={colors}
        isDark={isDark}
        isEditMode={isEditMode}
        isSubmitting={creatingTask}
        taskTitle={newTaskTitle}
        onChangeTaskTitle={handleTaskTitleChange}
        titleError={titleError}
        subjectName={newTaskSubject}
        generalSubjectLabel={GENERAL_SUBJECT}
        onOpenSubjectPicker={() => setShowSubjectPicker(true)}
        showSubjectPicker={showSubjectPicker}
        onCloseSubjectPicker={() => setShowSubjectPicker(false)}
        subjectPickerOptions={subjectPickerOptions}
        subjectPickerTitle={subjectPickerTitle}
        selectedSubjectId={selectedSubjectId}
        onSelectSubject={selectSubjectOption}
        dueAt={newTaskDueAt}
        dueDateLabel={dueDateLabel}
        dueTimeLabel={dueTimeLabel}
        dueQuickOptions={quickDueOptions}
        showDueDatePicker={showDueDatePicker}
        showDueTimePicker={showDueTimePicker}
        customReminderAt={customReminderAt}
        customReminderLabel={customReminderLabel}
        customReminderLeadLabel={customReminderLeadLabel}
        showReminderPicker={showReminderPicker}
        showClearedReminderHint={
          isEditMode && Boolean(editingTask?.customReminderAt) && !customReminderAt
        }
        onOpenDueDatePicker={() => setShowDueDatePicker(true)}
        onOpenDueTimePicker={() => setShowDueTimePicker(true)}
        onOpenReminderPicker={openReminderPicker}
        onCloseReminderPicker={() => setShowReminderPicker(false)}
        onDueDateChange={handleDueDateChange}
        onDueTimeChange={handleDueTimeChange}
        onReminderChange={applyCustomReminderSelection}
        onClearCustomReminder={() => setCustomReminderAt(null)}
        onApplyDueQuickOption={applyDueQuickOption}
        priorityOptions={CREATE_PRIORITY_OPTIONS}
        priorityValue={newTaskPriority}
        onChangePriority={setNewTaskPriority}
        typeRows={TYPE_ROWS}
        typeMeta={TYPE_META}
        typeValue={newTaskType}
        onChangeType={setNewTaskType}
        onSubmit={handleSaveTask}
      />

      {/* Deadline Alarm Modal */}
      <DeadlineAlarmModal
        visible={alarmVisible}
        task={alarmTask}
        onNotDone={async () => {
          pendingActionRef.current = null;
          if (typeof notDoneAlarm === "function") {
            await notDoneAlarm();
          }
        }}
        onMarkDone={async () => {
          const taskId = alarmTask?.id;
          if (!taskId) return;
          pendingActionRef.current = null;
          if (typeof markDoneAlarm === "function") {
            await markDoneAlarm();
          }
          await markComplete(taskId, { refreshReminders: false });
          // FIX: Guard clearTaskAlarmSuppression and rescheduleDeadlineAlarmsForTask
          if (typeof clearTaskAlarmSuppression === "function") {
            await clearTaskAlarmSuppression(taskId);
          }
          if (typeof rescheduleDeadlineAlarmsForTask === "function") {
            await rescheduleDeadlineAlarmsForTask(taskId);
          }
          if (typeof dismissAlarm === "function") {
            dismissAlarm();
          }
        }}
        pendingAction={pendingActionRef.current}
      />
    </View>
  );
}

// StyleSheet
const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingBottom: 32 },

  hero: {
    backgroundColor: "#f59e0b",
    paddingBottom: 22,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
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
    right: 60,
  },
  heroSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 2,
  },
  heroTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 3,
  },
  heroMeta: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 11,
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
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  statValue: { fontSize: 20, fontWeight: "800", lineHeight: 22 },
  statLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginTop: 1,
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500" },

  controlsCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  controlsHeader: { marginBottom: 12 },
  controlsTitle: { fontSize: 15, fontWeight: "800", marginBottom: 3 },
  controlsMeta: { fontSize: 12, fontWeight: "600", lineHeight: 18 },
  controlLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 12,
  },
  filters: { paddingTop: 0, paddingBottom: 8, gap: 8 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1.5,
  },
  filterText: { fontSize: 12, fontWeight: "700" },
  filterBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 99,
    minWidth: 16,
    alignItems: "center",
  },
  filterBadgeText: { fontSize: 10, fontWeight: "800" },
  subjectFilterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    marginBottom: 6,
  },
  subjectFilterLabel: { fontSize: 11, fontWeight: "700" },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  sortBtnText: { fontSize: 11, fontWeight: "700" },
  subjectFilters: { paddingTop: 0, paddingBottom: 10, gap: 8 },
  subjectFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
  },
  subjectFilterText: { fontSize: 11, fontWeight: "700" },
  subjectFilterBadge: {
    minWidth: 16,
    alignItems: "center",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 99,
  },
  subjectFilterBadgeText: { fontSize: 10, fontWeight: "800" },

  toolbarRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
    marginTop: 2,
  },
  toolbarGroup: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 38,
  },
  toolbarBtnText: { fontSize: 12, fontWeight: "700" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    minHeight: 38,
  },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  controlsSummaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  controlsSummaryPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  controlsSummaryText: { fontSize: 11, fontWeight: "700" },

  analyticsCard: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  analyticsHeader: { marginBottom: 10 },
  analyticsTitle: { fontSize: 13, fontWeight: "800", marginBottom: 3 },
  analyticsSubtitle: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  analyticsRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  analyticsStat: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
  },
  analyticsValue: { fontSize: 16, fontWeight: "900", marginBottom: 2 },
  analyticsLabel: { fontSize: 10, fontWeight: "700", textAlign: "center" },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "800", flex: 1 },
  sectionCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  sectionCountText: { fontSize: 11, fontWeight: "800" },

  taskList: { paddingHorizontal: 16 },

  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 2,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 12, fontWeight: "700" },

  historyToggle: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 2,
    borderRadius: 10,
    borderWidth: 1,
    padding: 11,
  },
  historyToggleInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  historyToggleIconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  historyToggleCopy: { flex: 1, minWidth: 0 },
  historyToggleTitle: { fontSize: 13, fontWeight: "800", marginBottom: 2 },
  historyToggleMeta: { fontSize: 11, fontWeight: "600" },
  historyList: { paddingHorizontal: 16, gap: 8, marginTop: 8 },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  historyContent: { flex: 1, minWidth: 0 },
  historyText: { fontSize: 12, fontWeight: "700" },
  historyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  historyMeta: { fontSize: 10, fontWeight: "500" },
  historyActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 6,
  },
  historyPlannerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
  historyPlannerText: { fontSize: 10, fontWeight: "700" },
  historyPlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  historyPlanText: { fontSize: 10, fontWeight: "700" },
  historyDeleteBtn: {
    width: 28,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});


