// app/(tabs)/schedule.helpers.js
// Pure helper functions for schedule.js - no React/state

import {
  getClassRangeMinutes,
  parseTimeToMinutes,
  toTimeLabel
} from "../../utils/scheduleHelpers";
import {
  getSubjectColor as getSharedSubjectColor,
  hashString,
  normalizeSubjectKey,
  toRgba,
} from "../../utils/colorUtils";
export { weekMonthLabel, weekRangeLabel } from "@/utils/dateHelpers";

export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const DAY_COLORS = {
  Monday: "#6366f1",
  Tuesday: "#0ea5e9",
  Wednesday: "#10b981",
  Thursday: "#f59e0b",
  Friday: "#ef4444",
  Saturday: "#8b5cf6",
};

export const DAY_TINTS = {
  Monday:    "rgba(99,102,241,0.07)",
  Tuesday:   "rgba(14,165,233,0.07)",
  Wednesday: "rgba(16,185,129,0.07)",
  Thursday:  "rgba(245,158,11,0.07)",
  Friday:    "rgba(239,68,68,0.07)",
  Saturday:  "rgba(139,92,246,0.07)",
};

export const DAY_TINTS_TODAY = {
  Monday:    "rgba(99,102,241,0.18)",
  Tuesday:   "rgba(14,165,233,0.18)",
  Wednesday: "rgba(16,185,129,0.18)",
  Thursday:  "rgba(245,158,11,0.18)",
  Friday:    "rgba(239,68,68,0.18)",
  Saturday:  "rgba(139,92,246,0.18)",
};

export const SUBJECT_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

export const LUNCH_SLOT = {
  key: "slot:720-780",
  label: "12:00 PM - 1:00 PM",
  sortOrder: 720,
  isLunch: true,
};

export const TIME_COLUMN_WIDTH = 130;
export const DAY_COLUMN_WIDTH = 133;
export const TABLE_SCROLL_PADDING = 24;

export function getTodayName() {
  return new Date().toLocaleString("en-US", { weekday: "long" });
}

export function getCurrentWeekDates(reference = new Date()) {
  const today = new Date(reference);
  const dayIndex = today.getDay();
  const diffToMonday = dayIndex === 0 ? -6 : 1 - dayIndex;

  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() + diffToMonday);

  return DAYS.map((_, idx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + idx);
    return date;
  });
}

export { hashString, normalizeSubjectKey, toRgba };

export function getSubjectColor(subject, fallback) {
  const key = normalizeSubjectKey(subject);
  if (!key) return fallback;
  return getSharedSubjectColor(key, SUBJECT_COLORS) ?? fallback;
}

export function getClassSlotMeta(cls, fallbackOrder) {
  let start = parseTimeToMinutes(cls?.start);
  let end = parseTimeToMinutes(cls?.end);

  const display = String(cls?.timeDisplay || "").trim();
  if (display.includes("-")) {
    const [left, right] = display.split("-").map((part) => part.trim());
    if (start === null) start = parseTimeToMinutes(left);
    if (end === null) end = parseTimeToMinutes(right);
  }

  if (start !== null) {
    if (end === null || end <= start) end = start + 60;
    return {
      key: `slot:${start}-${end}`,
      label: `${toTimeLabel(start)} - ${toTimeLabel(end)}`,
      sortOrder: start,
    };
  }

  if (display) {
    return {
      key: `label:${display.toLowerCase()}`,
      label: display,
      sortOrder: 10000 + fallbackOrder,
    };
  }

  return {
    key: `unknown:${fallbackOrder}`,
    label: "Time TBD",
    sortOrder: 20000 + fallbackOrder,
  };
}

export function formatClassTime(cls) {
  const display = String(cls?.timeDisplay || "").trim();
  if (display) return display;
  const range = getClassRangeMinutes(cls);
  if (!range) return "Time TBD";
  return `${toTimeLabel(range.start)} - ${toTimeLabel(range.end)}`;
}

export function sortClassesByStart(classes) {
  return [...classes].sort((a, b) => {
    const aSlot = getClassSlotMeta(a, 0);
    const bSlot = getClassSlotMeta(b, 0);
    return aSlot.sortOrder - bSlot.sortOrder;
  });
}

export function getSlotRangeFromKey(slotKey) {
  if (!slotKey || !slotKey.startsWith("slot:")) return null;
  const parts = slotKey
    .slice(5)
    .split("-")
    .map((v) => Number(v));
  if (parts.length !== 2 || parts.some((v) => Number.isNaN(v))) return null;
  const [start, end] = parts;
  if (end <= start) return null;
  return { start, end };
}

export function buildTimetableMatrix(weekItems) {
  const slotMap = new Map();
  const matrix = DAYS.reduce((acc, day) => ({ ...acc, [day]: {} }), {});

  weekItems.forEach((item, dayIndex) => {
    item.classes.forEach((cls, classIndex) => {
      const fallbackOrder = dayIndex * 100 + classIndex;
      const slot = getClassSlotMeta(cls, fallbackOrder);
      if (!slotMap.has(slot.key)) slotMap.set(slot.key, slot);
      if (!matrix[item.day][slot.key]) matrix[item.day][slot.key] = [];
      matrix[item.day][slot.key].push(cls);
    });
  });

  if (!slotMap.has(LUNCH_SLOT.key)) slotMap.set(LUNCH_SLOT.key, LUNCH_SLOT);

  const slots = [...slotMap.values()].sort((a, b) => {
    if (a.sortOrder === b.sortOrder) return a.label.localeCompare(b.label);
    return a.sortOrder - b.sortOrder;
  });

  return { slots, matrix };
}

export function getTodayStatus(weekItems, nowMinutes) {
  const todayItem = weekItems.find((item) => item.isToday);
  if (!todayItem) return { current: null, next: null, done: true };
  const classes = todayItem.classes
    .map((cls) => {
      const range = getClassRangeMinutes(cls);
      return range ? { cls, range } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.range.start - b.range.start);

  let current = null;
  let next = null;
  for (const item of classes) {
    if (nowMinutes >= item.range.start && nowMinutes < item.range.end) {
      current = item;
    } else if (item.range.start > nowMinutes && !next) {
      next = item;
    }
  }

  return {
    current,
    next,
    done: !current && !next,
  };
}

// Removed scheduleMetaKey - moved to schedule.js (uses OfflineContext)
// export const scheduleMetaKey = (uid) => `${CACHE_KEYS.schedule(uid)}_meta`;



