// CalendarPlannerScreen.helpers.js
// Pure helper functions (date, notif, storage) - no React/state

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// Existing utils (already shared)
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
import { isNativeAlarmSupported } from "../../utils/nativeAlarm";

// Constants (moved from main)
export const PRIORITIES = [
  { key: "urgent", label: "Urgent", color: "#ef4444", icon: "alert-circle" },
  { key: "normal", label: "Normal", color: "#3b82f6", icon: "time" },
  { key: "low", label: "Low", color: "#22c55e", icon: "leaf" },
];

export const REPEAT_OPTIONS = [
  { key: "once", label: "Once" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const STORAGE_KEY = "cal_planner_plans_v2";

export const PLANNER_NOTIFICATION_TYPE = "planner_deadline";
export const ACK_CATEGORY = "cal_plan_ack";
export const ACTION_ACKNOWLEDGE = "acknowledge_plan";
export const ACTION_SNOOZE_5 = "snooze_5";
export const ACTION_SNOOZE_15 = "snooze_15";
export const ACTION_SNOOZE_30 = "snooze_30";

export const PLANNER_ONCE_LEAD_MINUTES = [4320, 1440, 360, 120, 30];
export const PLANNER_DAILY_LEAD_MINUTES = [360, 120, 30];
export const ANDROID_CHANNEL = "cal-planner-v1";

export {
  formatMonthLabel, formatTime12, getDaysInMonth,
  getFirstDayOfMonth, parseDateKey,
  parseMonthKey, toDateKey
};

export function priorityMeta(key) {
  return PRIORITIES.find((p) => p.key === key) ?? PRIORITIES[1];
}

// --- Storage ---
export async function loadAllPlans() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function saveAllPlans(plans) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

// --- Notification helpers ---
export function formatPlannerLeadTitle(minutesBefore) {
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

export function getPlannerLeadMinutes(repeat = "once") {
  return repeat === "daily"
    ? PLANNER_DAILY_LEAD_MINUTES
    : PLANNER_ONCE_LEAD_MINUTES;
}

export function getPlannerNotificationContentExtra() {
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

export function canUseNativePlannerAlarm(repeat = "once") {
  return (
    Platform.OS === "android" && isNativeAlarmSupported && repeat === "once"
  );
}

export function buildPlannerOccurrenceLabel(planTime, repeat = "once") {
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

export function buildPlannerLeadBody(plan, planTime, triggerDate) {
  const title = plan?.title || "Planner item";
  const repeat = plan?.repeat ?? "once";
  const countdown = formatDeadlineCountdown(planTime, triggerDate, {
    style: "long",
  }).replace(/\s+left$/, "");
  const occurrenceLabel = buildPlannerOccurrenceLabel(planTime, repeat);
  return `"${title}" starts in ${countdown} (${occurrenceLabel}). Open Planner when you are ready to act.`;
}

export function buildPlannerDueBody(plan, planTime) {
  const title = plan?.title || "Planner item";
  const occurrenceLabel = buildPlannerOccurrenceLabel(
    planTime,
    plan?.repeat ?? "once"
  );
  return `"${title}" starts now (${occurrenceLabel}). Open Planner and acknowledge it.`;
}

export function buildPlannerNotificationRequests(plan, planTime) {
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
      weekday: planTime.getDay(),
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

// --- End helpers ---


