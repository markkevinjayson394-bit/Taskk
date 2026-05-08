// NOTE: Add scheduleWeek: (uid) => `cache_schedule_week_${uid}` to CACHE_KEYS in OfflineContext
// home.helpers.js
// Pure helper functions for Home dashboard - no React/state
// Constants
import { parseDueDate, resolveTaskDueDate } from "../../utils/academicTaskModel";
import {
  daysUntil,
  getGreeting,
  getTodayString,
} from "@/utils/dateHelpers";
export const PRIORITY_COLOR = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};
export const FOCUS_REFRESH_COOLDOWN_MS = 15 * 1000;
// Parsing
export { daysUntil, getGreeting, getTodayString, parseDueDate, resolveTaskDueDate };
export function safeParseObject(raw, fallback = {}) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
// Academic labeling
export function buildAcademicLabel({
  course,
  year,
  section,
  semester,
  academicYear,
}) {
  const parts = [];
  if (course) parts.push(course);
  if (year || section) {
    parts.push(
      [year ? `Year ${year}` : null, section ? `Sec ${section}` : null]
        .filter(Boolean)
        .join(" · ")
    );
  }
  if (semester) parts.push(semester);
  if (academicYear) parts.push(academicYear);
  return parts.join(" · ");
}

