import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../config/firebase";
import EmptyStateCard from "../../components/EmptyStateCard";
import { useNotifications } from "../../context/NotificationContext";
import { useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { findBestScheduleDoc } from "../../utils/scheduleMatcher";
import {
  getPlannerKeys,
  getPlannerQueueCount,
  loadDayPlan,
  loadMonthPlan,
  loadWeekPlan,
  flushPlannerQueue,
  saveDayPlan,
  saveMonthPlan,
  saveWeekPlan,
} from "../../utils/plannerStorage";
import {
  computePlannerAnalytics,
  fetchPlannerAssignments,
  syncDayPlannerTasks,
  syncMonthPlannerTasks,
} from "../../utils/plannerTaskSync";

const VIEW_MODES = ["day", "week", "month"];
const ANALYTICS_CARD_WIDTH = 190;
const ANALYTICS_CARD_GAP = 8;
const MIN_FOCUS_TASKS = 3;
const MAX_FOCUS_TASKS = 12;
const AUTO_PLAN_MAX_TASKS = 6;
const AUTO_PLAN_MAX_BLOCKS = 8;

function makeTimeBlock(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    start: typeof seed.start === "string" ? seed.start : "",
    end: typeof seed.end === "string" ? seed.end : "",
    subject: typeof seed.subject === "string" ? seed.subject : "",
    task: typeof seed.task === "string" ? seed.task : "",
  };
}

