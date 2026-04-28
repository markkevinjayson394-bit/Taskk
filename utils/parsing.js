export function safeParseObject(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
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

export function clampText(text, maxLength = 100) {
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "�" : text;
}

// Schedule-specific pure helpers (moved from scheduleHelpers.js)
export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeYear(year) {
  if (year === null || year === undefined || year === "") return "";
  const n = Number(year);
  return Number.isFinite(n) ? String(n) : String(year).trim();
}

export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;

  // Handle ISO date strings like "2026-03-31T08:00:00.000Z"
  // Extract UTC components directly so local timezone doesn't shift the time
  // (consistent with adminSchedule.js which uses getHours/getMinutes = local time)
  const isoMatch = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    const [, , , hourStr, minuteStr] = isoMatch;
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    if (isNaN(hour) || isNaN(minute)) return null;
    // Validate month/day so "2026-03-31T25:00:00Z" isn't accepted
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
