/**
 * CalendarPlannerScreen.js
 *
 * A full-featured calendar planner screen for CTU Academic Task Manager.
 * Features:
 *  - Monthly calendar with color-coded dots per day (priority tags)
 *  - Tap a day -> view/add notes and timed plans for that day
 *  - Set a time for each plan -> local notification fires at that time
 *  - Priority tags: urgent, normal, low
 *  - Repeat option: once, daily, weekly
 *  - Notification snooze (5 / 15 / 30 min) via action categories
 *  - Daily summary notification at 7:00 AM listing today's plans
 *
 * Drop-in usage:
 *   import CalendarPlannerScreen from "./CalendarPlannerScreen";
 *   // Add as a tab or stack screen - no required props.
 */

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import { useTheme } from "../../context/ThemeContext";
import {
  formatMonthLabel,
  formatTime12,
  getDaysInMonth,
  getFirstDayOfMonth,
  parseDateKey,
  parseMonthKey,
  toDateKey,
} from "@/utils/dateHelpers";
import { formatDeadlineCountdown } from "../../utils/deadlineTime";
import {
  cancelNativeAlarmByScheduledId,
  isNativeAlarmSupported,
  scheduleNativeAlarm,
  toNativeAlarmScheduledId,
} from "../../utils/nativeAlarm";
import { syncCalendarDayPlans } from "../../utils/plannerTaskSync";
import { warnIfDev } from "../../utils/logger";

// ---
// Notification bootstrap (mirrors NotificationContext pattern)
// ---
let Notifications = null;
try {
  Notifications = require("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (err) {
  warnIfDev("CalendarPlannerScreen: expo-notifications unavailable:", err);
  Notifications = null;
}

const NOTIF_AVAILABLE =
  Boolean(Notifications) &&
  typeof Notifications.scheduleNotificationAsync === "function";

const ANDROID_CHANNEL = "cal-planner-v1";
const ACK_CATEGORY = "cal_plan_ack";
const ACTION_ACKNOWLEDGE = "acknowledge_plan";
const ACTION_SNOOZE_5 = "snooze_5";
const ACTION_SNOOZE_15 = "snooze_15";
const ACTION_SNOOZE_30 = "snooze_30";
const PLANNER_NOTIFICATION_TYPE = "planner_deadline";
const PLANNER_ONCE_LEAD_MINUTES = [4320, 1440, 360, 120, 30];
const PLANNER_DAILY_LEAD_MINUTES = [360, 120, 30];

function formatPlannerLeadTitle(minutesBefore) {
  if (!Number.isFinite(minutesBefore) || minutesBefore <= 0) {
    return "Plan starts soon";
  }
  if (minutesBefore % (24 * 60) === 0) {
    const days = minutesBefore / (24 * 60);
    return days === 1 ? "Plan starts tomorrow" : `Plan starts in ${days} days`;
  }
  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return hours === 1
      ? "Plan starts in 1 hour"
      : `Plan starts in ${hours} hours`;
  }
  return `Plan starts in ${minutesBefore} minutes`;
}

function getPlannerLeadMinutes(repeat = "once") {
  return repeat === "daily"
    ? PLANNER_DAILY_LEAD_MINUTES
    : PLANNER_ONCE_LEAD_MINUTES;
}

function getPlannerNotificationContentExtra() {
  if (Platform.OS !== "android") {
    return { categoryIdentifier: ACK_CATEGORY };
  }
  return {
    categoryIdentifier: ACK_CATEGORY,
    priority: "high",
    autoDismiss: false,
    sticky: true,
  };
}

function canUseNativePlannerAlarm(repeat = "once") {
  return (
    Platform.OS === "android" && isNativeAlarmSupported && repeat === "once"
  );
}

function buildPlannerOccurrenceLabel(planTime, repeat = "once") {
  const timeLabel = formatTime12(planTime);
  if (repeat === "daily") {
    return `daily at ${timeLabel}`;
  }
  if (repeat === "weekly") {
    const weekdayLabel = planTime.toLocaleDateString("en-US", {
      weekday: "long",
    });
    return `every ${weekdayLabel} at ${timeLabel}`;
  }
  return planTime.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPlannerLeadBody(plan, planTime, triggerDate) {
  const title = plan?.title || "Planner item";
  const repeat = plan?.repeat ?? "once";
  const countdown = formatDeadlineCountdown(planTime, triggerDate, {
    style: "long",
  }).replace(/\s+left$/, "");
  const occurrenceLabel = buildPlannerOccurrenceLabel(planTime, repeat);
  return `"${title}" starts in ${countdown} (${occurrenceLabel}). Open Planner when you are ready to act.`;
}

function buildPlannerDueBody(plan, planTime) {
  const title = plan?.title || "Planner item";
  const occurrenceLabel = buildPlannerOccurrenceLabel(
    planTime,
    plan?.repeat ?? "once"
  );
  return `"${title}" starts now (${occurrenceLabel}). Open Planner and acknowledge it.`;
}

function buildPlannerNotificationRequests(plan, planTime) {
  const repeat = plan?.repeat ?? "once";
  const contentExtra = getPlannerNotificationContentExtra();
  const requests = getPlannerLeadMinutes(repeat).map((minutesBefore) => {
    const triggerDate = new Date(
      planTime.getTime() - minutesBefore * 60 * 1000
    );
    return {
      id: `planner_${plan.id}_${minutesBefore}m`,
      title: formatPlannerLeadTitle(minutesBefore),
      body: buildPlannerLeadBody(plan, planTime, triggerDate),
      triggerDate,
      repeat,
      weekday: triggerDate.getDay(),
      data: {
        type: PLANNER_NOTIFICATION_TYPE,
        planId: plan.id,
        checkpoint: `${minutesBefore}m`,
        acknowledgeRequired: true,
      },
      contentExtra,
    };
  });

  requests.push({
    id: `planner_${plan.id}_due`,
    title: "Plan starts now",
    body: buildPlannerDueBody(plan, planTime),
    triggerDate: planTime,
    repeat,
    weekday: planTime.getDay(),
    data: {
      type: PLANNER_NOTIFICATION_TYPE,
      planId: plan.id,
      checkpoint: "due",
      acknowledgeRequired: true,
    },
    contentExtra,
  });

  return requests;
}

async function bootstrapNotifChannel() {
  if (!NOTIF_AVAILABLE) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: "Calendar Planner",
      importance: Notifications.AndroidImportance?.MAX ?? 5,
      vibrationPattern: [0, 400, 200, 400],
    });
  }
  if (typeof Notifications.setNotificationCategoryAsync === "function") {
    await Notifications.setNotificationCategoryAsync(ACK_CATEGORY, [
      {
        identifier: ACTION_ACKNOWLEDGE,
        buttonTitle: "Acknowledge",
        options: { opensAppToForeground: true },
      },
      {
        identifier: ACTION_SNOOZE_5,
        buttonTitle: "Snooze 5 min",
        options: { opensAppToForeground: false },
      },
      {
        identifier: ACTION_SNOOZE_15,
        buttonTitle: "Snooze 15 min",
        options: { opensAppToForeground: false },
      },
      {
        identifier: ACTION_SNOOZE_30,
        buttonTitle: "Snooze 30 min",
        options: { opensAppToForeground: false },
      },
    ]);
  }
}

