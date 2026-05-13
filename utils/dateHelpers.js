// utils/dateHelpers.js

function toValidDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value);
  }
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? null : next;
}

/**
 * Returns midnight (00:00:00) of the given date in local time.
 */
export function startOfLocalDay(date = new Date()) {
  const base = toValidDate(date) ?? new Date();
  const next = new Date(base);
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * Returns the last millisecond of the given local calendar day.
 */
export function endOfLocalDay(date = new Date()) {
  const base = toValidDate(date) ?? new Date();
  const next = new Date(base);
  next.setHours(23, 59, 59, 999);
  return next;
}

/**
 * Returns true if two dates fall on the same local calendar day.
 */
export function isSameLocalDay(a, b) {
  const left = toValidDate(a);
  const right = toValidDate(b);
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * Returns the number of whole days between two dates in local time.
 * Positive if b is after a.
 */
export function localDaysBetween(from, to) {
  const fromDate = startOfLocalDay(toValidDate(from));
  const toDate = startOfLocalDay(toValidDate(to));
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((toDate - fromDate) / msPerDay);
}

/**
 * Formats a date as YYYY-MM-DD in local time.
 * Use this for stored planner/task day keys.
 */
export function toDateKey(date = new Date()) {
  const value = toValidDate(date);
  if (!value) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalDayKey(date = new Date()) {
  return toDateKey(date);
}

export function parseDateKey(key) {
  const raw = String(key || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/**
 * Month helpers use one-based month numbers: 1=January ... 12=December.
 */
export function parseMonthKey(key) {
  const raw = String(key || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

export function getDaysInMonth(year, month) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (
    Number.isNaN(parsedYear) ||
    Number.isNaN(parsedMonth) ||
    parsedMonth < 1 ||
    parsedMonth > 12
  ) {
    return null;
  }
  return new Date(parsedYear, parsedMonth, 0).getDate();
}

export function getFirstDayOfMonth(year, month) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (
    Number.isNaN(parsedYear) ||
    Number.isNaN(parsedMonth) ||
    parsedMonth < 1 ||
    parsedMonth > 12
  ) {
    return null;
  }
  return new Date(parsedYear, parsedMonth - 1, 1).getDay();
}

export function formatTime12(date) {
  const value = toValidDate(date);
  if (!value) return "";
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatMonthLabel(year, month) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (
    Number.isNaN(parsedYear) ||
    Number.isNaN(parsedMonth) ||
    parsedMonth < 1 ||
    parsedMonth > 12
  ) {
    return "";
  }
  return new Date(parsedYear, parsedMonth - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function weekRangeLabel(startDate, endDate) {
  const start = toValidDate(startDate);
  const end = toValidDate(endDate);
  if (!start || !end) return "";
  const format = (value) =>
    value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${format(start)} - ${format(end)}`;
}

export function weekMonthLabel(date) {
  const value = toValidDate(date);
  if (!value) return "";
  return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function daysUntil(dateStr) {
  const due = toValidDate(dateStr);
  if (!due) return Number.NaN;
  return Math.ceil(
    (startOfLocalDay(due) - startOfLocalDay(new Date())) / 86400000
  );
}

export function getTodayString(date = new Date()) {
  const value = toValidDate(date) ?? new Date();
  return value.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function getGreeting(date = new Date()) {
  const value = toValidDate(date) ?? new Date();
  const hour = value.getHours();
  if (hour < 12) return { text: "Good morning" };
  if (hour < 18) return { text: "Good afternoon" };
  return { text: "Good evening" };
}

export function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDateMedium(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
