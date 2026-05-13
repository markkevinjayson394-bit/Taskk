/**
 * app/(tabs)/home.js    Student Dashboard
 *
 * IMPROVEMENTS:
 * - Auto-refresh when tab comes into focus (useFocusEffect)
 * - Better text contrast/visibility in both light & dark mode
 * - Larger, bolder labels and section headers
 * - Card text no longer clipped or invisible on dark backgrounds
 * - Pull-to-refresh still works as before
 */
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
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
import {
    Alert,
    Animated,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DeadlineAlarmModal, {
    useDeadlineAlarmScheduler,
} from "../../components/DeadlineAlarmModal";
import EmptyStateCard from "../../components/EmptyStateCard";
import LoadingState from "../../components/LoadingState";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import {
    CACHE_KEYS,
    formatSyncTime,
    loadFromCache,
    saveToCache,
    useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import {
    PRIORITY_COLOR,
    daysUntil,
    getGreeting,
    getTodayString,
    resolveTaskDueDate,
    safeParseObject,
} from "../../features/tab-modules/home.helpers";
import { buildTaskCompletionUpdate } from "../../utils/academicTaskModel";
import { cancelDeadlineAlarms } from "../../utils/deadlineAlarmBackground";
import { formatDeadlineCountdown } from "../../utils/deadlineTime";
import { reportError, reportWarning, warnIfDev } from "../../utils/logger";
import {
    isLocalOnlyTaskId,
    removeOfflineQueuedTask,
} from "../../utils/offlineTaskQueue";
import { findBestScheduleDoc } from "../../utils/scheduleMatcher";
import { getTabBarContentBottomPadding } from "../../utils/tabBarLayout";
import {
    calculateDailyWorkload,
    getWorkloadLabel,
} from "../../utils/workloadCalculator";

const PLANS_KEY = (uid) => `exam_prep_plans_${uid}`;
const STATUS_CARD_WIDTH = 300;
const STATUS_CARD_GAP = 12;
const FOCUS_REFRESH_COOLDOWN_MS = 15 * 1000;
const WORKLOAD_COLOR = {
  Light: "#22c55e",
  Moderate: "#f59e0b",
  Heavy: "#ef4444",
};

function WorkloadBanner({ tasks, colors }) {
  const score = calculateDailyWorkload(tasks);
  const label = getWorkloadLabel(score);
  const color = WORKLOAD_COLOR[label] || colors.primary;
  const icons = {
    Light: "leaf-outline",
    Moderate: "time-outline",
    Heavy: "flame-outline",
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 2,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 16,
        backgroundColor: color + "18",
        borderWidth: 1.5,
        borderColor: color + "40",
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: color + "22",
          justifyContent: "center",
          alignItems: "center",
          marginRight: 12,
        }}
      >
        <Ionicons
          name={icons[label] || "pulse-outline"}
          size={18}
          color={color}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: "700",
            color: colors.muted,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {"Today's Workload"}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: "800", color, marginTop: 1 }}>
          {label}
        </Text>
      </View>
      <Text style={{ fontSize: 22, fontWeight: "900", color, opacity: 0.8 }}>
        {score}
      </Text>
    </View>
  );
}

