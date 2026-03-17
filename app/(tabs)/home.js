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
  Linking,
  NativeModules,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { cancelAssignmentNotifications } from "../../utils/assignmentNotifications";
import { findBestScheduleDoc } from "../../utils/scheduleMatcher";

const PRIORITY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const PLANS_KEY = (uid) => `exam_prep_plans_${uid}`;
const STATUS_CARD_WIDTH = 300;
const STATUS_CARD_GAP = 12;
const USAGE_CARD_LIMIT = 4;
const AppUsageModule = NativeModules.AppUsageModule;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning" };
  if (h < 18) return { text: "Good afternoon" };
  return { text: "Good evening" };
}
function getTodayString() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function daysUntil(isoDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(isoDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / 86400000);
}
function urgencyColor(days) {
  if (days <= 1) return "#ef4444";
  if (days <= 3) return "#f59e0b";
  if (days <= 7) return "#0ea5e9";
  return "#10b981";
}

function parseDueDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function safeParseObject(raw, fallback = {}) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return fallback;
  }
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

function formatUsageDuration(ms) {
  const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
  if (hours > 0) return `${hours}h`;
  return `${rem}m`;
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
  const { rescheduleAll } = useNotifications();
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
  const [todayClasses, setTodayClasses] = useState([]);
  const [currentClassId, setCurrentClassId] = useState(null);
  const [nextClassId, setNextClassId] = useState(null);
  const [upcomingAssignments, setUpcomingAssignments] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [upcomingExams, setUpcomingExams] = useState([]);
  const [examPlans, setExamPlans] = useState({});
  const [topUsedApps, setTopUsedApps] = useState([]);
  const [usagePermission, setUsagePermission] = useState(false);
  const [usageLoadError, setUsageLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showingCached, setShowingCached] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const hasLoaded = useRef(false);
  const statusScrollRef = useRef(null);
  const hasAutoSnappedStatus = useRef(false);
  const usageFeatureAvailable =
    Platform.OS === "android" &&
    typeof AppUsageModule?.isUsagePermissionGranted === "function" &&
    typeof AppUsageModule?.getUsageStats === "function";
  const canOpenUsageSettings =
    typeof AppUsageModule?.openUsageAccessSettings === "function";
  const openAppSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.error("Error opening settings:", error);
      Alert.alert("Error", "Could not open settings. Please do it manually.");
    }
  };
  const openUsageAccess = async () => {
    if (canOpenUsageSettings) {
      try {
        await AppUsageModule.openUsageAccessSettings();
        return;
      } catch (error) {
        console.error("Error opening usage access settings:", error);
        Alert.alert(
          "Error",
          "Could not open usage settings. Please do it manually."
        );
      }
    }
    await openAppSettings();
  };
  const stripArchived = (items = []) =>
    items.filter((item) => !item?.plannerArchived);

  //  Auto-refresh when tab gets focused
  useFocusEffect(
    useCallback(() => {
      if (!hasLoaded.current) {
        // First load - show full loading screen
        fetchDashboardData(true);
        hasLoaded.current = true;
      } else {
        // Subsequent focus - silent background refresh
        fetchDashboardData(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  useEffect(() => {
    hasAutoSnappedStatus.current = false;
  }, [currentClassId]);

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

  const loadTopUsedApps = useCallback(async () => {
    if (!usageFeatureAvailable) {
      setUsagePermission(false);
      setTopUsedApps([]);
      setUsageLoadError("");
      return;
    }

    try {
      const granted = Boolean(await AppUsageModule.isUsagePermissionGranted());
      setUsagePermission(granted);
      if (!granted) {
        setTopUsedApps([]);
        setUsageLoadError("");
        return;
      }

      const raw = await AppUsageModule.getUsageStats(1, 10);
      const normalized = Array.isArray(raw)
        ? raw
            .map((item) => ({
              appName: String(
                item?.appName || item?.packageName || "Unknown App"
              ),
              packageName: String(item?.packageName || ""),
              totalTimeForegroundMs: Number(item?.totalTimeForegroundMs || 0),
            }))
            .filter((item) => item.totalTimeForegroundMs > 0)
            .sort((a, b) => b.totalTimeForegroundMs - a.totalTimeForegroundMs)
            .slice(0, USAGE_CARD_LIMIT)
        : [];

      setTopUsedApps(normalized);
      setUsageLoadError("");
    } catch (error) {
      console.error("Error loading app usage:", error);
      setTopUsedApps([]);
      setUsageLoadError(error?.message || "Could not load app usage.");
    }
  }, [usageFeatureAvailable]);

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
          parseDueDate(t.dueAt) !== null &&
          parseDueDate(t.dueAt) > now
      )
      .sort((a, b) => {
        const aDate = parseDueDate(a.dueAt);
        const bDate = parseDueDate(b.dueAt);
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

  const fetchDashboardData = async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      await loadFromOfflineCache(user.uid, { markCached: !isOnline });
      await loadTopUsedApps();

      if (!isOnline) {
        return;
      }

      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) return;
      const userData = userSnap.data();
      setFullName(userData.fullName || "");

      // Also set semester and academic year from studentInfo
      if (userData.studentInfo) {
        setSemester(userData.studentInfo.semester || "");
        setAcademicYear(userData.studentInfo.academicYear || "");
        setCourse(userData.studentInfo.course || "");
        setYear(userData.studentInfo.year || "");
        setSection(userData.studentInfo.section || "");
      }

      await saveToCache(CACHE_KEYS.profile(user.uid), userData);
      const {
        college,
        course: scheduleCourse,
        year: scheduleYear,
        section,
        scheduleType,
      } = userData.studentInfo || {};
      const hasScheduleProfile = Boolean(
        scheduleCourse && scheduleYear && section
      );

      //  Schedule
      if (hasScheduleProfile) {
        const scheduleMatch = await findBestScheduleDoc(db, {
          college,
          course: scheduleCourse,
          year: scheduleYear,
          section,
          scheduleType,
        });

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
      } else {
        setTodayClasses([]);
        setCurrentClassId(null);
        setNextClassId(null);
      }

      //  Assignments
      const qA = query(
        collection(db, "assignments"),
        where("userId", "==", user.uid),
        where("completed", "==", false),
        orderBy("dueAt")
      );
      const aSnap = await getDocs(qA);
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

      //  Upcoming exams
      const now = new Date();
      const exams = allTasks
        .filter((t) => t.type === "exam" && parseDueDate(t.dueAt) > now)
        .sort((a, b) => parseDueDate(a.dueAt) - parseDueDate(b.dueAt))
        .slice(0, 3);
      setUpcomingExams(exams);
      const rawPlans = await AsyncStorage.getItem(PLANS_KEY(user.uid));
      setExamPlans(safeParseObject(rawPlans, {}));

      //  Announcements
      const qAnn = query(
        collection(db, "announcements"),
        orderBy("createdAt", "desc")
      );
      const annSnap = await getDocs(qAnn);
      const filtered = annSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          if (a.audience === "all") return true;
          if (
            a.audience === "year" &&
            a.year === year &&
            (!a.college || a.college === college)
          )
            return true;
          if (
            a.audience === "course" &&
            a.course === course &&
            a.year === year &&
            a.section === section &&
            (!a.college || a.college === college)
          )
            return true;
          return false;
        });
      setAnnouncements(filtered);
      await saveToCache(CACHE_KEYS.announcements(user.uid), filtered);
      await markSynced();
      setShowingCached(false);
    } catch (error) {
      console.error("Error loading announcements:", error);
      if (auth.currentUser) {
        await loadFromOfflineCache(auth.currentUser.uid, { markCached: true });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      animateIn();
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData(false);
  };

  const markDone = async (assignment) => {
    await cancelAssignmentNotifications(assignment);
    await updateDoc(doc(db, "assignments", assignment.id), { completed: true });
    await rescheduleAll();
    fetchDashboardData(false);
  };

  const greeting = getGreeting();
  const now = useMemo(() => new Date(), []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const overdueCount = useMemo(() => {
    return upcomingAssignments.filter((a) => {
      const due = parseDueDate(a.dueAt);
      return due && due < now;
    }).length;
  }, [upcomingAssignments, now]);
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

  const statusSlides = [];
  if (currentClass) {
    const currentRange = getClassTimeRange(currentClass);
    statusSlides.push({
      key: "current",
      title: "Current Class",
      subtitle: currentClass.subject || "Class in progress",
      body: `Ends at ${formatMinutesToClock(currentRange?.end ?? nowMinutes + 60)}`,
      color: "#10b981",
      icon: "play-circle-outline",
      actionLabel: "Open Schedule",
      actionRoute: "/(tabs)/schedule",
    });
  }
  if (nextClass) {
    const nextRange = getClassTimeRange(nextClass);
    statusSlides.push({
      key: "next",
      title: "Next Class",
      subtitle: nextClass.subject || "Upcoming class",
      body: `Starts at ${formatMinutesToClock(nextRange?.start ?? nowMinutes + 60)}`,
      color: colors.primary,
      icon: "time-outline",
      actionLabel: "Open Schedule",
      actionRoute: "/(tabs)/schedule",
    });
  }
  if (classesFinishedToday) {
    const pendingTasks = upcomingAssignments.length;
    statusSlides.push({
      key: "finished",
      title: "Classes Finished",
      subtitle: pendingTasks > 0 ? "Review pending tasks" : "No pending tasks",
      body:
        pendingTasks > 0
          ? `You still have ${pendingTasks} task${pendingTasks > 1 ? "s" : ""} to review.`
          : "No pending tasks right now.",
      color: "#6366f1",
      icon: "checkmark-circle-outline",
      actionLabel: pendingTasks > 0 ? "Open Tasks" : "Open Planner",
      actionRoute: pendingTasks > 0 ? "/(tabs)/assignments" : "/(tabs)/planner",
    });
  }
  if (todayClasses.length === 0) {
    statusSlides.push({
      key: "no-classes",
      title: "No Classes Today",
      subtitle: "Free schedule day",
      body:
        upcomingAssignments.length > 0
          ? `Use this time to finish ${upcomingAssignments.length} pending task${upcomingAssignments.length > 1 ? "s" : ""}.`
          : "You can use Planner to prepare tomorrow.",
      color: "#0ea5e9",
      icon: "sunny-outline",
      actionLabel:
        upcomingAssignments.length > 0 ? "Open Tasks" : "Open Planner",
      actionRoute:
        upcomingAssignments.length > 0
          ? "/(tabs)/assignments"
          : "/(tabs)/planner",
    });
  }
  if (statusSlides.length === 0) {
    statusSlides.push({
      key: "day-plan",
      title: "Plan Your Day",
      subtitle: "Build your focus blocks",
      body: "Set priorities and lock in your study sessions.",
      color: "#8b5cf6",
      icon: "grid-outline",
      actionLabel: "Open Planner",
      actionRoute: "/(tabs)/planner",
    });
  }
  const currentStatusIndex = statusSlides.findIndex(
    (slide) => slide.key === "current"
  );

  useEffect(() => {
    if (loading) return;
    if (currentStatusIndex < 0) return;
    if (hasAutoSnappedStatus.current) return;
    if (!statusScrollRef.current) return;

    const offsetX = currentStatusIndex * (STATUS_CARD_WIDTH + STATUS_CARD_GAP);
    const timeoutId = setTimeout(() => {
      statusScrollRef.current?.scrollTo({ x: offsetX, animated: true });
      hasAutoSnappedStatus.current = true;
    }, 120);

    return () => clearTimeout(timeoutId);
  }, [loading, currentStatusIndex, statusSlides.length]);

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
        <LoadingState label="Loading your dashboard..." fullScreen />
      </View>
    );
  }

  //  Derived card/text colors
  // Ensure all card text is always readable regardless of theme
  const cardBg = colors.card;
  const textPrimary = colors.text;
  const textSecondary = isDark ? "#94a3b8" : "#64748b";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const pendingCreateCount = Number(pendingSyncSummary?.create || 0);
  const pendingCompleteCount = Number(pendingSyncSummary?.complete || 0);
  const pendingTotalCount = Number(pendingSyncSummary?.total || 0);
  const hasAnyCachedData = Boolean(
    todayClasses.length ||
    upcomingAssignments.length ||
    announcements.length ||
    upcomingExams.length
  );
  const showOfflineNoCache = !isOnline && !hasAnyCachedData;
  const quickActions = [
    {
      key: "plan",
      label: "Plan Today",
      sub: "Build focus blocks",
      icon: "time-outline",
      color: "#0ea5e9",
      route: "/(tabs)/planner",
    },
    {
      key: "task",
      label: "Add Task",
      sub: "Assignments and exams",
      icon: "add-circle-outline",
      color: "#22c55e",
      route: "/(tabs)/createAssignment",
    },
    {
      key: "schedule",
      label: "View Schedule",
      sub: "This week overview",
      icon: "calendar-outline",
      color: colors.primary,
      route: "/(tabs)/schedule",
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
      <ScrollView
        contentContainerStyle={styles.container}
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
        {/*  HERO  */}
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.primary, paddingTop: insets.top + 18 },
          ]}
        >
          <View style={styles.heroInner}>
            <Text style={styles.heroDate}>{getTodayString()}</Text>
            <Text style={styles.heroGreeting}>{greeting.text},</Text>
            <Text style={styles.heroName} numberOfLines={1}>
              {fullName ? fullName.split(" ")[0] : "Student"}!
            </Text>
            <View style={styles.pillRow}>
              {semester && (
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: "rgba(255,255,255,0.22)" },
                  ]}
                >
                  <Ionicons name="calendar-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>{semester}</Text>
                </View>
              )}
              {academicYear && (
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: "rgba(255,255,255,0.22)" },
                  ]}
                >
                  <Ionicons name="school-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>{academicYear}</Text>
                </View>
              )}
              {course && (
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: "rgba(255,255,255,0.22)" },
                  ]}
                >
                  <Ionicons name="book-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>{course}</Text>
                </View>
              )}
              {year && section && (
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: "rgba(255,255,255,0.22)" },
                  ]}
                >
                  <Ionicons name="people-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>
                    Y{year} - Sec {section}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.pill,
                  { backgroundColor: "rgba(255,255,255,0.22)" },
                ]}
              >
                <Ionicons name="book-outline" size={13} color="#fff" />
                <Text style={styles.pillText}>
                  {upcomingAssignments.length} tasks
                </Text>
              </View>
              {overdueCount > 0 && (
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: "rgba(239,68,68,0.4)" },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={13}
                    color="#fff"
                  />
                  <Text style={styles.pillText}>{overdueCount} overdue</Text>
                </View>
              )}
              {upcomingExams.length > 0 && (
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: "rgba(239,68,68,0.35)" },
                  ]}
                >
                  <Ionicons name="school-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>
                    {upcomingExams.length} exam
                    {upcomingExams.length > 1 ? "s" : ""}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.pill,
                  { backgroundColor: "rgba(255,255,255,0.22)" },
                ]}
              >
                <Ionicons name="megaphone-outline" size={13} color="#fff" />
                <Text style={styles.pillText}>{announcements.length} news</Text>
              </View>
            </View>
          </View>
          <View style={styles.heroCircle} />
          <View style={styles.heroCircle2} />
        </View>

        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Quick Actions
            </Text>
          </View>
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
                <View
                  style={[
                    styles.quickActionIcon,
                    { backgroundColor: `${action.color}1a` },
                  ]}
                >
                  <Ionicons name={action.icon} size={16} color={action.color} />
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

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Offline Sync Center
            </Text>
          </View>
          <View
            style={[
              styles.syncCenterCard,
              { backgroundColor: cardBg, borderColor },
            ]}
          >
            <View style={styles.syncCenterTop}>
              <View
                style={[
                  styles.syncCenterIcon,
                  { backgroundColor: `${isOnline ? "#22c55e" : "#f59e0b"}22` },
                ]}
              >
                <Ionicons
                  name={
                    isOnline ? "cloud-done-outline" : "cloud-offline-outline"
                  }
                  size={16}
                  color={isOnline ? "#22c55e" : "#f59e0b"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.syncCenterTitle, { color: textPrimary }]}>
                  {isOnline
                    ? "Online and ready to sync"
                    : "Offline mode active"}
                </Text>
                <Text style={[styles.syncCenterSub, { color: textSecondary }]}>
                  Last sync {formatSyncTime(lastSync)}
                </Text>
              </View>
              <Text style={[styles.syncCenterTotal, { color: textPrimary }]}>
                {pendingTotalCount}
              </Text>
            </View>

            <View style={styles.syncCenterStats}>
              <View
                style={[
                  styles.syncCenterStatPill,
                  { backgroundColor: isDark ? "#0f172a" : "#eff6ff" },
                ]}
              >
                <Text
                  style={[styles.syncCenterStatLabel, { color: textSecondary }]}
                >
                  New Tasks
                </Text>
                <Text
                  style={[styles.syncCenterStatValue, { color: textPrimary }]}
                >
                  {pendingCreateCount}
                </Text>
              </View>
              <View
                style={[
                  styles.syncCenterStatPill,
                  { backgroundColor: isDark ? "#0f172a" : "#f8fafc" },
                ]}
              >
                <Text
                  style={[styles.syncCenterStatLabel, { color: textSecondary }]}
                >
                  Completions
                </Text>
                <Text
                  style={[styles.syncCenterStatValue, { color: textPrimary }]}
                >
                  {pendingCompleteCount}
                </Text>
              </View>
            </View>

            <View style={styles.syncCenterActions}>
              <TouchableOpacity
                style={[
                  styles.syncCenterActionBtn,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => router.push("/(tabs)/createAssignment")}
              >
                <Ionicons name="add-outline" size={13} color="#fff" />
                <Text style={styles.syncCenterActionText}>New Task</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.syncCenterActionBtn,
                  { backgroundColor: "#0ea5e9" },
                ]}
                onPress={() => router.push("/(tabs)/assignments")}
              >
                <Ionicons name="checkbox-outline" size={13} color="#fff" />
                <Text style={styles.syncCenterActionText}>Open Tasks</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.syncCenterActionBtn,
                  { backgroundColor: isOnline ? "#22c55e" : "#f59e0b" },
                ]}
                onPress={checkConnectivity}
              >
                <Ionicons name="sync-outline" size={13} color="#fff" />
                <Text style={styles.syncCenterActionText}>
                  {isOnline ? "Refresh" : "Retry"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

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

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Class Status
            </Text>
          </View>
          <ScrollView
            ref={statusScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statusScroll}
          >
            {statusSlides.map((slide) => (
              <View
                key={slide.key}
                style={[
                  styles.statusCard,
                  {
                    backgroundColor: cardBg,
                    borderColor,
                  },
                ]}
              >
                <View style={styles.statusTopRow}>
                  <View
                    style={[
                      styles.statusIconWrap,
                      { backgroundColor: `${slide.color}22` },
                    ]}
                  >
                    <Ionicons name={slide.icon} size={16} color={slide.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusTitle, { color: textPrimary }]}>
                      {slide.title}
                    </Text>
                    <Text
                      style={[styles.statusSubtitle, { color: textPrimary }]}
                      numberOfLines={1}
                    >
                      {slide.subtitle}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.statusBody, { color: textSecondary }]}>
                  {slide.body}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.statusActionBtn,
                    { backgroundColor: slide.color },
                  ]}
                  onPress={() => router.push(slide.actionRoute)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.statusActionText}>
                    {slide.actionLabel}
                  </Text>
                  <Ionicons name="arrow-forward" size={13} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          {/*  Today&apos;s Classes  */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Today&apos;s Classes
            </Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/schedule")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>
                Full schedule
              </Text>
            </TouchableOpacity>
          </View>

          {todayClasses.length === 0 ? (
            <EmptyStateCard
              title="No classes today"
              message="Enjoy your free time."
              icon="calendar-outline"
              style={{ marginHorizontal: 18 }}
            />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.classScroll}
            >
              {todayClasses.map((cls, i) => {
                const isCurrent = currentClassId === cls._localId;
                const isNext = !isCurrent && nextClassId === cls._localId;
                const isHighlighted = isCurrent || isNext;
                const cardAccentColor = isCurrent ? "#10b981" : colors.primary;
                return (
                  <View
                    key={cls._localId || i}
                    style={[
                      styles.classCard,
                      {
                        backgroundColor: isHighlighted
                          ? cardAccentColor
                          : cardBg,
                        borderColor: isHighlighted
                          ? "transparent"
                          : borderColor,
                      },
                      isNext && styles.classCardActive,
                      isCurrent && styles.classCardCurrent,
                    ]}
                  >
                    {isHighlighted && (
                      <View style={styles.nextBadge}>
                        <Text style={styles.nextBadgeText}>
                          {isCurrent ? "ONGOING" : "NEXT"}
                        </Text>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.classSubject,
                        { color: isHighlighted ? "#fff" : textPrimary },
                      ]}
                      numberOfLines={2}
                    >
                      {cls.subject}
                    </Text>
                    <Text
                      style={[
                        styles.classTime,
                        {
                          color: isHighlighted
                            ? "rgba(255,255,255,0.85)"
                            : textSecondary,
                        },
                      ]}
                    >
                      {cls.timeDisplay || ""}
                    </Text>
                    {cls.teacher && (
                      <Text
                        style={[
                          styles.classTeacher,
                          {
                            color: isHighlighted
                              ? "rgba(255,255,255,0.75)"
                              : textSecondary,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        Teacher: {cls.teacher}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Device App Usage Today
            </Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/appUsage")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>
                View usage
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.sectionHint, { color: textSecondary }]}>
            Other apps on your device. Your in-app focus time is in
            Notifications.
          </Text>

          {!usageFeatureAvailable ? (
            <EmptyStateCard
              title="App usage unavailable"
              message="Usage access is not available on this device or build."
              icon="phone-portrait-outline"
              tone="warn"
              actionLabel="Open App Settings"
              onAction={openAppSettings}
              style={{ marginHorizontal: 18 }}
            />
          ) : !usagePermission ? (
            <EmptyStateCard
              title="Usage Access Required"
              message="Allow Usage Access to show other apps on Home."
              icon="lock-open-outline"
              actionLabel={
                canOpenUsageSettings ? "Open Usage Access" : "Open Settings"
              }
              onAction={openUsageAccess}
              style={{ marginHorizontal: 18 }}
            />
          ) : topUsedApps.length === 0 ? (
            <EmptyStateCard
              title="No app usage data yet"
              message={usageLoadError || "Use a few apps, then refresh Home."}
              icon="stats-chart-outline"
              style={{ marginHorizontal: 18 }}
            />
          ) : (
            <View style={styles.usageList}>
              {topUsedApps.slice(0, USAGE_CARD_LIMIT).map((item, index) => (
                <View
                  key={`${item.packageName}_${index}`}
                  style={[
                    styles.usageItem,
                    { backgroundColor: cardBg, borderColor },
                  ]}
                >
                  <View
                    style={[
                      styles.usageRankBadge,
                      { backgroundColor: `${colors.primary}20` },
                    ]}
                  >
                    <Text
                      style={[styles.usageRankText, { color: colors.primary }]}
                    >
                      {index + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.usageAppName, { color: textPrimary }]}
                      numberOfLines={1}
                    >
                      {item.appName}
                    </Text>
                    <Text
                      style={[styles.usagePkg, { color: textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.packageName}
                    </Text>
                  </View>
                  <Text style={[styles.usageTime, { color: textPrimary }]}>
                    {formatUsageDuration(item.totalTimeForegroundMs)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/*  UPCOMING TASKS  */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Upcoming Tasks
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/assignments")}
            >
              <Text style={[styles.seeAll, { color: colors.primary }]}>
                See all
              </Text>
            </TouchableOpacity>
          </View>

          {upcomingAssignments.length === 0 ? (
            <EmptyStateCard
              title="All tasks completed"
              message="Great work."
              icon="checkmark-done-circle-outline"
              style={{ marginHorizontal: 18 }}
            />
          ) : (
            upcomingAssignments.slice(0, 4).map((item) => {
              const due = parseDueDate(item.dueAt);
              const isOverdue = due && due < now;
              const dueStr = due
                ? due.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
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
                            { color: isOverdue ? "#ef4444" : textSecondary },
                          ]}
                        >
                          {isOverdue ? "Overdue - " : ""}
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
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: textPrimary }]}>
                  Exam Prep
                </Text>
                <TouchableOpacity
                  onPress={() => router.push("/(tabs)/ExamPrepPlanner")}
                >
                  <Text style={[styles.seeAll, { color: "#ef4444" }]}>
                    Open planner
                  </Text>
                </TouchableOpacity>
              </View>
              {upcomingExams.map((exam) => {
                const examDue = parseDueDate(exam.dueAt);
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
                                { color: isDark ? "#93c5fd" : "#2563eb" },
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
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textPrimary }]}>
              Announcements
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/AnnouncementsScreen")}
            >
              <Text style={[styles.seeAll, { color: colors.primary }]}>
                See all
              </Text>
            </TouchableOpacity>
          </View>

          {announcements.length === 0 ? (
            <EmptyStateCard
              title="No announcements"
              message="Check back later."
              icon="chatbubble-ellipses-outline"
              style={{ marginHorizontal: 18 }}
            />
          ) : (
            announcements.slice(0, 3).map((item) => (
              <View
                key={item.id}
                style={[
                  styles.announcementCard,
                  {
                    backgroundColor: cardBg,
                    borderLeftColor: colors.primary,
                    borderColor,
                  },
                ]}
              >
                <Text style={[styles.annTitle, { color: textPrimary }]}>
                  {item.title}
                </Text>
                <Text
                  style={[styles.annBody, { color: textSecondary }]}
                  numberOfLines={2}
                >
                  {item.message}
                </Text>
                <Text style={[styles.annAudience, { color: colors.primary }]}>
                  {item.audience === "all"
                    ? "All Students"
                    : item.audience === "year"
                      ? `Year ${item.year}`
                      : `${item.course} - Y${item.year} - Sec ${item.section}`}
                </Text>
              </View>
            ))
          )}

          <View style={{ height: 24 }} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingBottom: 32 },

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
    marginBottom: 14,
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
  sectionLabel: { fontSize: 15, fontWeight: "800", letterSpacing: 0.1 },
  sectionHint: {
    fontSize: 11,
    marginTop: -6,
    marginBottom: 10,
    paddingHorizontal: 18,
  },
  seeAll: { fontSize: 13, fontWeight: "700" },

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
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  quickActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  quickActionTitle: { fontSize: 13, fontWeight: "800" },
  quickActionSub: { fontSize: 11, marginTop: 2 },

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
  annBody: { fontSize: 13, fontWeight: "500", lineHeight: 19, marginBottom: 8 },
  annAudience: { fontSize: 11, fontWeight: "700" },
});
  