function formatReadableDate(dateInput) {
  return dateInput.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonthLabel(dateInput) {
  return dateInput.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatWeekRange(dateInput) {
  const date = new Date(dateInput);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function getDayName(dateInput) {
  return dateInput.toLocaleDateString("en-US", { weekday: "long" });
}

function parseTimeToMinutes(value) {
  if (!value) return null;

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.getHours() * 60 + asDate.getMinutes();
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

function toClockInput(totalMinutes) {
  if (typeof totalMinutes !== "number" || Number.isNaN(totalMinutes)) return "";
  const safeMinutes = Math.max(0, Math.min(totalMinutes, (23 * 60) + 59));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function startOfDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfWeek(dateInput = new Date()) {
  const date = startOfDay(dateInput);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function endOfWeek(dateInput = new Date()) {
  const date = startOfWeek(dateInput);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date;
}

function getClassRangeMeta(cls) {
  let start = parseTimeToMinutes(cls?.start);
  let end = parseTimeToMinutes(cls?.end);

  const timeDisplay = String(cls?.timeDisplay || "").trim();
  if (timeDisplay.includes("-")) {
    const [left, right] = timeDisplay.split("-").map((part) => part.trim());
    if (start === null) start = parseTimeToMinutes(left);
    if (end === null) end = parseTimeToMinutes(right);
  }

  if (start === null) return null;
  if (end === null || end <= start) end = start + 60;

  return { start, end };
}

function countWeekClasses(weekSchedule = {}) {
  return Object.values(weekSchedule).reduce((sum, dayClasses) => {
    if (!Array.isArray(dayClasses)) return sum;
    return sum + dayClasses.length;
  }, 0);
}

function countMonthClasses(weekSchedule = {}, dateInput = new Date()) {
  const current = new Date(dateInput.getFullYear(), dateInput.getMonth(), 1);
  const month = current.getMonth();
  let total = 0;

  while (current.getMonth() === month) {
    const dayName = getDayName(current);
    const classes = Array.isArray(weekSchedule[dayName]) ? weekSchedule[dayName] : [];
    total += classes.length;
    current.setDate(current.getDate() + 1);
  }
  return total;
}

function makeSaveMessage(mode) {
  const prettyMode = mode.charAt(0).toUpperCase() + mode.slice(1);
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${prettyMode} plan saved at ${time}`;
}

function formatSyncSummary(summary) {
  if (!summary) return "";
  const parts = [];
  if (summary.created) parts.push(`${summary.created} created`);
  if (summary.updated) parts.push(`${summary.updated} updated`);
  if (summary.archived) parts.push(`${summary.archived} archived`);
  return parts.length > 0 ? `Task sync: ${parts.join(", ")}` : "Task sync: no changes";
}

export default function PlannerScreen() {
  const { colors, isDark } = useTheme();
  const { rescheduleAll } = useNotifications();
  const { isOnline } = useOffline();

  const [selectedMode, setSelectedMode] = useState("day");
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [dayPlan, setDayPlan] = useState({ priorities: ["", "", ""], timeBlocks: [], notes: "" });
  const [weekPlan, setWeekPlan] = useState({ goals: ["", "", ""], notes: "" });
  const [monthPlan, setMonthPlan] = useState({ goals: ["", "", ""], milestones: [], notes: "" });
  const [plannerAssignments, setPlannerAssignments] = useState([]);
  const [weekSchedule, setWeekSchedule] = useState({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingMode, setSavingMode] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [plannerQueueCount, setPlannerQueueCount] = useState(0);
  const analyticsScrollRef = useRef(null);
  const hasAutoSnappedAnalytics = useRef(false);

  const keys = useMemo(() => getPlannerKeys(selectedDate), [selectedDate]);
  const analytics = useMemo(
    () => computePlannerAnalytics(plannerAssignments, selectedDate),
    [plannerAssignments, selectedDate]
  );

  const currentKeyLabel =
    selectedMode === "day" ? keys.dayKey : selectedMode === "week" ? keys.weekKey : keys.monthKey;

  const heroMeta =
    selectedMode === "day"
      ? formatReadableDate(selectedDate)
      : selectedMode === "week"
        ? formatWeekRange(selectedDate)
        : formatMonthLabel(selectedDate);

  const selectedDayName = useMemo(() => getDayName(selectedDate), [selectedDate]);
  const selectedDayClasses = useMemo(() => {
    const list = Array.isArray(weekSchedule[selectedDayName]) ? [...weekSchedule[selectedDayName]] : [];
    return list.sort((a, b) => {
      const aStart = getClassRangeMeta(a)?.start ?? Number.POSITIVE_INFINITY;
      const bStart = getClassRangeMeta(b)?.start ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    });
  }, [weekSchedule, selectedDayName]);

  const todayClassesFinished = useMemo(() => {
    const today = new Date();
    const isSelectedToday = selectedDate.toDateString() === today.toDateString();
    if (!isSelectedToday || selectedDayClasses.length === 0) return false;
    const nowMinutes = today.getHours() * 60 + today.getMinutes();
    const last = selectedDayClasses[selectedDayClasses.length - 1];
    const lastRange = getClassRangeMeta(last);
    return Boolean(lastRange && nowMinutes >= lastRange.end);
  }, [selectedDate, selectedDayClasses]);

  const dayTimeSummary = useMemo(() => {
    const blocks = Array.isArray(dayPlan?.timeBlocks) ? dayPlan.timeBlocks : [];
    let plannedMinutes = 0;
    let validBlocks = 0;
    let subjectLinkedBlocks = 0;

    blocks.forEach((block) => {
      const start = parseTimeToMinutes(block?.start);
      const end = parseTimeToMinutes(block?.end);
      if (start === null || end === null || end <= start) return;

      validBlocks += 1;
      plannedMinutes += end - start;
      if (typeof block?.subject === "string" && block.subject.trim()) {
        subjectLinkedBlocks += 1;
      }
    });

    return {
      plannedMinutes,
      validBlocks,
      subjectLinkedBlocks,
      customBlocks: Math.max(validBlocks - subjectLinkedBlocks, 0),
    };
  }, [dayPlan?.timeBlocks]);

  const weekClassCount = useMemo(() => countWeekClasses(weekSchedule), [weekSchedule]);
  const monthClassCount = useMemo(() => countMonthClasses(weekSchedule, selectedDate), [weekSchedule, selectedDate]);
  const activeClassDays = useMemo(() => {
    return Object.values(weekSchedule).filter((classes) => Array.isArray(classes) && classes.length > 0).length;
  }, [weekSchedule]);

  const refreshPlannerQueue = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    if (isOnline) {
      await flushPlannerQueue(user.uid);
    }
    const count = await getPlannerQueueCount(user.uid);
    setPlannerQueueCount(count);
  }, [isOnline]);

  const loadPlannerData = useCallback(async (dateInput = new Date(), fromRefresh = false) => {
    const effectiveDate = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      setRefreshing(false);
      setErrorMessage("Sign in to use planner sync.");
      return;
    }

    if (fromRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setErrorMessage("");
    await refreshPlannerQueue();

    try {
      const loadSchedule = async () => {
        if (!isOnline) return {};
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) return {};
        const studentInfo = userSnap.data().studentInfo || {};
        const { college, course, year, section, scheduleType } = studentInfo;
        if (!course || !year || !section) return {};
        const scheduleMatch = await findBestScheduleDoc(db, {
          college,
          course,
          year,
          section,
          scheduleType,
        });
        return scheduleMatch?.doc?.data()?.weekSchedule || {};
      };

      const [dayData, weekData, monthData, plannerTaskData, scheduleData] = await Promise.all([
        loadDayPlan(user.uid, effectiveDate, { isOnline }),
        loadWeekPlan(user.uid, effectiveDate, { isOnline }),
        loadMonthPlan(user.uid, effectiveDate, { isOnline }),
        isOnline ? fetchPlannerAssignments(user.uid) : Promise.resolve([]),
        loadSchedule(),
      ]);

      setDayPlan(dayData);
      setWeekPlan(weekData);
      setMonthPlan(monthData);
      setPlannerAssignments(plannerTaskData);
      setWeekSchedule(scheduleData || {});
      setSaveMessage("");
    } catch (error) {
      console.warn("Planner load error:", error);
      setErrorMessage("Could not load planner data. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline, refreshPlannerQueue]);

  useFocusEffect(
    useCallback(() => {
      const today = new Date();
      setSelectedDate(today);
      loadPlannerData(today, false);
    }, [loadPlannerData])
  );

  useEffect(() => {
    hasAutoSnappedAnalytics.current = false;
  }, [selectedMode]);

  const onRefresh = () => {
    loadPlannerData(selectedDate, true);
  };

  const shiftDate = (delta) => {
    const next = new Date(selectedDate);
    if (selectedMode === "week") {
      next.setDate(next.getDate() + (delta * 7));
    } else if (selectedMode === "month") {
      next.setMonth(next.getMonth() + delta);
    } else {
      next.setDate(next.getDate() + delta);
    }
    setSelectedDate(next);
    loadPlannerData(next, false);
    setSaveMessage("");
  };

  const jumpToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    loadPlannerData(today, false);
    setSaveMessage("");
  };

  const updatePriority = (index, value) => {
    setDayPlan((previous) => {
      const nextPriorities = [...previous.priorities];
      nextPriorities[index] = value;
      return {
        ...previous,
        priorities: nextPriorities,
      };
    });
  };

  const updateWeekGoal = (index, value) => {
    setWeekPlan((previous) => {
      const nextGoals = [...previous.goals];
      nextGoals[index] = value;
      return {
        ...previous,
        goals: nextGoals,
      };
    });
  };

  const updateMonthGoal = (index, value) => {
    setMonthPlan((previous) => {
      const nextGoals = [...previous.goals];
      nextGoals[index] = value;
      return {
        ...previous,
        goals: nextGoals,
      };
    });
  };

  const addDayPriority = () => {
    setDayPlan((previous) => {
      const current = Array.isArray(previous.priorities) ? previous.priorities : [];
      if (current.length >= MAX_FOCUS_TASKS) return previous;
      return {
        ...previous,
        priorities: [...current, ""],
      };
    });
    setSaveMessage("");
  };

  const removeDayPriority = (index) => {
    setDayPlan((previous) => {
      const current = Array.isArray(previous.priorities) ? [...previous.priorities] : [];
      if (current.length <= MIN_FOCUS_TASKS) {
        if (index >= 0 && index < current.length) {
          current[index] = "";
        }
        return {
          ...previous,
          priorities: current,
        };
      }
      return {
        ...previous,
        priorities: current.filter((_, idx) => idx !== index),
      };
    });
    setSaveMessage("");
  };

  const addWeekGoal = () => {
    setWeekPlan((previous) => {
      const current = Array.isArray(previous.goals) ? previous.goals : [];
      if (current.length >= MAX_FOCUS_TASKS) return previous;
      return {
        ...previous,
        goals: [...current, ""],
      };
    });
    setSaveMessage("");
  };

  const removeWeekGoal = (index) => {
    setWeekPlan((previous) => {
      const current = Array.isArray(previous.goals) ? [...previous.goals] : [];
      if (current.length <= MIN_FOCUS_TASKS) {
        if (index >= 0 && index < current.length) {
          current[index] = "";
        }
        return {
          ...previous,
          goals: current,
        };
      }
      return {
        ...previous,
        goals: current.filter((_, idx) => idx !== index),
      };
    });
    setSaveMessage("");
  };

  const addMonthGoal = () => {
    setMonthPlan((previous) => {
      const current = Array.isArray(previous.goals) ? previous.goals : [];
      if (current.length >= MAX_FOCUS_TASKS) return previous;
      return {
        ...previous,
        goals: [...current, ""],
      };
    });
    setSaveMessage("");
  };

  const removeMonthGoal = (index) => {
    setMonthPlan((previous) => {
      const current = Array.isArray(previous.goals) ? [...previous.goals] : [];
      if (current.length <= MIN_FOCUS_TASKS) {
        if (index >= 0 && index < current.length) {
          current[index] = "";
        }
        return {
          ...previous,
          goals: current,
        };
      }
      return {
        ...previous,
        goals: current.filter((_, idx) => idx !== index),
      };
    });
    setSaveMessage("");
  };

  const getAssignmentsInRange = (fromDate, toDate) => {
    const start = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const end = toDate instanceof Date ? toDate : new Date(toDate);
    return plannerAssignments
      .filter((item) => {
        if (!item?.dueDate) return false;
        const due = item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate);
        if (Number.isNaN(due.getTime())) return false;
        return due >= start && due <= end;
      })
      .sort((a, b) => {
        const aDue = a.dueDate instanceof Date ? a.dueDate.getTime() : new Date(a.dueDate).getTime();
        const bDue = b.dueDate instanceof Date ? b.dueDate.getTime() : new Date(b.dueDate).getTime();
        return aDue - bDue;
      });
  };

  const runAutoPlanDay = () => {
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);
    const dueToday = getAssignmentsInRange(dayStart, dayEnd).slice(0, AUTO_PLAN_MAX_TASKS);
    const classDrivenTasks = selectedDayClasses
      .map((cls) => String(cls?.subject || "").trim())
      .filter(Boolean)
      .map((subject) => `Review ${subject}`);

    const candidatePriorities = [
      ...dueToday.map((task) => task?.title).filter(Boolean),
      ...classDrivenTasks,
    ];
    const dedupedPriorities = Array.from(new Set(candidatePriorities.map((item) => String(item).trim()).filter(Boolean)));
    if (dedupedPriorities.length === 0 && selectedDayClasses.length === 0) {
      Alert.alert("Nothing to Auto-Plan", "No classes or due tasks were found for this day.");
      return;
    }

    const classBlocks = selectedDayClasses
      .map((cls) => {
        const range = getClassRangeMeta(cls);
        if (!range) return null;
        return makeTimeBlock({
          start: toClockInput(range.start),
          end: toClockInput(range.end),
          subject: typeof cls?.subject === "string" ? cls.subject : "",
          task: cls?.subject ? `Class: ${cls.subject}` : "Class session",
        });
      })
      .filter(Boolean);

    const focusBlocks = dueToday.map((task, idx) => {
      const fallbackStart = Math.min((18 * 60) + (idx * 60), 22 * 60);
      return makeTimeBlock({
        start: toClockInput(fallbackStart),
        end: toClockInput(Math.min(fallbackStart + 60, (23 * 60) + 59)),
        subject: task?.subject || "",
        task: `Work on: ${task?.title || "Task"}`,
      });
    });

    const generatedBlocks = [...classBlocks, ...focusBlocks].slice(0, AUTO_PLAN_MAX_BLOCKS);
    const generatedPriorities = dedupedPriorities.slice(0, MAX_FOCUS_TASKS);
    while (generatedPriorities.length < MIN_FOCUS_TASKS) generatedPriorities.push("");

    Alert.alert(
      "Auto-Plan Day",
      "Generate a suggested day plan from your classes and due tasks?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: () => {
            setDayPlan((previous) => ({
              ...previous,
              priorities: generatedPriorities,
              timeBlocks: generatedBlocks,
            }));
            setSaveMessage("Auto-plan applied for day. Review then tap Save Day Plan.");
          },
        },
      ]
    );
  };

  const runAutoPlanWeek = () => {
    const weekStart = startOfWeek(selectedDate);
    const weekEnd = endOfWeek(selectedDate);
    const dueThisWeek = getAssignmentsInRange(weekStart, weekEnd).slice(0, AUTO_PLAN_MAX_TASKS);

    const generatedGoals = dueThisWeek.length
      ? dueThisWeek.map((task) => task?.title).filter(Boolean)
      : [
          "Complete class prep before each session",
          "Review weak topics from this week",
          "Submit pending tasks before Friday",
        ];

    const deduped = Array.from(new Set(generatedGoals.map((item) => String(item).trim()).filter(Boolean))).slice(0, MAX_FOCUS_TASKS);
    while (deduped.length < MIN_FOCUS_TASKS) deduped.push("");

    Alert.alert(
      "Auto-Plan Week",
      "Generate weekly focus goals from tasks due this week?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: () => {
            setWeekPlan((previous) => ({
              ...previous,
              goals: deduped,
            }));
            setSaveMessage("Auto-plan applied for week. Review then tap Save Week Plan.");
          },
        },
      ]
    );
  };

  const runAutoPlanMonth = () => {
    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const dueThisMonth = getAssignmentsInRange(monthStart, monthEnd).slice(0, AUTO_PLAN_MAX_TASKS);

    const generatedGoals = dueThisMonth.length
      ? dueThisMonth.map((task) => task?.title).filter(Boolean)
      : [
          "Track major deliverables for this month",
          "Finish long-form project milestones",
          "Prepare for monthly exams early",
        ];

    const dedupedGoals = Array.from(new Set(generatedGoals.map((item) => String(item).trim()).filter(Boolean))).slice(0, MAX_FOCUS_TASKS);
    while (dedupedGoals.length < MIN_FOCUS_TASKS) dedupedGoals.push("");

    const generatedMilestones = dueThisMonth
      .map((task) => String(task?.title || "").trim())
      .filter(Boolean)
      .slice(0, 8);

    Alert.alert(
      "Auto-Plan Month",
      "Generate monthly focus goals and milestones from your upcoming tasks?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: () => {
            setMonthPlan((previous) => ({
              ...previous,
              goals: dedupedGoals,
              milestones: generatedMilestones.length ? generatedMilestones : previous.milestones,
            }));
            setSaveMessage("Auto-plan applied for month. Review then tap Save Month Plan.");
          },
        },
      ]
    );
  };

  const addTimeBlock = () => {
    setDayPlan((previous) => ({
      ...previous,
      timeBlocks: [...previous.timeBlocks, makeTimeBlock()],
    }));
    setSaveMessage("");
  };

  const addBlockFromClass = (cls) => {
    const range = getClassRangeMeta(cls);
    setDayPlan((previous) => ({
      ...previous,
      timeBlocks: [
        ...previous.timeBlocks,
        makeTimeBlock({
          start: range ? toClockInput(range.start) : "",
          end: range ? toClockInput(range.end) : "",
          subject: typeof cls?.subject === "string" ? cls.subject : "",
          task: "",
        }),
      ],
    }));
    setSaveMessage("");
  };

  const removeTimeBlock = (id) => {
    setDayPlan((previous) => ({
      ...previous,
      timeBlocks: previous.timeBlocks.filter((block) => block.id !== id),
    }));
  };

  const updateTimeBlock = (id, field, value) => {
    setDayPlan((previous) => ({
      ...previous,
      timeBlocks: previous.timeBlocks.map((block) => {
        if (block.id !== id) return block;
        return { ...block, [field]: value };
      }),
    }));
  };

  const addMilestone = () => {
    setMonthPlan((previous) => ({
      ...previous,
      milestones: [...(previous.milestones || []), ""],
    }));
  };

  const updateMilestone = (index, value) => {
    setMonthPlan((previous) => {
      const nextMilestones = [...(previous.milestones || [])];
      nextMilestones[index] = value;
      return {
        ...previous,
        milestones: nextMilestones,
      };
    });
  };

  const removeMilestone = (index) => {
    setMonthPlan((previous) => ({
      ...previous,
      milestones: (previous.milestones || []).filter((_, idx) => idx !== index),
    }));
  };

  const savePlannerByMode = async (mode) => {
    const user = auth.currentUser;
    if (!user || savingMode) return;

    setSavingMode(mode);
    setErrorMessage("");

    try {
      let syncSummary = null;
      let queuedSave = false;

      if (mode === "day") {
        const saved = await saveDayPlan(user.uid, selectedDate, dayPlan, { isOnline });
        setDayPlan(saved);
        queuedSave = Boolean(saved.queued);
        if (!queuedSave && isOnline) {
          syncSummary = await syncDayPlannerTasks(user.uid, selectedDate, saved.dayKey, saved.timeBlocks || []);
        }
      }

      if (mode === "week") {
        const saved = await saveWeekPlan(user.uid, selectedDate, weekPlan, { isOnline });
        setWeekPlan(saved);
        queuedSave = Boolean(saved.queued);
      }

      if (mode === "month") {
        const saved = await saveMonthPlan(user.uid, selectedDate, monthPlan, { isOnline });
        setMonthPlan(saved);
        queuedSave = Boolean(saved.queued);
        if (!queuedSave && isOnline) {
          syncSummary = await syncMonthPlannerTasks(user.uid, selectedDate, saved.monthKey, saved.milestones || []);
        }
      }

      if (isOnline && !queuedSave) {
        const plannerTaskData = await fetchPlannerAssignments(user.uid);
        setPlannerAssignments(plannerTaskData);
      }

      if (syncSummary) {
        await rescheduleAll();
      }

      await refreshPlannerQueue();
      if (queuedSave) {
        setSaveMessage("Saved offline. Changes will sync when you're back online.");
      } else {
        const syncText = formatSyncSummary(syncSummary);
        setSaveMessage(syncText ? `${makeSaveMessage(mode)}. ${syncText}.` : makeSaveMessage(mode));
      }
    } catch (error) {
      console.warn("Planner save error:", error);
      setErrorMessage("Save failed. Please try again.");
    } finally {
      setSavingMode("");
    }
  };

  const renderSaveButton = (mode, label) => {
    const thisModeSaving = savingMode === mode;

    return (
      <TouchableOpacity
        style={[styles.saveButton, { backgroundColor: colors.primary, opacity: thisModeSaving ? 0.7 : 1 }]}
        onPress={() => savePlannerByMode(mode)}
        disabled={Boolean(savingMode)}
      >
        {thisModeSaving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="save-outline" size={17} color="#fff" />
            <Text style={styles.saveButtonText}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  const renderDayPlanner = () => {
    const dayPriorityCount = Array.isArray(dayPlan.priorities) ? dayPlan.priorities.length : 0;
    const canAddDayPriority = dayPriorityCount < MAX_FOCUS_TASKS;
    const canRemoveDayPriority = dayPriorityCount > MIN_FOCUS_TASKS;

    return (
      <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Class Guide ({selectedDayName})</Text>
          <TouchableOpacity onPress={jumpToToday} style={[styles.smallAction, { backgroundColor: colors.highlight }]}>
            <Ionicons name="calendar-outline" size={15} color={colors.primary} />
            <Text style={[styles.smallActionText, { color: colors.primary }]}>Today</Text>
          </TouchableOpacity>
        </View>

        {selectedDayClasses.length === 0 ? (
          <EmptyStateCard
            title="No classes scheduled"
            message="This day has no classes."
            icon="sunny-outline"
            compact
            style={{ borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }}
          />
        ) : (
          <>
            {selectedDayClasses.map((cls, idx) => (
              <View
                key={`${selectedDayName}-${idx}-${cls.subject || "class"}`}
                style={[styles.classGuideRow, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
              >
                <View style={[styles.classGuideDot, { backgroundColor: colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.classGuideSubject, { color: colors.text }]} numberOfLines={1}>{cls.subject || "Class"}</Text>
                  <Text style={[styles.classGuideTime, { color: colors.muted }]}>{cls.timeDisplay || "Time TBD"}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => addBlockFromClass(cls)}
                  style={[styles.classUseButton, { backgroundColor: colors.highlight }]}
                >
                  <Ionicons name="add-circle-outline" size={14} color={colors.primary} />
                  <Text style={[styles.classUseText, { color: colors.primary }]}>Use</Text>
                </TouchableOpacity>
              </View>
            ))}
            {todayClassesFinished ? (
              <View style={[styles.afterClassPill, { backgroundColor: isDark ? "#1f2937" : "#eef2ff", borderColor: colors.border }]}>
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.primary} />
                <Text style={[styles.afterClassText, { color: colors.text }]}>
                  Classes finished for today. Check pending tasks and planner blocks.
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Today&apos;s Time Plan</Text>
        <Text style={[styles.cardSubtext, { color: colors.muted }]}>
          Link blocks to subjects or create custom time-only blocks for the day.
        </Text>
        <View style={styles.dayUsageRow}>
          <View style={[styles.dayUsageCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.dayUsageValue, { color: colors.text }]}>{formatDuration(dayTimeSummary.plannedMinutes)}</Text>
            <Text style={[styles.dayUsageLabel, { color: colors.muted }]}>Planned time</Text>
          </View>
          <View style={[styles.dayUsageCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.dayUsageValue, { color: colors.text }]}>{dayTimeSummary.subjectLinkedBlocks}</Text>
            <Text style={[styles.dayUsageLabel, { color: colors.muted }]}>Subject-linked</Text>
          </View>
          <View style={[styles.dayUsageCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.dayUsageValue, { color: colors.text }]}>{dayTimeSummary.customBlocks}</Text>
            <Text style={[styles.dayUsageLabel, { color: colors.muted }]}>Custom blocks</Text>
          </View>
        </View>
      </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Daily Focus Tasks</Text>
            <View style={styles.actionGroupRow}>
              <TouchableOpacity
                onPress={runAutoPlanDay}
                style={[styles.smallAction, { backgroundColor: colors.highlight }]}
              >
                <Ionicons name="flash-outline" size={15} color={colors.primary} />
                <Text style={[styles.smallActionText, { color: colors.primary }]}>Auto</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={addDayPriority}
                disabled={!canAddDayPriority}
                style={[
                  styles.smallAction,
                  {
                    backgroundColor: colors.highlight,
                    opacity: canAddDayPriority ? 1 : 0.55,
                  },
                ]}
              >
                <Ionicons name="add" size={15} color={colors.primary} />
                <Text style={[styles.smallActionText, { color: colors.primary }]}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[styles.cardSubtext, { color: colors.muted }]}>
            Add focus tasks for today. You can save up to {MAX_FOCUS_TASKS}.
          </Text>
          {dayPlan.priorities.map((priority, index) => (
            <View key={`priority-${index}`} style={styles.focusInputRow}>
              <TextInput
                value={priority}
                onChangeText={(value) => updatePriority(index, value)}
                placeholder={`Focus task ${index + 1}`}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.focusInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
              />
              {canRemoveDayPriority ? (
                <TouchableOpacity style={styles.focusDeleteButton} onPress={() => removeDayPriority(index)}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Time Blocks</Text>
          <TouchableOpacity onPress={addTimeBlock} style={[styles.smallAction, { backgroundColor: colors.highlight }]}>
            <Ionicons name="add" size={15} color={colors.primary} />
            <Text style={[styles.smallActionText, { color: colors.primary }]}>Add Block</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.cardSubtext, { color: colors.muted }]}>
          Use HH:MM format (e.g., 13:00-14:30). Add a subject to link this block with class context.
        </Text>

        {dayPlan.timeBlocks.length === 0 ? (
          <EmptyStateCard
            title="No time blocks yet"
            message="Add a focus block to start planning."
            icon="time-outline"
            compact
            style={{ borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }}
          />
        ) : (
          dayPlan.timeBlocks.map((block, index) => (
            <View key={block.id} style={[styles.blockCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
              <View style={styles.blockTopRow}>
                <Text style={[styles.blockLabel, { color: colors.text }]}>Block {index + 1}</Text>
                <TouchableOpacity onPress={() => removeTimeBlock(block.id)}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              </View>

              <View style={styles.timeRow}>
                <TextInput
                  value={block.start}
                  onChangeText={(value) => updateTimeBlock(block.id, "start", value)}
                  placeholder="Start (08:00)"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.timeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />
                <TextInput
                  value={block.end}
                  onChangeText={(value) => updateTimeBlock(block.id, "end", value)}
                  placeholder="End (09:00)"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.timeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />
              </View>

              <TextInput
                value={block.task}
                onChangeText={(value) => updateTimeBlock(block.id, "task", value)}
                placeholder="Task or focus item (e.g., practice set)"
                placeholderTextColor={colors.muted}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <TextInput
                value={block.subject || ""}
                onChangeText={(value) => updateTimeBlock(block.id, "subject", value)}
                placeholder="Subject (optional)"
                placeholderTextColor={colors.muted}
                style={[styles.input, { marginTop: 8, color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </View>
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Notes</Text>
        <TextInput
          value={dayPlan.notes}
          onChangeText={(value) => setDayPlan((previous) => ({ ...previous, notes: value }))}
          placeholder="Daily notes, wins, blockers..."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.notesInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
        />
      </View>

        {renderSaveButton("day", "Save Day Plan")}
      </>
    );
  };

  const renderWeekPlanner = () => {
    const weekGoalCount = Array.isArray(weekPlan.goals) ? weekPlan.goals.length : 0;
    const canAddWeekGoal = weekGoalCount < MAX_FOCUS_TASKS;
    const canRemoveWeekGoal = weekGoalCount > MIN_FOCUS_TASKS;

    return (
      <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Week Schedule Snapshot</Text>
        <View style={styles.weekStatsRow}>
          <View style={[styles.weekStatCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.weekStatValue, { color: colors.text }]}>{weekClassCount}</Text>
            <Text style={[styles.weekStatLabel, { color: colors.muted }]}>Classes this week</Text>
          </View>
          <View style={[styles.weekStatCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.weekStatValue, { color: colors.text }]}>{activeClassDays}</Text>
            <Text style={[styles.weekStatLabel, { color: colors.muted }]}>Active class days</Text>
          </View>
        </View>
      </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Weekly Focus & To-Do</Text>
            <View style={styles.actionGroupRow}>
              <TouchableOpacity
                onPress={runAutoPlanWeek}
                style={[styles.smallAction, { backgroundColor: colors.highlight }]}
              >
                <Ionicons name="flash-outline" size={15} color={colors.primary} />
                <Text style={[styles.smallActionText, { color: colors.primary }]}>Auto</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={addWeekGoal}
                disabled={!canAddWeekGoal}
                style={[
                  styles.smallAction,
                  {
                    backgroundColor: colors.highlight,
                    opacity: canAddWeekGoal ? 1 : 0.55,
                  },
                ]}
              >
                <Ionicons name="add" size={15} color={colors.primary} />
                <Text style={[styles.smallActionText, { color: colors.primary }]}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[styles.cardSubtext, { color: colors.muted }]}>Set what must be done this week and where to focus your energy.</Text>

          {weekPlan.goals.map((goal, index) => (
            <View key={`weekly-goal-${index}`} style={styles.focusInputRow}>
              <TextInput
                value={goal}
                onChangeText={(value) => updateWeekGoal(index, value)}
                placeholder={`Weekly focus / task ${index + 1}`}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.focusInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
              />
              {canRemoveWeekGoal ? (
                <TouchableOpacity style={styles.focusDeleteButton} onPress={() => removeWeekGoal(index)}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Weekly Notes</Text>
        <TextInput
          value={weekPlan.notes}
          onChangeText={(value) => setWeekPlan((previous) => ({ ...previous, notes: value }))}
          placeholder="What matters this week? Any constraints, deadlines, or reminders?"
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.notesInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
        />
      </View>

        {renderSaveButton("week", "Save Week Plan")}
      </>
    );
  };

  const renderMonthPlanner = () => {
    const monthGoalCount = Array.isArray(monthPlan.goals) ? monthPlan.goals.length : 0;
    const canAddMonthGoal = monthGoalCount < MAX_FOCUS_TASKS;
    const canRemoveMonthGoal = monthGoalCount > MIN_FOCUS_TASKS;

    return (
      <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Month Schedule Snapshot</Text>
        <View style={styles.weekStatsRow}>
          <View style={[styles.weekStatCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.weekStatValue, { color: colors.text }]}>{monthClassCount}</Text>
            <Text style={[styles.weekStatLabel, { color: colors.muted }]}>Estimated classes this month</Text>
          </View>
          <View style={[styles.weekStatCard, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
            <Text style={[styles.weekStatValue, { color: colors.text }]}>{weekClassCount}</Text>
            <Text style={[styles.weekStatLabel, { color: colors.muted }]}>Weekly class baseline</Text>
          </View>
        </View>
      </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Monthly Focus & To-Do</Text>
            <View style={styles.actionGroupRow}>
              <TouchableOpacity
                onPress={runAutoPlanMonth}
                style={[styles.smallAction, { backgroundColor: colors.highlight }]}
              >
                <Ionicons name="flash-outline" size={15} color={colors.primary} />
                <Text style={[styles.smallActionText, { color: colors.primary }]}>Auto</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={addMonthGoal}
                disabled={!canAddMonthGoal}
                style={[
                  styles.smallAction,
                  {
                    backgroundColor: colors.highlight,
                    opacity: canAddMonthGoal ? 1 : 0.55,
                  },
                ]}
              >
                <Ionicons name="add" size={15} color={colors.primary} />
                <Text style={[styles.smallActionText, { color: colors.primary }]}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[styles.cardSubtext, { color: colors.muted }]}>Set the key outcomes and major tasks for this month.</Text>

          {monthPlan.goals.map((goal, index) => (
            <View key={`monthly-goal-${index}`} style={styles.focusInputRow}>
              <TextInput
                value={goal}
                onChangeText={(value) => updateMonthGoal(index, value)}
                placeholder={`Monthly focus / task ${index + 1}`}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.focusInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
              />
              {canRemoveMonthGoal ? (
                <TouchableOpacity style={styles.focusDeleteButton} onPress={() => removeMonthGoal(index)}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Milestones</Text>
          <TouchableOpacity onPress={addMilestone} style={[styles.smallAction, { backgroundColor: colors.highlight }]}>
            <Ionicons name="add" size={15} color={colors.primary} />
            <Text style={[styles.smallActionText, { color: colors.primary }]}>Add Milestone</Text>
          </TouchableOpacity>
        </View>

        {(monthPlan.milestones || []).length === 0 ? (
          <EmptyStateCard
            title="No milestones yet"
            message="Add a milestone to keep monthly goals visible."
            icon="flag-outline"
            compact
            style={{ borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }}
          />
        ) : (
          (monthPlan.milestones || []).map((milestone, index) => (
            <View key={`milestone-${index}`} style={[styles.milestoneRow, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}>
              <TextInput
                value={milestone}
                onChangeText={(value) => updateMilestone(index, value)}
                placeholder={`Milestone / task ${index + 1}`}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.milestoneInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <TouchableOpacity style={styles.milestoneDelete} onPress={() => removeMilestone(index)}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Monthly Notes</Text>
        <TextInput
          value={monthPlan.notes}
          onChangeText={(value) => setMonthPlan((previous) => ({ ...previous, notes: value }))}
          placeholder="Big themes, deadlines, and checkpoints for the month..."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.notesInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fbff" }]}
        />
      </View>

        {renderSaveButton("month", "Save Month Plan")}
      </>
    );
  };

  const analyticsCards = [
    { id: "day", label: "Day", keyLabel: keys.dayKey, data: analytics.day },
    { id: "week", label: "Week", keyLabel: keys.weekKey, data: analytics.week },
    { id: "month", label: "Month", keyLabel: keys.monthKey, data: analytics.month },
  ];
  const currentAnalyticsIndex = VIEW_MODES.indexOf(selectedMode);

  useEffect(() => {
    if (loading) return;
    if (currentAnalyticsIndex < 0) return;
    if (hasAutoSnappedAnalytics.current) return;
    if (!analyticsScrollRef.current) return;

    const offsetX = currentAnalyticsIndex * (ANALYTICS_CARD_WIDTH + ANALYTICS_CARD_GAP);
    const timer = setTimeout(() => {
      analyticsScrollRef.current?.scrollTo({ x: offsetX, animated: true });
      hasAutoSnappedAnalytics.current = true;
    }, 150);

    return () => clearTimeout(timer);
  }, [loading, currentAnalyticsIndex]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.background} />

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
        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <View style={styles.heroCircle} />
          <View style={styles.heroCircleTwo} />
          <Text style={styles.heroLabel}>Planner Hub</Text>
          <Text style={styles.heroTitle}>Plan by day, week, and month</Text>
          <Text style={styles.heroDate}>{heroMeta}</Text>
          {plannerQueueCount > 0 && (
            <View style={styles.queuePill}>
              <Ionicons name="cloud-upload-outline" size={14} color="#fff" />
              <Text style={styles.queuePillText}>
                {plannerQueueCount} update{plannerQueueCount > 1 ? "s" : ""} waiting to sync
              </Text>
            </View>
          )}

          <View style={styles.dateNavRow}>
            <TouchableOpacity style={styles.navButton} onPress={() => shiftDate(-1)}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.todayButton} onPress={jumpToToday}>
              <Text style={styles.todayButtonText}>Today</Text>
            </TouchableOpacity>
            <Text style={styles.dateNavText}>{currentKeyLabel}</Text>
            <TouchableOpacity style={styles.navButton} onPress={() => shiftDate(1)}>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.segment, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {VIEW_MODES.map((mode) => {
            const active = selectedMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.segmentButton, active ? { backgroundColor: colors.primary } : null]}
                onPress={() => {
                  setSelectedMode(mode);
                  const today = new Date();
                  setSelectedDate(today);
                  loadPlannerData(today, false);
                  setSaveMessage("");
                }}
              >
                <Text style={[styles.segmentText, { color: active ? "#fff" : colors.muted }]}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <View style={[styles.loadingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>Loading planner...</Text>
          </View>
        ) : (
          <>
            {errorMessage ? (
              <View style={[styles.messageCard, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
                <Text style={[styles.messageText, { color: colors.danger }]}>{errorMessage}</Text>
              </View>
            ) : null}

            {saveMessage ? (
              <View style={[styles.messageCard, { backgroundColor: isDark ? "#102218" : "#ecfdf3", borderColor: colors.success }]}>
                <Text style={[styles.messageText, { color: colors.success }]}>{saveMessage}</Text>
              </View>
            ) : null}

            <View style={[styles.analyticsSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.analyticsTitle, { color: colors.text }]}>Planned vs Completed</Text>
              <ScrollView
                ref={analyticsScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.analyticsGrid}
              >
                {analyticsCards.map((card) => (
                  <View key={card.id} style={[styles.analyticsCard, { backgroundColor: isDark ? "#0f172a" : "#f8fbff", borderColor: colors.border }]}>
                    <Text style={[styles.analyticsCardLabel, { color: colors.text }]}>{card.label}</Text>
                    <Text style={[styles.analyticsCardKey, { color: colors.muted }]}>{card.keyLabel}</Text>
                    <Text style={[styles.analyticsCount, { color: colors.text }]}>
                      {card.data.completed}/{card.data.planned}
                    </Text>
                    <Text style={[styles.analyticsSub, { color: colors.muted }]}>
                      {card.data.pending} pending
                    </Text>
                    <View style={[styles.progressTrack, { backgroundColor: isDark ? "#1e293b" : "#e2e8f0" }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: card.data.planned === 0 ? "0%" : `${Math.max(6, card.data.percent)}%`,
                            backgroundColor: card.data.percent >= 70 ? colors.success : colors.primary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.analyticsPercent, { color: colors.muted }]}>{card.data.percent}% complete</Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {selectedMode === "day" ? renderDayPlanner() : null}
            {selectedMode === "week" ? renderWeekPlanner() : null}
            {selectedMode === "month" ? renderMonthPlanner() : null}
          </>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    paddingBottom: 30,
  },
  hero: {
    marginHorizontal: 16,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 22,
    overflow: "hidden",
  },
  heroCircle: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.11)",
    top: -40,
    right: -30,
  },
  heroCircleTwo: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: "rgba(255,255,255,0.08)",
    bottom: 16,
    right: 56,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  heroTitle: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "800",
    marginBottom: 5,
  },
  heroDate: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 12,
  },
  queuePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 10,
  },
  queuePillText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  dateNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center",
  },
  dateNavText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  todayButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  todayButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
  segment: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 4,
    flexDirection: "row",
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
  },
  loadingCard: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 20,
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: "600",
  },
  messageCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageText: {
    fontSize: 12,
    fontWeight: "700",
  },
  analyticsSection: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  analyticsTitle: {
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },
  analyticsGrid: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
  },
  analyticsCard: {
    width: ANALYTICS_CARD_WIDTH,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  analyticsCardLabel: {
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 2,
  },
  analyticsCardKey: {
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 7,
  },
  analyticsCount: {
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 2,
  },
  analyticsSub: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 7,
  },
  progressTrack: {
    height: 7,
    borderRadius: 7,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: {
    height: "100%",
    borderRadius: 7,
  },
  analyticsPercent: {
    fontSize: 10,
    fontWeight: "700",
  },
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  cardSubtext: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 10,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  actionGroupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  smallAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  smallActionText: {
    fontSize: 12,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    fontWeight: "500",
  },
  priorityInput: {
    marginBottom: 9,
  },
  focusInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 9,
  },
  focusInput: {
    flex: 1,
  },
  focusDeleteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  timeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  timeInput: {
    flex: 1,
  },
  blockCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  blockTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: "800",
  },
  emptyBlock: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 8,
    paddingVertical: 18,
    alignItems: "center",
    gap: 4,
  },
  emptyBlockText: {
    fontSize: 12,
    fontWeight: "600",
  },
  notesInput: {
    minHeight: 110,
  },
  classGuideRow: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  classGuideDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  classGuideSubject: {
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 1,
  },
  classGuideTime: {
    fontSize: 11,
    fontWeight: "600",
  },
  classUseButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
  },
  classUseText: {
    fontSize: 11,
    fontWeight: "800",
  },
  dayUsageRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  dayUsageCard: {
    borderWidth: 1,
    borderRadius: 10,
    minWidth: 92,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  dayUsageValue: {
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 2,
  },
  dayUsageLabel: {
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  afterClassPill: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  afterClassText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  weekStatsRow: {
    flexDirection: "row",
    gap: 8,
  },
  weekStatCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  weekStatValue: {
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 2,
  },
  weekStatLabel: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  milestoneRow: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 9,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  milestoneInput: {
    flex: 1,
  },
  milestoneDelete: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  saveButton: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
});
