// parsing.js — Fixed

/**
 * Safely parses a JSON string into an object.
 * Returns `fallback` (default null) on empty input or parse failure.
 *
 * FIX: Added `fallback` parameter so callers like safeParseObject(raw, {})
 * in home.js get the right default instead of always receiving null.
 */
export function safeParseObject(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function safeParseExamPlans(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("Failed to parse exam plans:", err);
    return {};
  }
}

/**
 * Clamps text to a maximum length, appending an ellipsis if truncated.
 *
 * FIX: Original code had `+"…"` as a floating no-op expression with no
 * return statement, so every non-empty string silently returned `undefined`.
 * This caused buildDayPlannerRef, buildCalendarPlanTasks, and any other
 * caller to receive undefined values without any runtime error.
 */
export function clampText(text, maxLength = 100) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

// ─── Schedule-specific pure helpers ──────────────────────────────────────────

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeYear(year) {
  if (year === null || year === undefined || year === "") return "";
  // Strip leading non-numeric prefix like "Year " from "Year 1"
  const stripped = String(year).replace(/^[^0-9]+/, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? String(n) : String(year).trim();
}

export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;

  // Handle ISO date strings like "2026-03-31T08:00:00.000Z"
  // Extract UTC components directly so local timezone doesn't shift the time
  const isoMatch = timeStr.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
  );
  if (isoMatch) {
    const [, , , , hourStr, minuteStr] = isoMatch;
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    if (isNaN(hour) || isNaN(minute)) return null;
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return hour * 60 + minute;
  }

  // Handle "HH:MM" format
  const [hourStr, minuteStr] = timeStr.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  return hour * 60 + minute;
}

export function toTimeLabel(minutes) {
  if (typeof minutes !== "number") return "";
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function getClassRangeMinutes(cls) {
  const start = parseTimeToMinutes(cls?.startTime ?? cls?.start);
  const end = parseTimeToMinutes(cls?.endTime ?? cls?.end);
  if (start === null) return null;
  return { start, end, duration: end !== null ? end - start : null };
}