function DashboardSectionHeader({
  title,
  hint,
  actionLabel,
  actionColor,
  onPress,
  colors,
}) {
  const resolvedActionColor = actionColor || colors.primary;
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderCopy}>
        <Text style={[styles.sectionLabel, { color: colors.text }]}>
          {title}
        </Text>
        {hint ? (
          <Text style={[styles.sectionHint, { color: colors.muted }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      {actionLabel && onPress ? (
        <TouchableOpacity
          style={[
            styles.sectionAction,
            {
              backgroundColor: `${resolvedActionColor}14`,
              borderColor: `${resolvedActionColor}2a`,
            },
          ]}
          onPress={onPress}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.sectionActionText, { color: resolvedActionColor }]}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function buildAcademicLabel({ course, year, section, semester, academicYear }) {
  const parts = [];
  if (course) parts.push(course);
  if (year || section) {
    parts.push(
      [year ? `Year ${year}` : null, section ? `Sec ${section}` : null]
        .filter(Boolean)
        .join(" - ")
    );
  }
  if (semester) parts.push(semester);
  if (academicYear) parts.push(academicYear);
  return parts.join(" - ");
}

function urgencyColor(days) {
  if (days <= 1) return "#ef4444";
  if (days <= 3) return "#f59e0b";
  if (days <= 7) return "#0ea5e9";
  return "#10b981";
}

function parseTimeToMinutes(value) {
  if (!value) return null;
  const dateValue = new Date(value);
  if (!Number.isNaN(dateValue.getTime())) {
    return dateValue.getHours() * 60 + dateValue.getMinutes();
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = (match[3] || "").toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function getClassTimeRange(cls) {
  let start = parseTimeToMinutes(cls?.start);
  let end = parseTimeToMinutes(cls?.end);
  const display = String(cls?.timeDisplay || "");
  if (display.includes("-")) {
    const [left, right] = display.split("-").map((p) => p.trim());
    if (start === null) start = parseTimeToMinutes(left);
    if (end === null) end = parseTimeToMinutes(right);
  }
  if (start === null) return null;
  if (end === null || end <= start) end = start + 60;
  return { start, end };
}

function formatMinutesToClock(totalMinutes) {
  if (typeof totalMinutes !== "number" || Number.isNaN(totalMinutes)) return "";
  const safeMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hour24 = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export default function HomeDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const {
    rescheduleAll,
    rescheduleDeadlineAlarmsForTask,
    clearTaskAlarmSuppression,
  } = useNotifications();
  const {
    isOnline,
    lastSync,
    pendingSyncSummary,
    checkConnectivity,
    markSynced,
  } = useOffline();

  const [fullName, setFullName] = useState("");
  const [semester, setSemester] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [section, setSection] = useState("");
  const [needsAcademicInfo, setNeedsAcademicInfo] = useState(false);

  const [todayClasses, setTodayClasses] = useState([]);
  const [currentClassId, setCurrentClassId] = useState(null);
  const [nextClassId, setNextClassId] = useState(null);
  const [upcomingAssignments, setUpcomingAssignments] = useState([]);

  const [announcements, setAnnouncements] = useState([]);
  const [upcomingExams, setUpcomingExams] = useState([]);
  const [examPlans, setExamPlans] = useState({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showingCached, setShowingCached] = useState(false);
  const [nowTick, setNowTick] = useState(() => new Date());

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const hasLoaded = useRef(false);
  const lastSilentRefreshAtRef = useRef(0);

  const {
    alarmVisible,
    alarmTask,
    alarmThresholdKey,
    acknowledgeAlarm,
    notDoneAlarm,
  } = useDeadlineAlarmScheduler(upcomingAssignments, {
    foregroundModalEnabled: false,
  });

  const stripArchived = (items = []) =>
    items.filter((item) => !item?.plannerArchived);

  const queueReminderRefresh = useCallback(
    (reason, extra = {}) => {
      void rescheduleAll().catch((error) => {
        reportWarning(error, {
          message: "Failed to refresh reminders after a dashboard task change.",
          tags: { location: "home_dashboard_reschedule", reason },
          extra,
        });
      });
    },
    [rescheduleAll]
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasLoaded.current) {
        fetchDashboardData(true, { forceRefresh: true });
        hasLoaded.current = true;
      } else {
        const now = Date.now();
        if (now - lastSilentRefreshAtRef.current >= FOCUS_REFRESH_COOLDOWN_MS) {
          lastSilentRefreshAtRef.current = now;
          fetchDashboardData(false, { forceRefresh: true });
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  useEffect(() => {
    const tick = setInterval(() => {
      setNowTick(new Date());
    }, 60 * 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (todayClasses.length === 0) return;
    const nowMinutes = nowTick.getHours() * 60 + nowTick.getMinutes();

    const current = todayClasses.find((cls) => {
      const range = getClassTimeRange(cls);
      return range
        ? nowMinutes >= range.start && nowMinutes < range.end
        : false;
    });

    const next = todayClasses.find((cls) => {
      const range = getClassTimeRange(cls);
      return range ? range.start > nowMinutes : false;
    });

    setCurrentClassId(current?._localId || null);
    setNextClassId(next?._localId || null);
  }, [nowTick, todayClasses]);

  const animateIn = () => {
    fadeAnim.setValue(0);
    slideAnim.setValue(24);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 480,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 480,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const applyWeekSchedule = (weekSchedule = {}) => {
    const todayName = new Date().toLocaleString("en-US", { weekday: "long" });
    const classesToday = (weekSchedule[todayName] || [])
      .map((cls, index) => ({
        ...cls,
        _localId: `${index}-${cls.subject || "class"}`,
      }))
      .sort((a, b) => {
        const aStart = getClassTimeRange(a)?.start ?? Number.POSITIVE_INFINITY;
        const bStart = getClassTimeRange(b)?.start ?? Number.POSITIVE_INFINITY;
        return aStart - bStart;
      });

    setTodayClasses(classesToday);

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const current = classesToday.find((cls) => {
      const range = getClassTimeRange(cls);
      return range
        ? nowMinutes >= range.start && nowMinutes < range.end
        : false;
    });

    const next = classesToday.find((cls) => {
      const range = getClassTimeRange(cls);
      return range ? range.start > nowMinutes : false;
    });

    setCurrentClassId(current?._localId || null);
    setNextClassId(next?._localId || null);
  };

  const loadFromOfflineCache = async (uid, { markCached = false } = {}) => {
    if (markCached) setShowingCached(true);

    const [profileCache, scheduleCache, assignmentsCache, announcementsCache] =
      await Promise.all([
        loadFromCache(CACHE_KEYS.profile(uid)),
        loadFromCache(CACHE_KEYS.schedule(uid) + "_week"),
        loadFromCache(CACHE_KEYS.assignments(uid)),
        loadFromCache(CACHE_KEYS.announcements(uid)),
      ]);

    if (profileCache?.data?.fullName) {
      setFullName(profileCache.data.fullName || "");
    }

    const cachedInfo = profileCache?.data?.studentInfo || {};
    setSemester(cachedInfo.semester || "");
    setAcademicYear(cachedInfo.academicYear || "");
    setCourse(cachedInfo.course || "");
    setYear(cachedInfo.year || "");
    setSection(cachedInfo.section || "");
    setNeedsAcademicInfo(
      !cachedInfo.course || !cachedInfo.year || !cachedInfo.section
    );

    if (scheduleCache?.data) {
      applyWeekSchedule(scheduleCache.data || {});
    } else {
      setTodayClasses([]);
      setCurrentClassId(null);
      setNextClassId(null);
    }

    const cachedPending = stripArchived(assignmentsCache?.data?.pending || []);
    setUpcomingAssignments(cachedPending);

    const now = new Date();
    const exams = cachedPending
      .filter(
        (t) =>
          t.type === "exam" &&
          resolveTaskDueDate(t) !== null &&
          resolveTaskDueDate(t) > now
      )
      .sort((a, b) => {
        const aDate = resolveTaskDueDate(a);
        const bDate = resolveTaskDueDate(b);
        if (!aDate || !bDate) return 0;
        return aDate - bDate;
      })
      .slice(0, 3);

    setUpcomingExams(exams);

    const rawPlans = await AsyncStorage.getItem(PLANS_KEY(uid));
    setExamPlans(safeParseObject(rawPlans, {}));

    if (announcementsCache?.data) {
      setAnnouncements(announcementsCache.data);
    } else {
      setAnnouncements([]);
    }
  };

  const fetchDashboardData = async (
    showLoadingSpinner = false,
    { forceRefresh = false } = {}
  ) => {
    if (!forceRefresh && !showLoadingSpinner) {
      const now = Date.now();
      if (now - lastSilentRefreshAtRef.current < FOCUS_REFRESH_COOLDOWN_MS) {
        return;
      }
      lastSilentRefreshAtRef.current = now;
    }

    if (showLoadingSpinner) setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) return;

      await loadFromOfflineCache(user.uid, { markCached: !isOnline });

      if (!isOnline) return;

      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) {
        setNeedsAcademicInfo(true);
        return;
      }

      const userData = userSnap.data();
      setFullName(userData.fullName || "");

      const profile = userData.studentInfo || {};
      const {
        college,
        course: scheduleCourse,
        year: scheduleYear,
        section: scheduleSection,
        scheduleType,
      } = profile;

      setSemester(profile.semester || "");
      setAcademicYear(profile.academicYear || "");
      setCourse(scheduleCourse || "");
      setYear(scheduleYear || "");
      setSection(scheduleSection || "");

      await saveToCache(CACHE_KEYS.profile(user.uid), userData);

      const hasScheduleProfile = Boolean(
        scheduleCourse && scheduleYear && scheduleSection
      );
      setNeedsAcademicInfo(!hasScheduleProfile);

      const schedulePromise = hasScheduleProfile
        ? findBestScheduleDoc(db, {
            college,
            course: scheduleCourse,
            year: scheduleYear,
            section: scheduleSection,
            scheduleType,
          })
        : Promise.resolve(null);

      const assignmentsPromise = getDocs(
        query(
          collection(db, "assignments"),
          where("userId", "==", user.uid),
          where("completed", "==", false),
          orderBy("dueAt")
        )
      );

      const announcementsPromise = getDocs(
        query(collection(db, "announcements"), orderBy("createdAt", "desc"))
      );

      const rawPlansPromise = AsyncStorage.getItem(PLANS_KEY(user.uid));

      const [scheduleMatch, aSnap, annSnap, rawPlans] = await Promise.all([
        schedulePromise,
        assignmentsPromise,
        announcementsPromise,
        rawPlansPromise,
      ]);

      if (scheduleMatch?.doc) {
        const weekSchedule = scheduleMatch.doc.data().weekSchedule || {};
        applyWeekSchedule(weekSchedule);
        await saveToCache(
          CACHE_KEYS.schedule(user.uid) + "_week",
          weekSchedule
        );
      } else {
        setTodayClasses([]);
        setCurrentClassId(null);
        setNextClassId(null);
      }

      const allTasks = stripArchived(
        aSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      );
      setUpcomingAssignments(allTasks);

      const assignmentsCache = await loadFromCache(
        CACHE_KEYS.assignments(user.uid)
      );
      const cachedDone = assignmentsCache?.data?.done || [];
      await saveToCache(CACHE_KEYS.assignments(user.uid), {
        pending: allTasks,
        done: cachedDone,
      });

      const now = new Date();
      const exams = allTasks
        .filter((t) => t.type === "exam" && resolveTaskDueDate(t) > now)
        .sort((a, b) => resolveTaskDueDate(a) - resolveTaskDueDate(b))
        .slice(0, 3);

      setUpcomingExams(exams);
      setExamPlans(safeParseObject(rawPlans, {}));

      const filtered = annSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          if (a.audience === "all") return true;
          if (
            a.audience === "year" &&
            a.year === scheduleYear &&
            (!a.college || a.college === college)
          )
            return true;
          if (
            a.audience === "course" &&
            a.course === scheduleCourse &&
            a.year === scheduleYear &&
            a.section === scheduleSection &&
            (!a.college || a.college === college)
          )
            return true;
          return false;
        });

      setAnnouncements(filtered);
      await saveToCache(CACHE_KEYS.announcements(user.uid), filtered);

      await markSynced(user.uid);
      setShowingCached(false);
    } catch (error) {
      reportWarning(error, {
        message: "Failed to load dashboard data. Falling back to cached data.",
        tags: { location: "home_dashboard_load" },
        extra: { userId: auth.currentUser?.uid || null },
      });

      if (auth.currentUser) {
        await loadFromOfflineCache(auth.currentUser.uid, {
          markCached: true,
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      animateIn();
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData(false, { forceRefresh: true });
  };

  const markDone = async (assignment) => {
    if (!assignment?.id) return;
    const user = auth.currentUser;
    if (!user) return;

    // Optimistic removal
    setUpcomingAssignments((prev) =>
      prev.filter((t) => t.id !== assignment.id)
    );
    setUpcomingExams((prev) => prev.filter((t) => t.id !== assignment.id));

    try {
      // Step 1: Cancel alarms — never let this abort the whole flow
      try {
        await cancelDeadlineAlarms(assignment);
      } catch (cancelErr) {
        reportWarning(cancelErr, {
          message: "cancelDeadlineAlarms failed during markDone — continuing.",
          tags: { location: "home_dashboard_mark_done_cancel_alarms" },
          extra: { taskId: assignment?.id },
        });
      }

      // Step 2: Local-only task path — only valid when offline.
      // If online, fall through to Firestore so the doc gets written.
      if (isLocalOnlyTaskId(assignment.id) && !isOnline) {
        await removeOfflineQueuedTask(user.uid, assignment.id);
        const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
        if (cached?.data) {
          await saveToCache(CACHE_KEYS.assignments(user.uid), {
            ...cached.data,
            pending: (cached.data.pending || []).filter(
              (t) => t.id !== assignment.id
            ),
          });
        }
        queueReminderRefresh("mark_done", { taskId: assignment.id });
        return;
      }

      // Step 3: Offline path
      if (!isOnline) {
        const PENDING_UPDATES_KEY = (uid) => `pending_updates_${uid}`;
        const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(user.uid));
        const queue = raw ? JSON.parse(raw) : [];
        queue.push({
          id: assignment.id,
          action: "complete",
          queuedAt: new Date().toISOString(),
        });
        await AsyncStorage.setItem(
          PENDING_UPDATES_KEY(user.uid),
          JSON.stringify(queue)
        );
        return;
      }

      // Step 4: Online path — check doc exists first
      const taskRef = doc(db, "assignments", assignment.id);
      const taskSnap = await getDoc(taskRef);
      if (!taskSnap.exists()) {
        // Doc missing from Firestore — clean up locally and exit gracefully
        const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
        if (cached?.data) {
          await saveToCache(CACHE_KEYS.assignments(user.uid), {
            ...cached.data,
            pending: (cached.data.pending || []).filter(
              (t) => t.id !== assignment.id
            ),
          });
        }
        queueReminderRefresh("mark_done_no_doc", { taskId: assignment.id });
        return;
      }

      const completionUpdate = buildTaskCompletionUpdate(new Date());
      await updateDoc(taskRef, completionUpdate);

      const completedTask = { ...assignment, ...completionUpdate };
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        await saveToCache(CACHE_KEYS.assignments(user.uid), {
          ...cached.data,
          pending: (cached.data.pending || []).filter(
            (t) => t.id !== assignment.id
          ),
          done: [completedTask, ...(cached.data.done || [])],
        });
      }

      // Step 5: Alarm cleanup — never let these abort the flow
      try {
        if (typeof clearTaskAlarmSuppression === "function") {
          await clearTaskAlarmSuppression(assignment.id);
        }
      } catch (suppressErr) {
        reportWarning(suppressErr, {
          message: "clearTaskAlarmSuppression failed — non-critical.",
          tags: { location: "home_dashboard_mark_done_suppress" },
        });
      }

      try {
        if (typeof rescheduleDeadlineAlarmsForTask === "function") {
          await rescheduleDeadlineAlarmsForTask(assignment.id);
        } else {
          queueReminderRefresh("mark_done", { taskId: assignment.id });
        }
      } catch (rescheduleErr) {
        reportWarning(rescheduleErr, {
          message: "rescheduleDeadlineAlarmsForTask failed — falling back.",
          tags: { location: "home_dashboard_mark_done_reschedule" },
        });
        queueReminderRefresh("mark_done_fallback", { taskId: assignment.id });
      }
    } catch (error) {
      // Roll back optimistic removal
      fetchDashboardData(false, { forceRefresh: true });
      reportError(error, {
        message: "Failed to mark a dashboard task as done.",
        tags: { location: "home_dashboard_mark_done" },
        extra: { taskId: assignment?.id || null },
      });
      Alert.alert(
        "Task update failed",
        "Could not mark this task as done. Please try again."
      );
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const greeting = getGreeting();
  const nowMinutes = nowTick.getHours() * 60 + nowTick.getMinutes();

  const workloadTasks = upcomingAssignments;
  const workloadSummary = useMemo(() => {
    const score = calculateDailyWorkload(workloadTasks);
    const label = getWorkloadLabel(score);
    return { score, label, color: WORKLOAD_COLOR[label] || colors.primary };
  }, [colors.primary, workloadTasks]);

  const academicLabel = useMemo(() => {
    return buildAcademicLabel({
      course,
      year,
      section,
      semester,
      academicYear,
    });
  }, [academicYear, course, section, semester, year]);

  const urgentTasks = useMemo(() => {
    return [...upcomingAssignments]
      .sort((a, b) => {
        const aDue =
          resolveTaskDueDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bDue =
          resolveTaskDueDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
        return aDue - bDue;
      })
      .slice(0, 3);
  }, [upcomingAssignments]);

  const currentClass = useMemo(() => {
    return currentClassId
      ? todayClasses.find((item) => item._localId === currentClassId) || null
      : null;
  }, [currentClassId, todayClasses]);

  const nextClass = useMemo(() => {
    return nextClassId
      ? todayClasses.find((item) => item._localId === nextClassId) || null
      : null;
  }, [nextClassId, todayClasses]);

  const lastClass = useMemo(() => {
    return todayClasses.length > 0
      ? todayClasses[todayClasses.length - 1]
      : null;
  }, [todayClasses]);

  const lastClassRange = getClassTimeRange(lastClass);

  const classesFinishedToday = Boolean(
    todayClasses.length > 0 &&
    !currentClass &&
    !nextClass &&
    lastClassRange &&
    nowMinutes >= lastClassRange.end
  );

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
        <LoadingState label="Loading your dashboard..." fullScreen />
      </View>
    );
  }

  const cardBg = colors.card;
  const textPrimary = colors.text;
  const textSecondary = isDark ? "#94a3b8" : "#64748b";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  const pendingTotalCount = Number(pendingSyncSummary?.total || 0);
  const hasAnyCachedData = Boolean(
    todayClasses.length ||
    upcomingAssignments.length ||
    announcements.length ||
    upcomingExams.length
  );
  const showOfflineNoCache = !isOnline && !hasAnyCachedData;
  const latestAnnouncement = announcements[0] || null;

  // ── focusCard (fixed currentClass branch) ─────────────────────────────────
  const focusCard = (() => {
    if (needsAcademicInfo) {
      return {
        title: "Complete your academic profile",
        body: "Add your course, year, and section so Home can load your timetable correctly.",
        icon: "school-outline",
        color: "#f59e0b",
        actionLabel: "Open Profile",
        actionRoute: "/(tabs)/profile",
      };
    }

    if (currentClass) {
      const currentRange = getClassTimeRange(currentClass);
      const nextRange = getClassTimeRange(nextClass);
      return {
        title: currentClass.subject || "Class in progress",
        body: nextClass
          ? `Next: ${nextClass.subject || "class"} at ${formatMinutesToClock(
              nextRange?.start ?? nowMinutes + 60
            )}. Use the gap to prepare what you need.`
          : `Ends at ${formatMinutesToClock(
              currentRange?.end ?? nowMinutes + 60
            )}. Stay focused!`,
        icon: "book-outline",
        color: "#10b981",
        actionLabel: "Open Schedule",
        actionRoute: "/(tabs)/schedule",
      };
    }

    const urgentExam = upcomingExams[0];
    const urgentExamDate = resolveTaskDueDate(urgentExam);
    if (urgentExam && urgentExamDate) {
      const days = daysUntil(urgentExamDate.toISOString());
      if (days <= 3) {
        return {
          title: `${urgentExam.title} is close`,
          body: `Exam in ${days} day${days === 1 ? "" : "s"}. Review your study sessions now.`,
          icon: "school-outline",
          color: "#ef4444",
          actionLabel: "Open Exam Prep",
          actionRoute: "/(tabs)/ExamPrepPlanner",
        };
      }
    }

    if (classesFinishedToday && upcomingAssignments.length > 0) {
      return {
        title: "Classes are done. Finish one more task.",
        body: `You still have ${upcomingAssignments.length} pending task${
          upcomingAssignments.length > 1 ? "s" : ""
        } today.`,
        icon: "checkmark-circle-outline",
        color: "#6366f1",
        actionLabel: "Open Tasks",
        actionRoute: "/(tabs)/assignments",
      };
    }

    if (todayClasses.length === 0 && upcomingAssignments.length > 0) {
      return {
        title: "No classes today",
        body: `Use the free time to move ${upcomingAssignments.length} pending task${
          upcomingAssignments.length > 1 ? "s" : ""
        } forward.`,
        icon: "sunny-outline",
        color: "#0ea5e9",
        actionLabel: "Open Tasks",
        actionRoute: "/(tabs)/assignments",
      };
    }

    return {
      title: "Plan your study blocks",
      body: "Turn your remaining work into a simple day plan before the day drifts.",
      icon: "grid-outline",
      color: "#8b5cf6",
      actionLabel: "Open Planner",
      actionRoute: "/(tabs)/CalendarPlannerScreen",
    };
  })();
  // ─────────────────────────────────────────────────────────────────────────

  const todayPlanItems = (() => {
    if (needsAcademicInfo) {
      return [
        {
          key: "profile",
          title: "Set up academic details",
          detail:
            "Profile needs your course, year, and section before timetable features can work.",
          icon: "person-circle-outline",
          color: "#f59e0b",
          route: "/(tabs)/profile",
        },
      ];
    }
    const items = [];
    if (currentClass) {
      const currentRange = getClassTimeRange(currentClass);
      items.push({
        key: "current",
        title: currentClass.subject || "Class in progress",
        detail: `Ends at ${formatMinutesToClock(
          currentRange?.end ?? nowMinutes + 60
        )}`,
        icon: "play-circle-outline",
        color: "#10b981",
        route: "/(tabs)/schedule",
      });
    } else if (nextClass) {
      const nextRange = getClassTimeRange(nextClass);
      items.push({
        key: "next",
        title: nextClass.subject || "Upcoming class",
        detail: `Starts at ${formatMinutesToClock(
          nextRange?.start ?? nowMinutes + 60
        )}`,
        icon: "time-outline",
        color: colors.primary,
        route: "/(tabs)/schedule",
      });
    } else if (todayClasses.length > 0) {
      items.push({
        key: "classes",
        title: `${todayClasses.length} class${
          todayClasses.length > 1 ? "es" : ""
        } scheduled today`,
        detail: lastClassRange
          ? `Last class ends at ${formatMinutesToClock(lastClassRange.end)}`
          : "Open your schedule for the full day view.",
        icon: "calendar-outline",
        color: "#0ea5e9",
        route: "/(tabs)/schedule",
      });
    } else {
      items.push({
        key: "free",
        title: "No classes on your calendar",
        detail:
          upcomingAssignments.length > 0
            ? "Use the gap to finish coursework."
            : "Use the gap to prepare the week.",
        icon: "sunny-outline",
        color: "#0ea5e9",
        route:
          upcomingAssignments.length > 0
            ? "/(tabs)/assignments"
            : "/(tabs)/CalendarPlannerScreen",
      });
    }
    const firstTask = urgentTasks[0];
    const taskDue = resolveTaskDueDate(firstTask);
    if (firstTask && taskDue) {
      items.push({
        key: "task",
        title: firstTask.title || "Closest task",
        detail: formatDeadlineCountdown(taskDue, nowTick, { style: "short" }),
        icon: "checkbox-outline",
        color: PRIORITY_COLOR[firstTask.priority] || "#22c55e",
        route: "/(tabs)/assignments",
      });
    }
    const nextExam = upcomingExams[0];
    const examDue = resolveTaskDueDate(nextExam);
    if (nextExam && examDue) {
      const examDays = daysUntil(examDue.toISOString());
      items.push({
        key: "exam",
        title: nextExam.title || "Upcoming exam",
        detail: `Exam in ${examDays} day${examDays === 1 ? "" : "s"}`,
        icon: "school-outline",
        color: urgencyColor(examDays),
        route: "/(tabs)/ExamPrepPlanner",
      });
    }
    return items.slice(0, 3);
  })();

  const quickActions = [
    {
      key: "schedule",
      label: "View Schedule",
      sub: "This week overview",
      icon: "calendar-outline",
      color: colors.primary,
      route: "/(tabs)/schedule",
    },
    {
      key: "plan",
      label: "Plan Today",
      sub: "Build focus blocks",
      icon: "time-outline",
      color: "#0ea5e9",
      route: "/(tabs)/CalendarPlannerScreen",
    },
    {
      key: "task",
      label: "Add Task",
      sub: "Assignments and exams",
      icon: "add-circle-outline",
      color: "#22c55e",
      route: "/(tabs)/TaskManagerScreen",
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: getTabBarContentBottomPadding(insets.bottom),
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <View
          style={[
            styles.hero,
            {
              backgroundColor: colors.primary,
              paddingTop: insets.top + 18,
            },
          ]}
        >
          <View style={styles.heroInner}>
            <Text style={styles.heroDate}>{getTodayString()}</Text>
            <Text style={styles.heroGreeting}>{greeting.text},</Text>
            <Text style={styles.heroName} numberOfLines={1}>
              {fullName ? fullName.split(" ")[0] : "Student"}!
            </Text>
            <Text style={styles.heroMeta} numberOfLines={2}>
              {academicLabel ||
                "Set your academic profile to unlock schedule-aware planning."}
            </Text>
            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>
                  {upcomingAssignments.length}
                </Text>
                <Text style={styles.heroStatLabel}>Pending</Text>
              </View>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>
                  {currentClass
                    ? "Now"
                    : nextClass
                      ? formatMinutesToClock(
                          getClassTimeRange(nextClass)?.start ?? nowMinutes
                        )
                      : todayClasses.length > 0
                        ? "Done"
                        : "Free"}
                </Text>
                <Text style={styles.heroStatLabel}>Next class</Text>
              </View>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>
                  {pendingTotalCount > 0
                    ? `${pendingTotalCount}`
                    : isOnline
                      ? "OK"
                      : "Off"}
                </Text>
                <Text style={styles.heroStatLabel}>Sync</Text>
              </View>
            </View>
          </View>
          <View style={styles.heroCircle} />
          <View style={styles.heroCircle2} />
        </View>

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          <DashboardSectionHeader
            title="Next Move"
            hint="The most useful thing to act on first."
            colors={colors}
          />
          <TouchableOpacity
            style={[
              styles.focusCard,
              {
                backgroundColor: cardBg,
                borderColor: `${focusCard.color}33`,
              },
            ]}
            onPress={() => router.push(focusCard.actionRoute)}
            activeOpacity={0.9}
          >
            <View style={styles.focusCardTop}>
              <View
                style={[
                  styles.focusIconWrap,
                  { backgroundColor: `${focusCard.color}18` },
                ]}
              >
                <Ionicons
                  name={focusCard.icon}
                  size={20}
                  color={focusCard.color}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.focusTitle, { color: textPrimary }]}>
                  {focusCard.title}
                </Text>
                <Text style={[styles.focusBody, { color: textSecondary }]}>
                  {focusCard.body}
                </Text>
              </View>
            </View>
            <View style={styles.focusChipRow}>
              <View
                style={[
                  styles.focusChip,
                  { backgroundColor: `${workloadSummary.color}18` },
                ]}
              >
                <Ionicons
                  name="pulse-outline"
                  size={12}
                  color={workloadSummary.color}
                />
                <Text
                  style={[
                    styles.focusChipText,
                    { color: workloadSummary.color },
                  ]}
                >
                  {workloadSummary.label} load
                </Text>
              </View>
              <View
                style={[
                  styles.focusChip,
                  {
                    backgroundColor:
                      pendingTotalCount > 0
                        ? "rgba(245,158,11,0.16)"
                        : isOnline
                          ? "rgba(34,197,94,0.16)"
                          : "rgba(245,158,11,0.16)",
                  },
                ]}
              >
                <Ionicons
                  name={
                    pendingTotalCount > 0
                      ? "cloud-upload-outline"
                      : isOnline
                        ? "cloud-done-outline"
                        : "cloud-offline-outline"
                  }
                  size={12}
                  color={
                    pendingTotalCount > 0
                      ? "#f59e0b"
                      : isOnline
                        ? "#22c55e"
                        : "#f59e0b"
                  }
                />
                <Text
                  style={[
                    styles.focusChipText,
                    {
                      color:
                        pendingTotalCount > 0
                          ? "#b45309"
                          : isOnline
                            ? "#15803d"
                            : "#b45309",
                    },
                  ]}
                >
                  {pendingTotalCount > 0
                    ? `${pendingTotalCount} waiting`
                    : isOnline
                      ? `Synced ${formatSyncTime(lastSync)}`
                      : "Offline"}
                </Text>
              </View>
            </View>
            <View
              style={[styles.focusAction, { backgroundColor: focusCard.color }]}
            >
              <Text style={styles.focusActionText}>
                {focusCard.actionLabel}
              </Text>
              <Ionicons name="arrow-forward" size={14} color="#fff" />
            </View>
          </TouchableOpacity>

          {(showingCached || !isOnline) && !showOfflineNoCache && (
            <View
              style={[
                styles.cacheBanner,
                {
                  backgroundColor: isDark ? "#0f172a" : "#eff6ff",
                  borderColor,
                },
              ]}
            >
              <Ionicons
                name="cloud-offline-outline"
                size={16}
                color={isOnline ? "#0ea5e9" : "#f59e0b"}
              />
              <Text style={[styles.cacheBannerText, { color: textSecondary }]}>
                {isOnline
                  ? "Showing cached data while syncing"
                  : "Showing cached data while offline"}
              </Text>
            </View>
          )}

          {showOfflineNoCache && (
            <EmptyStateCard
              title="No cached data yet"
              message="Connect once to download your schedule, tasks, and announcements."
              icon="cloud-offline-outline"
              tone="warn"
              actionLabel="Retry"
              onAction={checkConnectivity}
              style={{ marginHorizontal: 18, marginTop: 12 }}
            />
          )}

          <WorkloadBanner tasks={workloadTasks} colors={colors} />

          <DashboardSectionHeader
            title="Start Now"
            hint="Jump straight into planning, tasks, or class time."
            colors={colors}
          />
          <View style={styles.quickActionsRow}>
            {quickActions.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={[
                  styles.quickActionCard,
                  { backgroundColor: cardBg, borderColor },
                ]}
                onPress={() => router.push(action.route)}
                activeOpacity={0.85}
              >
                <View style={styles.quickActionTopRow}>
                  <View
                    style={[
                      styles.quickActionIcon,
                      { backgroundColor: `${action.color}1a` },
                    ]}
                  >
                    <Ionicons
                      name={action.icon}
                      size={16}
                      color={action.color}
                    />
                  </View>
                  <View
                    style={[
                      styles.quickActionArrow,
                      { backgroundColor: `${action.color}14` },
                    ]}
                  >
                    <Ionicons
                      name="arrow-forward"
                      size={13}
                      color={action.color}
                    />
                  </View>
                </View>
                <Text style={[styles.quickActionTitle, { color: textPrimary }]}>
                  {action.label}
                </Text>
                <Text style={[styles.quickActionSub, { color: textSecondary }]}>
                  {action.sub}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <DashboardSectionHeader
            title={"Today's Plan"}
            hint="Your classes, deadlines, and next study step."
            actionLabel="Open"
            onPress={() =>
              router.push(
                todayClasses.length > 0
                  ? "/(tabs)/schedule"
                  : "/(tabs)/CalendarPlannerScreen"
              )
            }
            colors={colors}
          />
          <View style={styles.planList}>
            {todayPlanItems.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.planItem,
                  { backgroundColor: cardBg, borderColor },
                ]}
                onPress={() => router.push(item.route)}
                activeOpacity={0.88}
              >
                <View
                  style={[
                    styles.planItemIcon,
                    { backgroundColor: `${item.color}18` },
                  ]}
                >
                  <Ionicons name={item.icon} size={17} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planItemTitle, { color: textPrimary }]}>
                    {item.title}
                  </Text>
                  <Text
                    style={[styles.planItemDetail, { color: textSecondary }]}
                  >
                    {item.detail}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={textSecondary}
                />
              </TouchableOpacity>
            ))}
          </View>

          <DashboardSectionHeader
            title="Urgent Tasks"
            hint="Closest deadlines first."
            actionLabel="See all"
            onPress={() => router.push("/(tabs)/assignments")}
            colors={colors}
          />
          {upcomingAssignments.length === 0 ? (
            <EmptyStateCard
              title="All tasks completed"
              message="Great work."
              icon="checkmark-done-circle-outline"
              style={{ marginHorizontal: 18 }}
            />
          ) : (
            urgentTasks.map((item) => {
              const due = resolveTaskDueDate(item);
              const isOverdue = due && due < nowTick;
              const dueStr = due
                ? formatDeadlineCountdown(due, nowTick, { style: "short" })
                : "";
              const pColor = PRIORITY_COLOR[item.priority] || colors.primary;
              return (
                <View
                  key={item.id}
                  style={[
                    styles.taskCard,
                    { backgroundColor: cardBg, borderColor },
                  ]}
                >
                  <View
                    style={[styles.taskAccent, { backgroundColor: pColor }]}
                  />
                  <View style={styles.taskBody}>
                    <View style={styles.taskTop}>
                      <Text
                        style={[styles.taskTitle, { color: textPrimary }]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: pColor + "22" },
                        ]}
                      >
                        <Text style={[styles.typeBadgeText, { color: pColor }]}>
                          {item.type?.toUpperCase() || "TASK"}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.taskSub, { color: textSecondary }]}>
                      {item.subject}
                    </Text>
                    <View style={styles.taskBottom}>
                      <View
                        style={[
                          styles.duePill,
                          {
                            backgroundColor: isOverdue
                              ? isDark
                                ? "#3d0000"
                                : "#fef2f2"
                              : isDark
                                ? "#1e293b"
                                : "#f1f5f9",
                          },
                        ]}
                      >
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color={isOverdue ? "#ef4444" : textSecondary}
                        />
                        <Text
                          style={[
                            styles.dueText,
                            {
                              color: isOverdue ? "#ef4444" : textSecondary,
                            },
                          ]}
                        >
                          {dueStr}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.doneBtn, { backgroundColor: "#22c55e" }]}
                        onPress={() => markDone(item)}
                      >
                        <Ionicons name="checkmark" size={14} color="#fff" />
                        <Text style={styles.doneBtnText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}

          {/*  EXAM PREP  */}
          {upcomingExams.length > 0 && (
            <>
              <DashboardSectionHeader
                title="Exam Prep"
                hint="Review progress on the exams that matter next."
                actionLabel="Open planner"
                actionColor="#ef4444"
                onPress={() => router.push("/(tabs)/ExamPrepPlanner")}
                colors={colors}
              />
              {upcomingExams.slice(0, 2).map((exam) => {
                const examDue = resolveTaskDueDate(exam);
                if (!examDue) return null;
                const days = daysUntil(examDue.toISOString());
                const urgColor = urgencyColor(days);
                const plan = examPlans[exam.id];
                const done = plan
                  ? plan.sessions.filter((s) => s.completed).length
                  : 0;
                const total = plan ? plan.sessions.length : 0;
                const prog = total > 0 ? done / total : 0;
                const todaySession = plan?.sessions?.find((s) => {
                  const d = new Date(s.date);
                  d.setHours(0, 0, 0, 0);
                  const t = new Date();
                  t.setHours(0, 0, 0, 0);
                  return d.getTime() === t.getTime() && !s.completed;
                });
                return (
                  <TouchableOpacity
                    key={exam.id}
                    style={[
                      styles.examCard,
                      {
                        backgroundColor: cardBg,
                        borderLeftColor: urgColor,
                        borderColor,
                      },
                    ]}
                    onPress={() => router.push("/(tabs)/ExamPrepPlanner")}
                    activeOpacity={0.85}
                  >
                    <View style={styles.examCardTop}>
                      <View
                        style={[
                          styles.examIconBox,
                          { backgroundColor: urgColor + "22" },
                        ]}
                      >
                        <Ionicons name="school" size={20} color={urgColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.examCardTitle, { color: textPrimary }]}
                          numberOfLines={1}
                        >
                          {exam.title}
                        </Text>
                        <Text
                          style={[styles.examCardSub, { color: textSecondary }]}
                        >
                          {exam.subject}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.examCountdown,
                          { backgroundColor: urgColor },
                        ]}
                      >
                        <Text style={styles.examCountdownNum}>{days}</Text>
                        <Text style={styles.examCountdownLabel}>days</Text>
                      </View>
                    </View>
                    {plan ? (
                      <>
                        <View style={styles.examProgRow}>
                          <View
                            style={[
                              styles.examProgTrack,
                              {
                                backgroundColor: isDark ? "#1e293b" : "#f1f5f9",
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.examProgFill,
                                {
                                  width: `${prog * 100}%`,
                                  backgroundColor: urgColor,
                                },
                              ]}
                            />
                          </View>
                          <Text
                            style={[
                              styles.examProgText,
                              { color: textSecondary },
                            ]}
                          >
                            {done}/{total} sessions
                          </Text>
                        </View>
                        {todaySession && (
                          <View
                            style={[
                              styles.todaySessionPill,
                              { backgroundColor: "#3b82f618" },
                            ]}
                          >
                            <Ionicons name="flash" size={12} color="#3b82f6" />
                            <Text
                              style={[
                                styles.todaySessionText,
                                {
                                  color: isDark ? "#93c5fd" : "#2563eb",
                                },
                              ]}
                            >
                              Study session scheduled for today!
                            </Text>
                          </View>
                        )}
                        {done === total && total > 0 && (
                          <View
                            style={[
                              styles.todaySessionPill,
                              { backgroundColor: "#22c55e18" },
                            ]}
                          >
                            <Ionicons
                              name="checkmark-circle"
                              size={12}
                              color="#22c55e"
                            />
                            <Text
                              style={[
                                styles.todaySessionText,
                                { color: "#16a34a" },
                              ]}
                            >
                              All sessions complete - you are ready!
                            </Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <View
                        style={[
                          styles.noPlanPill,
                          {
                            borderColor: urgColor + "60",
                            backgroundColor: urgColor + "0c",
                          },
                        ]}
                      >
                        <Ionicons
                          name="add-circle-outline"
                          size={13}
                          color={urgColor}
                        />
                        <Text style={[styles.noPlanText, { color: urgColor }]}>
                          Tap to create a study plan
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/*  ANNOUNCEMENTS  */}
          <DashboardSectionHeader
            title="Latest Announcement"
            hint="The most recent update from admin."
            actionLabel="Open all"
            onPress={() => router.push("/(tabs)/AnnouncementsScreen")}
            colors={colors}
          />
          {!latestAnnouncement ? (
            <EmptyStateCard
              title="No announcements"
              message="Check back later."
              icon="chatbubble-ellipses-outline"
              style={{ marginHorizontal: 18 }}
            />
          ) : (
            <TouchableOpacity
              style={[
                styles.announcementCard,
                {
                  backgroundColor: cardBg,
                  borderLeftColor: colors.primary,
                  borderColor,
                },
              ]}
              onPress={() => router.push("/(tabs)/AnnouncementsScreen")}
              activeOpacity={0.85}
            >
              <Text style={[styles.annTitle, { color: textPrimary }]}>
                {latestAnnouncement.title}
              </Text>
              <Text
                style={[styles.annBody, { color: textSecondary }]}
                numberOfLines={3}
              >
                {latestAnnouncement.message}
              </Text>
              <Text style={[styles.annAudience, { color: colors.primary }]}>
                {latestAnnouncement.audience === "all"
                  ? "All Students"
                  : latestAnnouncement.audience === "year"
                    ? `Year ${latestAnnouncement.year}`
                    : `${latestAnnouncement.course} - Y${latestAnnouncement.year} - Sec ${latestAnnouncement.section}`}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </ScrollView>

      <DeadlineAlarmModal
        visible={alarmVisible}
        task={alarmTask}
        thresholdKey={alarmThresholdKey}
        onNotDone={async () => {
          try {
            await notDoneAlarm();
            fetchDashboardData(false, { forceRefresh: true });
          } catch (err) {
            warnIfDev("Failed to mark as not done:", err);
          }
        }}
        onMarkDone={async () => {
          try {
            // acknowledgeAlarm first so the modal closes immediately
            // even if the Firestore write is slow
            await acknowledgeAlarm();
            if (alarmTask?.id) {
              await markDone(alarmTask);
            }
          } catch (err) {
            warnIfDev("Failed to mark as done:", err);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Hero
  hero: {
    paddingTop: 56,
    paddingBottom: 32,
    paddingHorizontal: 22,
    overflow: "hidden",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroInner: { zIndex: 2 },
  heroDate: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heroGreeting: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 16,
    fontWeight: "500",
  },
  heroName: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 8,
  },
  heroMeta: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  heroStatsRow: { flexDirection: "row", gap: 10 },
  heroStatCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroStatValue: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 3,
  },
  heroStatLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  pillText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  heroCircle: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -40,
    right: -40,
  },
  heroCircle2: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 10,
    right: 60,
  },
  // Section header
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    marginTop: 24,
    marginBottom: 10,
  },
  sectionHeaderCopy: { flex: 1, paddingRight: 12 },
  sectionLabel: { fontSize: 15, fontWeight: "800", letterSpacing: 0.1 },
  sectionHint: {
    fontSize: 11,
    marginTop: 3,
    lineHeight: 16,
  },
  sectionAction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sectionActionText: { fontSize: 12, fontWeight: "800" },
  focusCard: {
    marginHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  focusCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  focusIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  focusTitle: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
  focusBody: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  focusChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    marginBottom: 14,
  },
  focusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  focusChipText: { fontSize: 11, fontWeight: "800" },
  focusAction: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  focusActionText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  planList: { paddingHorizontal: 18, gap: 10 },
  planItem: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  planItemTitle: { fontSize: 13, fontWeight: "800", marginBottom: 2 },
  planItemDetail: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  // Quick actions
  quickActionsRow: {
    paddingHorizontal: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickActionCard: {
    flex: 1,
    minWidth: 150,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  quickActionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  quickActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionArrow: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionTitle: { fontSize: 13, fontWeight: "800" },
  quickActionSub: { fontSize: 11, marginTop: 3, lineHeight: 16 },
  usageList: { paddingHorizontal: 18, gap: 8 },
  usageItem: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  usageRankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  usageRankText: { fontSize: 12, fontWeight: "900" },
  usageAppName: { fontSize: 13, fontWeight: "700" },
  usagePkg: { fontSize: 11, marginTop: 1 },
  usageTime: { fontSize: 12, fontWeight: "800" },
  syncCenterCard: {
    marginHorizontal: 18,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cacheBanner: {
    marginHorizontal: 18,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cacheBannerText: { fontSize: 12, fontWeight: "600" },
  syncCenterTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  syncCenterIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  syncCenterTitle: { fontSize: 13, fontWeight: "800", marginBottom: 1 },
  syncCenterSub: { fontSize: 11, fontWeight: "600" },
  syncCenterTotal: {
    fontSize: 20,
    fontWeight: "900",
    minWidth: 24,
    textAlign: "right",
  },
  syncCenterStats: { flexDirection: "row", gap: 8, marginBottom: 10 },
  syncCenterStatPill: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  syncCenterStatLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  syncCenterStatValue: { fontSize: 16, fontWeight: "900" },
  syncCenterActions: { flexDirection: "row", gap: 8 },
  syncCenterActionBtn: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  syncCenterActionText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  // Class cards
  classScroll: { paddingHorizontal: 18, gap: 12 },
  classCard: {
    width: 148,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    position: "relative",
    overflow: "hidden",
  },
  classCardActive: { elevation: 6 },
  classCardCurrent: { elevation: 8 },
  nextBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(255,255,255,0.28)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  nextBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  classSubject: {
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 6,
    lineHeight: 18,
  },
  classTime: { fontSize: 12, fontWeight: "600", marginBottom: 4 },
  classTeacher: { fontSize: 11, marginTop: 2 },
  statusScroll: { paddingHorizontal: 18, gap: STATUS_CARD_GAP },
  statusCard: {
    width: STATUS_CARD_WIDTH,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 2,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
  },
  statusTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  statusIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  statusTitle: { fontSize: 13, fontWeight: "800", marginBottom: 1 },
  statusSubtitle: { fontSize: 14, fontWeight: "700" },
  statusBody: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginBottom: 10,
  },
  statusActionBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
  },
  statusActionText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  // Task cards
  taskCard: {
    marginHorizontal: 18,
    marginBottom: 10,
    borderRadius: 16,
    flexDirection: "row",
    overflow: "hidden",
    borderWidth: 1,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
  },
  taskAccent: { width: 5 },
  taskBody: { flex: 1, padding: 14 },
  taskTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  taskTitle: { fontSize: 14, fontWeight: "800", flex: 1, marginRight: 8 },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  taskSub: { fontSize: 12, fontWeight: "500", marginBottom: 10 },
  taskBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  duePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dueText: { fontSize: 11, fontWeight: "600" },
  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  doneBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  // Exam cards
  examCard: {
    marginHorizontal: 18,
    marginBottom: 10,
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 4,
    borderWidth: 1,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
  },
  examCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  examIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  examCardTitle: { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  examCardSub: { fontSize: 12, fontWeight: "500" },
  examCountdown: {
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    height: 46,
    borderRadius: 12,
  },
  examCountdownNum: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 20,
  },
  examCountdownLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  examProgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  examProgTrack: { flex: 1, height: 7, borderRadius: 4, overflow: "hidden" },
  examProgFill: { height: "100%", borderRadius: 4 },
  examProgText: {
    fontSize: 11,
    fontWeight: "600",
    minWidth: 60,
    textAlign: "right",
  },
  todaySessionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  todaySessionText: { fontSize: 12, fontWeight: "700" },
  noPlanPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
  noPlanText: { fontSize: 12, fontWeight: "700" },
  // Announcement cards
  announcementCard: {
    marginHorizontal: 18,
    marginBottom: 10,
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 4,
    borderWidth: 1,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  annTitle: { fontSize: 14, fontWeight: "800", marginBottom: 5 },
  annBody: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 19,
    marginBottom: 8,
  },
  annAudience: { fontSize: 11, fontWeight: "700" },
});