async function requestNotifPermission() {
  if (!NOTIF_AVAILABLE) return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function scheduleLocalNotif({
  id,
  title,
  body,
  triggerDate,
  repeat,
  weekday,
  data = {},
  contentExtra = {},
}) {
  if (!NOTIF_AVAILABLE) return null;
  if (id) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
  const extra = Platform.OS === "android" ? { channelId: ANDROID_CHANNEL } : {};
  let trigger;
  if (repeat === "daily") {
    trigger = {
      type: "daily",
      hour: triggerDate.getHours(),
      minute: triggerDate.getMinutes(),
      ...extra,
    };
  } else if (repeat === "weekly" && weekday !== undefined) {
    trigger = {
      type: "weekly",
      weekday: weekday + 1, // expo: 1=Sun ... 7=Sat
      hour: triggerDate.getHours(),
      minute: triggerDate.getMinutes(),
      ...extra,
    };
  } else {
    if (triggerDate <= new Date()) return null;
    trigger = { type: "date", date: triggerDate, ...extra };
  }
  try {
    const notifId = await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data,
        ...contentExtra,
        ...extra,
      },
      trigger,
    });
    return notifId;
  } catch (err) {
    warnIfDev("CalendarPlannerScreen: scheduleNotificationAsync failed:", err);
    return null;
  }
}

async function schedulePlannerAlarm(request) {
  if (!request?.triggerDate || Number.isNaN(request.triggerDate.getTime?.())) {
    return null;
  }

  if (canUseNativePlannerAlarm(request.repeat)) {
    const triggerAt = request.triggerDate.getTime();
    if (triggerAt <= Date.now()) return null;
    try {
      const nativeId = await scheduleNativeAlarm({
        alarmId: request.id,
        triggerAt,
        title: request.title,
        body: request.body,
        payload: request.data,
      });
      if (nativeId) return nativeId;
    } catch (err) {
      warnIfDev("CalendarPlannerScreen: native planner alarm scheduling failed:", err);
      // Fall back to a regular local notification on scheduling errors.
    }
  }

  return scheduleLocalNotif(request);
}

async function cancelNotif(id) {
  if (!NOTIF_AVAILABLE) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}

async function cancelPlanNotifications(planId) {
  if (!planId) return;
  if (NOTIF_AVAILABLE) {
    await cancelNotif(planId);
  }
  const nativeAlarmIds = new Set(
    [...PLANNER_ONCE_LEAD_MINUTES, ...PLANNER_DAILY_LEAD_MINUTES].map(
      (minutesBefore) => `planner_${planId}_${minutesBefore}m`
    )
  );
  nativeAlarmIds.add(`planner_${planId}_due`);
  await Promise.all(
    Array.from(nativeAlarmIds).map((alarmId) =>
      cancelNativeAlarmByScheduledId(toNativeAlarmScheduledId(alarmId)).catch(
        () => false
      )
    )
  );
  if (!NOTIF_AVAILABLE) return;
  if (
    typeof Notifications.getAllScheduledNotificationsAsync !== "function" ||
    typeof Notifications.cancelScheduledNotificationAsync !== "function"
  ) {
    return;
  }
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ids = new Set();
    for (const item of Array.isArray(scheduled) ? scheduled : []) {
      const request = item?.request || {};
      const content = request?.content || item?.content || {};
      const data = content?.data || {};
      const identifier =
        typeof request?.identifier === "string"
          ? request.identifier
          : typeof item?.identifier === "string"
            ? item.identifier
            : "";
      const dataPlanId =
        typeof data?.planId === "string" ? data.planId.trim() : "";
      if (!identifier) continue;
      if (dataPlanId === planId || identifier.includes(planId)) {
        ids.add(identifier);
      }
    }
    await Promise.all(
      Array.from(ids).map((id) =>
        Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
      )
    );
  } catch (err) {
    warnIfDev("CalendarPlannerScreen: failed to cleanup plan notifications:", err);
    // Best effort cleanup only.
  }
}

async function scheduleDailySummary(plans, date) {
  if (!NOTIF_AVAILABLE) return;
  const summaryId = `cal_daily_summary_${toDateKey(date)}`;
  await cancelNotif(summaryId);
  const todayPlans = plans.filter((p) => p.dayKey === toDateKey(date));
  if (todayPlans.length === 0) return;
  const names = todayPlans
    .slice(0, 3)
    .map((p) => p.title)
    .join(", ");
  const extra = todayPlans.length > 3 ? ` +${todayPlans.length - 3} more` : "";
  const trigger7am = new Date(date);
  trigger7am.setHours(7, 0, 0, 0);
  if (trigger7am <= new Date()) return;
  await scheduleLocalNotif({
    id: summaryId,
    title: "Today's Plans",
    body: `${names}${extra}`,
    triggerDate: trigger7am,
    repeat: "once",
  });
}

// ---
// Storage helpers
// ---
const STORAGE_KEY = "cal_planner_plans_v2";

async function loadAllPlans() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    warnIfDev("CalendarPlannerScreen: failed to load plans from storage:", err);
    return [];
  }
}

async function saveAllPlans(plans) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

