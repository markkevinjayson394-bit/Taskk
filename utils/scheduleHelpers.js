// utils/scheduleHelpers.js
// Core time-parsing utilities. No imports from this same folder.

/**
 * Parses a time string into total minutes from midnight.
 * Handles: "8:00 AM", "13:30", "8:30am", bare hours, and ISO datetimes.
 * Returns null if unparseable.
 */
export function parseTimeToMinutes(str) {
  if (!str) return null;
  // HH:MM
  const simple = str.match(/^(\d{2}):(\d{2})$/);
  if (simple) return parseInt(simple[1]) * 60 + parseInt(simple[2]);
  // ISO string
  const iso = str.match(/T(\d{2}):(\d{2}):/);
  if (iso) return parseInt(iso[1]) * 60 + parseInt(iso[2]);
  return null;
}

export function normalizeText(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim();
}

export function normalizeYear(year) {
  if (year === null || year === undefined || year === "") return "";
  // Strip leading non-numeric prefix like "Year " from "Year 1"
  const stripped = String(year).replace(/^[^0-9]+/, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? String(n) : String(year).trim();
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
  const padded = String(m).padStart(2, "0");
  return `${hour12}:${padded} ${period}`;
}

/**
 * Given a class object with `start`/`end` (or `startTime`/`endTime`) fields,
 * returns { start, end, duration } in minutes, or null if start is not parseable.
 */
export function getClassRangeMinutes(cls) {
  if (!cls) return null;

  const start = parseTimeToMinutes(cls.startTime ?? cls.start);
  const end = parseTimeToMinutes(cls.endTime ?? cls.end);

  if (start === null) return null;
  return { start, end, duration: end !== null ? end - start : null };
}
