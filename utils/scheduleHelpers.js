// utils/scheduleHelpers.js
// Core time-parsing utilities. No imports from this same folder.

/**
 * Parses a time string into total minutes from midnight.
 * Handles: "8:00 AM", "13:30", "8:30am", bare hours, and ISO datetimes.
 * Returns null if unparseable.
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const str = timeStr.trim();

  // Match ISO datetime string like "2026-03-31T08:30:00.000Z"
  // Extract hour/minute from the string directly so local TZ doesn't shift the time
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const hour = parseInt(isoMatch[4], 10);
    const minute = parseInt(isoMatch[5], 10);
    if (isNaN(hour) || isNaN(minute)) return null;
    return hour * 60 + minute;
  }

  // Match "8:30 AM", "12:00 PM", "8:30am", etc.
  const meridiem = str.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (meridiem) {
    let hours = parseInt(meridiem[1], 10);
    const mins = parseInt(meridiem[2], 10);
    const period = meridiem[3].toLowerCase();
    if (period === "am" && hours === 12) hours = 0;
    if (period === "pm" && hours !== 12) hours += 12;
    return hours * 60 + mins;
  }

  // Match 24-hour "13:30" or "08:00"
  const h24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const hours = parseInt(h24[1], 10);
    const mins  = parseInt(h24[2], 10);
    if (hours < 24 && mins < 60) return hours * 60 + mins;
  }

  // Match bare hour like "9" or "14"
  const bare = str.match(/^(\d{1,2})$/);
  if (bare) {
    const hours = parseInt(bare[1], 10);
    if (hours < 24) return hours * 60;
  }

  return null;
}

/**
 * Converts total minutes from midnight into a readable label like "8:00 AM".
 */
export function toTimeLabel(minutes) {
  if (minutes === null || isNaN(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const padded  = String(m).padStart(2, "0");
  return `${hour12}:${padded} ${period}`;
}

/**
 * Given a class object with `start`/`end` (or `startTime`/`endTime`) fields,
 * returns { start, end, duration } in minutes, or null if start is not parseable.
 */
export function getClassRangeMinutes(cls) {
  if (!cls) return null;

  const start = parseTimeToMinutes(cls.startTime ?? cls.start);
  const end   = parseTimeToMinutes(cls.endTime   ?? cls.end);

  if (start === null) return null;
  return {
    start,
    end:   end !== null ? end : null,
    duration: end !== null ? end - start : null,
  };
}