// ---
// Date helpers
// ---
function normalizeRouteParam(value) {
  if (Array.isArray(value)) return normalizeRouteParam(value[0]);
  return typeof value === "string" ? value.trim() : "";
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---
// Constants
// ---
const PRIORITIES = [
  { key: "urgent", label: "Urgent", color: "#ef4444", icon: "alert-circle" },
  { key: "normal", label: "Normal", color: "#3b82f6", icon: "time" },
  { key: "low", label: "Low", color: "#22c55e", icon: "leaf" },
];

const REPEAT_OPTIONS = [
  { key: "once", label: "Once" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
];

function priorityMeta(key) {
  return PRIORITIES.find((p) => p.key === key) ?? PRIORITIES[1];
}

// ---
// Main Screen
// ---
export default function CalendarPlannerScreen() {
  const { colors, isDark } = useTheme();
  const { settings: notificationSettings } = useNotifications();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    dayKey: dayKeyParam,
    monthKey: monthKeyParam,
    focusPlanId,
  } = useLocalSearchParams();

  // State
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [plans, setPlans] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [notifPermission, setNotifPermission] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncSummary, setSyncSummary] = useState({
    created: 0,
    updated: 0,
    archived: 0,
  });
  const [focusedPlanId, setFocusedPlanId] = useState("");

  // Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  // Form fields
  const [formTitle, setFormTitle] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formPriority, setFormPriority] = useState("normal");
  const [formTime, setFormTime] = useState(() => {
    const t = new Date();
    t.setHours(8, 0, 0, 0);
    return t;
  });
  const [formRepeat, setFormRepeat] = useState("once");
  const [formNotifEnabled, setFormNotifEnabled] = useState(true);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Boot (runs once on mount, but uses correct day from route params if provided)
  useEffect(() => {
    bootstrapNotifChannel();
    requestNotifPermission().then(setNotifPermission);
    loadAllPlans().then(async (data) => {
      setPlans(data);
      const requestedDayKey = normalizeRouteParam(dayKeyParam);
      const dayKeyToSync = requestedDayKey || selectedDayKey;
      const syncedPlans = dayKeyToSync !== selectedDayKey
        ? data.filter((p) => String(p.dayKey || "").trim() === dayKeyToSync)
        : data;
      await syncSelectedDayPlans(syncedPlans);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Stable boot, runs once

  // Notification listener (runs once, cleanup on unmount)
  useEffect(() => {
    if (
      NOTIF_AVAILABLE &&
      typeof Notifications.addNotificationResponseReceivedListener ===
        "function"
    ) {
      const sub = Notifications.addNotificationResponseReceivedListener(
        async (resp) => {
          const action = resp.actionIdentifier;
          const content = resp.notification.request.content || {};
          const planId = content.data?.planId;
          if (!planId) return;
          if (action === ACTION_ACKNOWLEDGE) {
            Haptics.selectionAsync?.();
            return;
          }
          const minutes =
            action === ACTION_SNOOZE_5
              ? 5
              : action === ACTION_SNOOZE_15
                ? 15
                : action === ACTION_SNOOZE_30
                  ? 30
                  : 0;
          if (minutes > 0) {
            const snoozeDate = new Date(Date.now() + minutes * 60 * 1000);
            await schedulePlannerAlarm({
              id: `planner_${planId}_snooze_${Date.now()}`,
              title: content.title ?? "Planner Reminder",
              body: content.body ?? "",
              triggerDate: snoozeDate,
              repeat: "once",
              data: {
                type: PLANNER_NOTIFICATION_TYPE,
                planId,
                checkpoint: "snooze",
                acknowledgeRequired: true,
              },
              contentExtra: getPlannerNotificationContentExtra(),
            });
          }
        }
      );
      return () => sub?.remove?.();
    }
  }, []); // Listener setup once, no re-run on date/sync changes

  // Derived
  const selectedDayKey = toDateKey(selectedDate);

  const selectedDayPlans = useMemo(
    () =>
      plans
        .filter((p) => p.dayKey === selectedDayKey)
        .sort((a, b) => {
          const at = a.time ? new Date(a.time).getTime() : 0;
          const bt = b.time ? new Date(b.time).getTime() : 0;
          return at - bt;
        }),
    [plans, selectedDayKey]
  );

  useEffect(() => {
    const requestedDayKey = normalizeRouteParam(dayKeyParam);
    const requestedMonthKey = normalizeRouteParam(monthKeyParam);
    const requestedFocusPlanId = normalizeRouteParam(focusPlanId);

    if (requestedDayKey) {
      const parsedDate = parseDateKey(requestedDayKey);
      if (parsedDate) {
        setSelectedDate(parsedDate);
        setCurrentYear(parsedDate.getFullYear());
        setCurrentMonth(parsedDate.getMonth() + 1);
      }
    } else if (requestedMonthKey) {
      const parsedMonth = parseMonthKey(requestedMonthKey);
      if (parsedMonth) {
        const nextDate = new Date(parsedMonth.year, parsedMonth.month - 1, 1);
        setSelectedDate(nextDate);
        setCurrentYear(parsedMonth.year);
        setCurrentMonth(parsedMonth.month);
      }
    }

    if (requestedFocusPlanId) {
      setFocusedPlanId(requestedFocusPlanId);
    }
  }, [dayKeyParam, focusPlanId, monthKeyParam]);

  useEffect(() => {
    if (!focusedPlanId) return undefined;
    const timeoutId = setTimeout(() => setFocusedPlanId(""), 3500);
    return () => clearTimeout(timeoutId);
  }, [focusedPlanId]);

  const syncSelectedDayPlans = useCallback(
    async (
      planList,
      { signalSuccess = false, showAlertOnError = false } = {}
    ) => {
      const user = auth.currentUser;
      if (!user) return null;
      setSyncing(true);
      try {
        const dayPlans = (Array.isArray(planList) ? planList : []).filter(
          (plan) => String(plan?.dayKey || "").trim() === selectedDayKey
        );
        const result = await syncCalendarDayPlans(
          user.uid,
          selectedDate,
          selectedDayKey,
          dayPlans
        );
        setSyncSummary(result || { created: 0, updated: 0, archived: 0 });
        setLastSync(new Date().toISOString());
        if (signalSuccess) {
          Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
        }
        return result;
      } catch (err) {
        console.warn("Calendar planner task sync failed:", err);
        if (showAlertOnError) {
          Alert.alert(
            "Sync Failed",
            "Could not sync this day with Task Manager. Check connection and try again."
          );
        }
        return null;
      } finally {
        setSyncing(false);
      }
    },
    [selectedDate, selectedDayKey]
  );

  const schedulePlanNotification = useCallback(
    async (plan) => {
      if (!plan?.id) return;

      await cancelPlanNotifications(plan.id);
      if (!notifPermission || plan.notifEnabled === false) {
        return;
      }

      const planTime = plan.time ? new Date(plan.time) : null;
      if (!planTime || Number.isNaN(planTime.getTime())) {
        return;
      }

      const requests = buildPlannerNotificationRequests(plan, planTime);
      const alarmSoundUri =
        typeof notificationSettings?.taskAlarmSoundUri === "string"
          ? notificationSettings.taskAlarmSoundUri.trim()
          : "";
      const alarmSoundLabel =
        typeof notificationSettings?.taskAlarmSoundLabel === "string" &&
        notificationSettings.taskAlarmSoundLabel.trim()
          ? notificationSettings.taskAlarmSoundLabel.trim()
          : "App Alarm";
      await Promise.all(
        requests.map((request) =>
          schedulePlannerAlarm({
            ...request,
            data:
              canUseNativePlannerAlarm(request.repeat) && alarmSoundUri
                ? {
                    ...request.data,
                    alarmSoundUri,
                    alarmSoundLabel,
                  }
                : request.data,
          })
        )
      );
    },
    [notifPermission, notificationSettings]
  );

  const syncPlannerNotifications = useCallback(
    async (planList = []) => {
      if (!notifPermission || !Array.isArray(planList)) return;

      const normalizedPlans = planList.filter(Boolean);
      if (normalizedPlans.length === 0) return;

      await Promise.all(
        normalizedPlans.map((plan) => schedulePlanNotification(plan))
      );

      const uniqueDayKeys = Array.from(
        new Set(
          normalizedPlans
            .map((plan) => String(plan.dayKey || "").trim())
            .filter(Boolean)
        )
      );

      await Promise.all(
        uniqueDayKeys.map((dayKey) => {
          const date = parseDateKey(dayKey);
          if (!date) return Promise.resolve();
          return scheduleDailySummary(normalizedPlans, date);
        })
      );
    },
    [notifPermission, schedulePlanNotification]
  );

  useEffect(() => {
    if (!notifPermission || plans.length === 0) return;
    syncPlannerNotifications(plans).catch((err) => {
      console.warn("Planner notification sync failed:", err);
    });
  }, [notifPermission, plans, syncPlannerNotifications]);

  // Map: dayKey -> array of priority colors (for dots)
  const dotMap = useMemo(() => {
    const map = {};
    plans.forEach((p) => {
      if (!map[p.dayKey]) map[p.dayKey] = new Set();
      map[p.dayKey].add(p.priority ?? "normal");
    });
    return map;
  }, [plans]);

  // Calendar grid
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const calCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [daysInMonth, firstDay]);

  // Navigation
  function shiftMonth(dir) {
    let m = currentMonth + dir;
    let y = currentYear;
    if (m < 1) {
      m = 12;
      y--;
    }
    if (m > 12) {
      m = 1;
      y++;
    }
    setCurrentMonth(m);
    setCurrentYear(y);
  }

  function selectDay(day) {
    if (!day) return;
    Haptics.selectionAsync?.();
    setSelectedDate(new Date(currentYear, currentMonth - 1, day));
  }

  // Modal
  function openAddModal() {
    setEditingPlan(null);
    setFormTitle("");
    setFormNote("");
    setFormPriority("normal");
    const t = new Date();
    t.setHours(8, 0, 0, 0);
    setFormTime(t);
    setFormRepeat("once");
    setFormNotifEnabled(true);
    setShowTimePicker(false);
    setModalVisible(true);
  }

  function openEditModal(plan) {
    setEditingPlan(plan);
    setFormTitle(plan.title ?? "");
    setFormNote(plan.note ?? "");
    setFormPriority(plan.priority ?? "normal");
    setFormTime(
      plan.time
        ? new Date(plan.time)
        : (() => {
            const t = new Date();
            t.setHours(8, 0, 0, 0);
            return t;
          })()
    );
    setFormRepeat(plan.repeat ?? "once");
    setFormNotifEnabled(plan.notifEnabled !== false);
    setShowTimePicker(false);
    setModalVisible(true);
  }

  function closeModal() {
    if (saving) return;
    setShowTimePicker(false);
    setModalVisible(false);
    setEditingPlan(null);
  }

  async function savePlan() {
    if (!formTitle.trim()) {
      Alert.alert("Missing Title", "Please enter a plan title.");
      return;
    }
    setSaving(true);
    try {
      const planTime = new Date(selectedDate);
      planTime.setHours(formTime.getHours(), formTime.getMinutes(), 0, 0);

      const id =
        editingPlan?.id ??
        `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newPlan = {
        id,
        dayKey: selectedDayKey,
        title: formTitle.trim(),
        note: formNote.trim(),
        priority: formPriority,
        time: planTime.toISOString(),
        repeat: formRepeat,
        notifEnabled: formNotifEnabled,
        createdAt: editingPlan?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const next = editingPlan
        ? plans.map((p) => (p.id === editingPlan.id ? newPlan : p))
        : [...plans, newPlan];

      setPlans(next);
      await saveAllPlans(next);

      // Schedule notification
      await schedulePlanNotification(newPlan);
      if (notifPermission) {
        const summaryDate = parseDateKey(selectedDayKey) || selectedDate;
        await scheduleDailySummary(next, summaryDate);
      }
      await syncSelectedDayPlans(next);

      Haptics.notificationAsync?.(Haptics.NotificationFeedbackType?.Success);
      closeModal();
    } catch (err) {
      console.warn("CalendarPlanner savePlan error:", err);
      Alert.alert("Error", "Could not save plan. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(plan) {
    Alert.alert("Delete Plan", `Delete "${plan.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await cancelPlanNotifications(plan.id);
          const next = plans.filter((p) => p.id !== plan.id);
          setPlans(next);
          await saveAllPlans(next);
          await scheduleDailySummary(next, selectedDate);
          await syncSelectedDayPlans(next);
          Haptics.notificationAsync?.(
            Haptics.NotificationFeedbackType?.Warning
          );
        },
      },
    ]);
  }

  async function togglePlanNotif(plan) {
    const updated = { ...plan, notifEnabled: !plan.notifEnabled };
    const next = plans.map((p) => (p.id === plan.id ? updated : p));
    setPlans(next);
    await saveAllPlans(next);
    await schedulePlanNotification(updated);
    if (notifPermission) {
      const summaryDate = parseDateKey(updated.dayKey) || selectedDate;
      await scheduleDailySummary(next, summaryDate);
    }
    await syncSelectedDayPlans(next);
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const data = await loadAllPlans();
    setPlans(data);
    await syncSelectedDayPlans(data);
    setRefreshing(false);
  }, [syncSelectedDayPlans]);

  // Colors
  const cardBg = colors.card;
  const border = colors.border;
  const textPrimary = colors.text;
  const textMuted = colors.muted;
  const accent = colors.primary;
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not yet";
  const syncActivityCount =
    Number(syncSummary.created || 0) +
    Number(syncSummary.updated || 0) +
    Number(syncSummary.archived || 0);

  const isCurrentMonth =
    currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1;

  // ---
  // Render
  // ---
  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={accent} />

      {/* Header */}
      <View
        style={[
          s.hero,
          { backgroundColor: accent, paddingTop: insets.top + 16 },
        ]}
      >
        <View style={s.heroCircle} />
        <View style={s.heroCircle2} />
        <Text style={s.heroSub}>Your daily planner</Text>
        <Text style={s.heroTitle}>Calendar</Text>
        <View style={s.heroPills}>
          <View
            style={[s.heroPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}
          >
            <Ionicons name="calendar" size={11} color="#fff" />
            <Text style={s.heroPillText}>{plans.length} plans total</Text>
          </View>
          <View
            style={[s.heroPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}
          >
            <Ionicons name="today" size={11} color="#fff" />
            <Text style={s.heroPillText}>{selectedDayPlans.length} today</Text>
          </View>
          <TouchableOpacity
            style={[s.heroPill, { backgroundColor: "rgba(239,68,68,0.28)" }]}
            onPress={() => router.push("/(tabs)/ExamPrepPlanner")}
          >
            <Ionicons name="school-outline" size={11} color="#fff" />
            <Text style={s.heroPillText}>Exam Prep</Text>
          </TouchableOpacity>
          {!notifPermission && (
            <TouchableOpacity
              style={[s.heroPill, { backgroundColor: "rgba(239,68,68,0.35)" }]}
              onPress={() => requestNotifPermission().then(setNotifPermission)}
            >
              <Ionicons name="notifications-off" size={11} color="#fff" />
              <Text style={s.heroPillText}>Tap to enable notifs</Text>
            </TouchableOpacity>
          )}
          {auth.currentUser && (
            <TouchableOpacity
              style={[
                s.heroPill,
                syncing
                  ? { backgroundColor: "rgba(34,197,94,0.4)" }
                  : { backgroundColor: "rgba(59,130,246,0.3)" },
              ]}
              onPress={() =>
                syncSelectedDayPlans(plans, {
                  signalSuccess: true,
                  showAlertOnError: true,
                })
              }
              disabled={syncing}
            >
              <Ionicons
                name={syncing ? "checkmark-circle" : "cloud-upload-outline"}
                size={11}
                color="#fff"
              />
              <Text style={s.heroPillText}>
                {syncing ? "Syncing..." : "Sync Tasks"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={s.heroGuide}>
          <View style={s.heroGuideIcon}>
            <Ionicons name="sparkles-outline" size={16} color="#fff" />
          </View>
          <View style={s.heroGuideCopy}>
            <Text style={s.heroGuideTitle}>Plan one day at a time</Text>
            <Text style={s.heroGuideText}>
              Pick a date, add a plan, and sync it into Task Manager when you
              want it to show up in your main task list.
            </Text>
          </View>
        </View>
      </View>

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[accent]}
            tintColor={accent}
          />
        }
      >
        {/* Calendar card */}
        <View
          style={[s.calCard, { backgroundColor: cardBg, borderColor: border }]}
        >
          <View style={s.sectionIntro}>
            <Text style={[s.sectionIntroTitle, { color: textPrimary }]}>
              Choose a day
            </Text>
            <Text style={[s.sectionIntroText, { color: textMuted }]}>
              Tap any date to review the plan list. Dots show how busy that day
              is.
            </Text>
          </View>
          {/* Month nav */}
          <View style={s.monthNav}>
            <TouchableOpacity
              style={[s.navBtn, { borderColor: border }]}
              onPress={() => shiftMonth(-1)}
            >
              <Ionicons name="chevron-back" size={18} color={textPrimary} />
            </TouchableOpacity>
            <Text style={[s.monthLabel, { color: textPrimary }]}>
              {formatMonthLabel(currentYear, currentMonth)}
            </Text>
            <TouchableOpacity
              style={[s.navBtn, { borderColor: border }]}
              onPress={() => shiftMonth(1)}
            >
              <Ionicons name="chevron-forward" size={18} color={textPrimary} />
            </TouchableOpacity>
            {!isCurrentMonth && (
              <TouchableOpacity
                style={[s.todayBtn, { borderColor: accent }]}
                onPress={() => {
                  setCurrentYear(today.getFullYear());
                  setCurrentMonth(today.getMonth() + 1);
                  setSelectedDate(today);
                }}
              >
                <Text style={[s.todayBtnText, { color: accent }]}>Today</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Weekday header */}
          <View style={s.weekRow}>
            {WEEKDAY_LABELS.map((d) => (
              <Text key={d} style={[s.weekLabel, { color: textMuted }]}>
                {d}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={s.grid}>
            {calCells.map((day, idx) => {
              if (!day) return <View key={`empty-${idx}`} style={s.cell} />;
              const dk = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isToday = isCurrentMonth && day === today.getDate();
              const isSelected = dk === selectedDayKey;
              const dots = dotMap[dk] ? Array.from(dotMap[dk]) : [];

              return (
                <TouchableOpacity
                  key={dk}
                  style={[
                    s.cell,
                    isSelected && { backgroundColor: accent, borderRadius: 12 },
                    isToday &&
                      !isSelected && {
                        backgroundColor: accent + "22",
                        borderRadius: 12,
                      },
                  ]}
                  onPress={() => selectDay(day)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      s.dayNum,
                      {
                        color: isSelected
                          ? "#fff"
                          : isToday
                            ? accent
                            : textPrimary,
                      },
                      isSelected && { fontWeight: "900" },
                    ]}
                  >
                    {day}
                  </Text>
                  {dots.length > 0 && (
                    <View style={s.dotRow}>
                      {dots.slice(0, 3).map((pkey) => (
                        <View
                          key={pkey}
                          style={[
                            s.dot,
                            { backgroundColor: priorityMeta(pkey).color },
                          ]}
                        />
                      ))}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Legend */}
          <View style={s.legend}>
            {PRIORITIES.map((p) => (
              <View key={p.key} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: p.color }]} />
                <Text style={[s.legendText, { color: textMuted }]}>
                  {p.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Selected day section */}
        <View style={s.daySection}>
          <View style={s.daySectionHeader}>
            <View>
              <Text style={[s.daySectionTitle, { color: textPrimary }]}>
                {selectedDate.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
              <Text style={[s.daySectionSub, { color: textMuted }]}>
                {selectedDayPlans.length === 0
                  ? "No plans yet"
                  : `${selectedDayPlans.length} plan${selectedDayPlans.length > 1 ? "s" : ""}`}
              </Text>
              <Text style={[s.daySectionHelp, { color: textMuted }]}>
                Add time blocks, notes, and reminders for this day.
              </Text>
            </View>
            <TouchableOpacity
              style={[s.addBtn, { backgroundColor: accent }]}
              onPress={openAddModal}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={s.addBtnText}>Add Plan</Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              s.workflowCard,
              { backgroundColor: cardBg, borderColor: border },
            ]}
          >
            <View style={s.workflowTop}>
              <View
                style={[s.workflowIcon, { backgroundColor: `${accent}18` }]}
              >
                <Ionicons name="git-merge-outline" size={18} color={accent} />
              </View>
              <View style={s.workflowCopy}>
                <Text style={[s.workflowTitle, { color: textPrimary }]}>
                  Planner to Task workflow
                </Text>
                <Text style={[s.workflowBody, { color: textMuted }]}>
                  Every plan for this day syncs into Task Manager so you can
                  complete it from one task list.
                </Text>
              </View>
            </View>
            <View style={s.workflowMeta}>
              <View
                style={[
                  s.metaChip,
                  { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                ]}
              >
                <Ionicons
                  name="checkmark-done-circle-outline"
                  size={11}
                  color={textMuted}
                />
                <Text style={[s.metaChipText, { color: textMuted }]}>
                  {selectedDayPlans.length} linked task
                  {selectedDayPlans.length === 1 ? "" : "s"}
                </Text>
              </View>
              <View
                style={[
                  s.metaChip,
                  { backgroundColor: syncing ? "#dcfce7" : "#dbeafe" },
                ]}
              >
                <Ionicons
                  name={syncing ? "sync" : "cloud-done-outline"}
                  size={11}
                  color={syncing ? "#15803d" : "#1d4ed8"}
                />
                <Text
                  style={[
                    s.metaChipText,
                    { color: syncing ? "#15803d" : "#1d4ed8" },
                  ]}
                >
                  {syncing ? "Syncing now" : `Last sync ${lastSyncLabel}`}
                </Text>
              </View>
              {syncActivityCount > 0 && (
                <View
                  style={[
                    s.metaChip,
                    { backgroundColor: isDark ? "#0f172a" : "#eff6ff" },
                  ]}
                >
                  <Text style={[s.metaChipText, { color: textMuted }]}>
                    {syncSummary.created} new | {syncSummary.updated} updated |{" "}
                    {syncSummary.archived} archived
                  </Text>
                </View>
              )}
            </View>
            <View style={s.workflowActions}>
              <TouchableOpacity
                style={[s.workflowBtn, { borderColor: border }]}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/TaskManagerScreen",
                    params: { filter: "Planner" },
                  })
                }
              >
                <Ionicons
                  name="checkmark-done-circle-outline"
                  size={14}
                  color={textPrimary}
                />
                <Text style={[s.workflowBtnText, { color: textPrimary }]}>
                  Open Tasks
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.workflowBtn,
                  { backgroundColor: accent, borderColor: accent },
                ]}
                onPress={() =>
                  syncSelectedDayPlans(plans, {
                    signalSuccess: true,
                    showAlertOnError: true,
                  })
                }
                disabled={syncing}
              >
                <Ionicons
                  name={syncing ? "sync" : "cloud-upload-outline"}
                  size={14}
                  color="#fff"
                />
                <Text style={s.workflowBtnPrimaryText}>
                  {syncing ? "Syncing" : "Sync Now"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {selectedDayPlans.length === 0 ? (
            <View
              style={[
                s.emptyCard,
                { backgroundColor: cardBg, borderColor: border },
              ]}
            >
              <Ionicons name="calendar-outline" size={28} color={textMuted} />
              <Text style={[s.emptyTitle, { color: textPrimary }]}>
                No plans for this day
              </Text>
              <Text style={[s.emptySub, { color: textMuted }]}>
                Tap {`"`}Add Plan{`"`} to schedule something.
              </Text>
            </View>
          ) : (
            selectedDayPlans.map((plan) => {
              const pm = priorityMeta(plan.priority);
              const planTime = plan.time ? new Date(plan.time) : null;
              const isPast = planTime && planTime < new Date();
              const isFocused = focusedPlanId === plan.id;
              return (
                <View
                  key={plan.id}
                  style={[
                    s.planCard,
                    {
                      backgroundColor: cardBg,
                      borderColor: isFocused ? accent : border,
                      borderLeftColor: pm.color,
                    },
                    isFocused && s.planCardFocused,
                  ]}
                >
                  <View style={s.planTop}>
                    <View
                      style={[
                        s.planIconBox,
                        { backgroundColor: pm.color + "18" },
                      ]}
                    >
                      <Ionicons name={pm.icon} size={17} color={pm.color} />
                    </View>
                    <View style={s.planContent}>
                      <Text
                        style={[s.planTitle, { color: textPrimary }]}
                        numberOfLines={2}
                      >
                        {plan.title}
                      </Text>
                      {plan.note ? (
                        <Text
                          style={[s.planNote, { color: textMuted }]}
                          numberOfLines={2}
                        >
                          {plan.note}
                        </Text>
                      ) : null}
                    </View>
                    <View style={s.planActions}>
                      <TouchableOpacity
                        style={[
                          s.planActionBtn,
                          {
                            borderColor: border,
                            backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                          },
                        ]}
                        onPress={() => openEditModal(plan)}
                      >
                        <Ionicons
                          name="create-outline"
                          size={13}
                          color={textPrimary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          s.planActionBtn,
                          {
                            borderColor: "#fecaca",
                            backgroundColor: isDark ? "#3f1d1d" : "#fff1f2",
                          },
                        ]}
                        onPress={() => deletePlan(plan)}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={13}
                          color="#ef4444"
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={s.planMeta}>
                    {planTime && (
                      <View
                        style={[
                          s.metaChip,
                          {
                            backgroundColor: isPast
                              ? "#fee2e2"
                              : isDark
                                ? "#1e293b"
                                : "#f1f5f9",
                          },
                        ]}
                      >
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color={isPast ? "#ef4444" : textMuted}
                        />
                        <Text
                          style={[
                            s.metaChipText,
                            { color: isPast ? "#ef4444" : textMuted },
                          ]}
                        >
                          {formatTime12(planTime)}
                          {isPast ? " - Past" : ""}
                        </Text>
                      </View>
                    )}
                    <View
                      style={[s.metaChip, { backgroundColor: pm.color + "18" }]}
                    >
                      <Text style={[s.metaChipText, { color: pm.color }]}>
                        {pm.label}
                      </Text>
                    </View>
                    {plan.repeat !== "once" && (
                      <View
                        style={[
                          s.metaChip,
                          { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                        ]}
                      >
                        <Ionicons name="repeat" size={11} color={textMuted} />
                        <Text style={[s.metaChipText, { color: textMuted }]}>
                          {plan.repeat === "daily" ? "Daily" : "Weekly"}
                        </Text>
                      </View>
                    )}
                    {isFocused && (
                      <View
                        style={[s.metaChip, { backgroundColor: `${accent}18` }]}
                      >
                        <Ionicons
                          name="arrow-undo-outline"
                          size={11}
                          color={accent}
                        />
                        <Text style={[s.metaChipText, { color: accent }]}>
                          Opened from Tasks
                        </Text>
                      </View>
                    )}
                    {/* Notif toggle */}
                    <TouchableOpacity
                      style={[
                        s.metaChip,
                        {
                          backgroundColor: plan.notifEnabled
                            ? isDark
                              ? "#082f49"
                              : "#e0f2fe"
                            : isDark
                              ? "#1e293b"
                              : "#f1f5f9",
                        },
                      ]}
                      onPress={() => togglePlanNotif(plan)}
                    >
                      <Ionicons
                        name={
                          plan.notifEnabled
                            ? "notifications"
                            : "notifications-off-outline"
                        }
                        size={11}
                        color={
                          plan.notifEnabled
                            ? isDark
                              ? "#7dd3fc"
                              : "#0369a1"
                            : textMuted
                        }
                      />
                      <Text
                        style={[
                          s.metaChipText,
                          {
                            color: plan.notifEnabled
                              ? isDark
                                ? "#bae6fd"
                                : "#0369a1"
                              : textMuted,
                          },
                        ]}
                      >
                        {plan.notifEnabled ? "Notif on" : "Notif off"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 32 }} />
      </Animated.ScrollView>

      {/* Add / Edit Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={s.overlay}>
          <View
            style={[
              s.modalCard,
              { backgroundColor: cardBg, borderColor: border },
            ]}
          >
            {/* Modal header */}
            <View style={s.modalHeader}>
              <View
                style={[s.modalHeaderIcon, { backgroundColor: accent + "18" }]}
              >
                <Ionicons
                  name={editingPlan ? "create-outline" : "add-circle-outline"}
                  size={20}
                  color={accent}
                />
              </View>
              <View style={s.workflowCopy}>
                <Text style={[s.modalTitle, { color: textPrimary }]}>
                  {editingPlan ? "Edit Plan" : "Add Plan"}
                </Text>
                <Text style={[s.modalSub, { color: textMuted }]}>
                  {selectedDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Text>
              </View>
              <TouchableOpacity
                style={[s.closeBtn, { borderColor: border }]}
                onPress={closeModal}
                disabled={saving}
              >
                <Ionicons name="close" size={17} color={textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Title */}
              <Text style={[s.fieldLabel, { color: textMuted }]}>Title *</Text>
              <TextInput
                style={[
                  s.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: formTitle ? accent : border,
                    color: textPrimary,
                  },
                ]}
                placeholder="e.g. Study for Finals"
                placeholderTextColor={textMuted}
                value={formTitle}
                onChangeText={setFormTitle}
                returnKeyType="next"
                editable={!saving}
              />

              {/* Note */}
              <Text style={[s.fieldLabel, { color: textMuted }]}>
                Notes (optional)
              </Text>
              <TextInput
                style={[
                  s.input,
                  s.inputMulti,
                  {
                    backgroundColor: colors.background,
                    borderColor: border,
                    color: textPrimary,
                  },
                ]}
                placeholder="Add a short note..."
                placeholderTextColor={textMuted}
                value={formNote}
                onChangeText={setFormNote}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
                editable={!saving}
              />

              {/* Priority */}
              <Text style={[s.fieldLabel, { color: textMuted }]}>Priority</Text>
              <View style={s.priorityRow}>
                {PRIORITIES.map((p) => {
                  const active = formPriority === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[
                        s.priorityChip,
                        {
                          borderColor: active ? p.color : border,
                          backgroundColor: active ? p.color : "transparent",
                        },
                      ]}
                      onPress={() => setFormPriority(p.key)}
                      disabled={saving}
                    >
                      <Ionicons
                        name={p.icon}
                        size={14}
                        color={active ? "#fff" : p.color}
                      />
                      <Text
                        style={[
                          s.priorityChipText,
                          { color: active ? "#fff" : textPrimary },
                        ]}
                      >
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Time */}
              <Text style={[s.fieldLabel, { color: textMuted }]}>Time</Text>
              <TouchableOpacity
                style={[
                  s.timeBtn,
                  { borderColor: border, backgroundColor: colors.background },
                ]}
                onPress={() => setShowTimePicker((v) => !v)}
                disabled={saving}
              >
                <Ionicons name="time-outline" size={17} color={accent} />
                <Text style={[s.timeBtnText, { color: textPrimary }]}>
                  {formatTime12(formTime)}
                </Text>
                <View style={[s.editChip, { backgroundColor: accent + "18" }]}>
                  <Ionicons name="pencil" size={11} color={accent} />
                  <Text style={[s.editChipText, { color: accent }]}>Edit</Text>
                </View>
              </TouchableOpacity>

              {showTimePicker && (
                <DateTimePicker
                  value={formTime}
                  mode="time"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(event, selected) => {
                    if (Platform.OS !== "ios") setShowTimePicker(false);
                    if (event?.type === "dismissed") {
                      setShowTimePicker(false);
                      return;
                    }
                    if (selected) setFormTime(selected);
                  }}
                />
              )}

              {/* Repeat */}
              <Text style={[s.fieldLabel, { color: textMuted }]}>Repeat</Text>
              <View style={s.repeatRow}>
                {REPEAT_OPTIONS.map((r) => {
                  const active = formRepeat === r.key;
                  return (
                    <TouchableOpacity
                      key={r.key}
                      style={[
                        s.repeatChip,
                        {
                          borderColor: active ? accent : border,
                          backgroundColor: active ? accent : "transparent",
                        },
                      ]}
                      onPress={() => setFormRepeat(r.key)}
                      disabled={saving}
                    >
                      <Text
                        style={[
                          s.repeatChipText,
                          { color: active ? "#fff" : textPrimary },
                        ]}
                      >
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Notification toggle */}
              <View style={[s.notifRow, { borderColor: border }]}>
                <Ionicons
                  name="notifications-outline"
                  size={18}
                  color={accent}
                />
                <View style={s.workflowCopy}>
                  <Text style={[s.notifLabel, { color: textPrimary }]}>
                    Notification
                  </Text>
                  <Text style={[s.notifSub, { color: textMuted }]}>
                    {notifPermission
                      ? formNotifEnabled
                        ? `Will remind at ${formatTime12(formTime)}`
                        : "Notification disabled for this plan"
                      : "Enable notifications in settings"}
                  </Text>
                </View>
                <Switch
                  value={formNotifEnabled && notifPermission}
                  onValueChange={(v) => {
                    if (!notifPermission) {
                      requestNotifPermission().then(setNotifPermission);
                      return;
                    }
                    setFormNotifEnabled(v);
                  }}
                  trackColor={{ false: border, true: accent + "66" }}
                  thumbColor={
                    formNotifEnabled && notifPermission
                      ? accent
                      : isDark
                        ? "#475569"
                        : "#cbd5e1"
                  }
                  disabled={saving}
                />
              </View>

              {/* Actions */}
              <View style={s.modalActions}>
                <TouchableOpacity
                  style={[s.cancelBtn, { borderColor: border }]}
                  onPress={closeModal}
                  disabled={saving}
                >
                  <Text style={[s.cancelBtnText, { color: textMuted }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.saveBtn,
                    { backgroundColor: accent, opacity: saving ? 0.65 : 1 },
                  ]}
                  onPress={savePlan}
                  disabled={saving}
                >
                  <Ionicons
                    name={
                      saving ? "hourglass-outline" : "checkmark-circle-outline"
                    }
                    size={17}
                    color="#fff"
                  />
                  <Text style={s.saveBtnText}>
                    {saving
                      ? "Saving..."
                      : editingPlan
                        ? "Save Changes"
                        : "Add Plan"}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---
// Styles
// ---
const s = StyleSheet.create({
  root: { flex: 1 },

  // Hero
  hero: {
    paddingBottom: 22,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
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
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
  },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  heroGuide: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.18)",
  },
  heroGuideIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  heroGuideCopy: { flex: 1, minWidth: 0 },
  heroGuideTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 2,
  },
  heroGuideText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
  },

  scroll: { paddingHorizontal: 16, paddingTop: 14 },

  // Calendar card
  calCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
  },
  sectionIntro: { marginBottom: 12 },
  sectionIntroTitle: { fontSize: 14, fontWeight: "800", marginBottom: 3 },
  sectionIntroText: { fontSize: 12, fontWeight: "600", lineHeight: 18 },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 8,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  monthLabel: { flex: 1, fontSize: 15, fontWeight: "800", textAlign: "center" },
  todayBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  todayBtnText: { fontSize: 11, fontWeight: "700" },

  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingVertical: 4,
  },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  dayNum: { fontSize: 13, fontWeight: "600" },
  dotRow: { flexDirection: "row", gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },

  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet?.hairlineWidth ?? 1,
    borderTopColor: "rgba(148,163,184,0.3)",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: "600" },

  // Day section
  daySection: { marginBottom: 8 },
  daySectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  daySectionTitle: { fontSize: 14, fontWeight: "800" },
  daySectionSub: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  daySectionHelp: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 4,
    lineHeight: 16,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 11,
  },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  workflowCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  workflowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  workflowCopy: { flex: 1, minWidth: 0 },
  workflowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  workflowTitle: { fontSize: 13, fontWeight: "800", marginBottom: 3 },
  workflowBody: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  workflowMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  workflowActions: {
    flexDirection: "column",
    gap: 8,
    marginTop: 12,
  },
  workflowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  workflowBtnText: { fontSize: 12, fontWeight: "700" },
  workflowBtnPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "800" },

  // Empty
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: { fontSize: 14, fontWeight: "700" },
  emptySub: { fontSize: 12, textAlign: "center", lineHeight: 18 },

  // Plan card
  planCard: {
    borderRadius: 15,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  planCardFocused: {
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  planTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 8,
  },
  planIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planContent: { flex: 1, minWidth: 0 },
  planTitle: { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  planNote: { fontSize: 12, fontWeight: "500", lineHeight: 17 },
  planActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  planActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  planMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metaChipText: { fontSize: 10, fontWeight: "700" },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    maxHeight: "92%",
    width: "100%",
    maxWidth: 440,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  modalHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalSub: { fontSize: 12, marginTop: 1 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 7,
    marginTop: 14,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 11,
    padding: 12,
    fontSize: 14,
    fontWeight: "500",
  },
  inputMulti: { minHeight: 68, textAlignVertical: "top" },

  priorityRow: { flexDirection: "row", gap: 8 },
  priorityChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 10,
  },
  priorityChipText: { fontSize: 12, fontWeight: "700" },

  timeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 11,
    padding: 12,
  },
  timeBtnText: { flex: 1, fontSize: 14, fontWeight: "600" },
  editChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  editChipText: { fontSize: 11, fontWeight: "700" },

  repeatRow: { flexDirection: "row", gap: 8 },
  repeatChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderWidth: 1.5,
    borderRadius: 11,
  },
  repeatChipText: { fontSize: 12, fontWeight: "700" },

  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  notifLabel: { fontSize: 13, fontWeight: "700" },
  notifSub: { fontSize: 11, marginTop: 2 },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 11,
    alignItems: "center",
  },
  cancelBtnText: { fontSize: 13, fontWeight: "700" },
  saveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 11,
    paddingVertical: 11,
  },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});



