import { formatDeadlineCountdown, getUrgencyMeta } from "../../utils/deadlineTime";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW_MS = Date.UTC(2026, 3, 25, 12, 0, 0, 0);
const NOW = new Date(NOW_MS);

describe("getUrgencyMeta", () => {
  test("returns none when the deadline is missing", () => {
    expect(getUrgencyMeta(null, NOW_MS)).toEqual({
      label: "No deadline",
      color: "#64748b",
      severity: "none",
    });
  });

  test("treats the exact deadline as overdue", () => {
    expect(getUrgencyMeta(NOW_MS, NOW_MS)).toEqual({
      label: "Overdue",
      color: "#ef4444",
      severity: "overdue",
    });
  });

  test("uses critical below 24 hours and urgent at exactly 24 hours", () => {
    expect(getUrgencyMeta(NOW_MS + DAY_MS - 1, NOW_MS)).toEqual({
      label: "Critical",
      color: "#ef4444",
      severity: "critical",
    });
    expect(getUrgencyMeta(NOW_MS + DAY_MS, NOW_MS)).toEqual({
      label: "Urgent",
      color: "#f59e0b",
      severity: "urgent",
    });
  });

  test("uses urgent below 72 hours and soon at exactly 72 hours", () => {
    expect(getUrgencyMeta(NOW_MS + 3 * DAY_MS - 1, NOW_MS)).toEqual({
      label: "Urgent",
      color: "#f59e0b",
      severity: "urgent",
    });
    expect(getUrgencyMeta(NOW_MS + 3 * DAY_MS, NOW_MS)).toEqual({
      label: "Soon",
      color: "#0ea5e9",
      severity: "soon",
    });
  });

  test("uses soon below seven days and upcoming at exactly seven days", () => {
    expect(getUrgencyMeta(NOW_MS + 7 * DAY_MS - 1, NOW_MS)).toEqual({
      label: "Soon",
      color: "#0ea5e9",
      severity: "soon",
    });
    expect(getUrgencyMeta(NOW_MS + 7 * DAY_MS, NOW_MS)).toEqual({
      label: "Upcoming",
      color: "#10b981",
      severity: "upcoming",
    });
  });
});

describe("formatDeadlineCountdown", () => {
  test("returns fallback for null", () => {
    expect(formatDeadlineCountdown(null)).toBe("No deadline set");
  });

  test("returns fallback for invalid string", () => {
    expect(formatDeadlineCountdown("not-a-date")).toBe("No deadline set");
  });

  test('shows "Due now" when deadline is within a minute', () => {
    const due = new Date(NOW_MS + 30_000);
    expect(formatDeadlineCountdown(due, NOW)).toBe("Due now");
  });

  test('shows "Overdue by" for past dates', () => {
    const past = new Date(NOW_MS - 2 * HOUR_MS);
    expect(formatDeadlineCountdown(past, NOW)).toContain("Overdue by");
  });

  test("shows days+hours left for future dates beyond 24h", () => {
    const future = new Date(NOW_MS + 2 * DAY_MS + 3 * HOUR_MS);
    const result = formatDeadlineCountdown(future, NOW);
    expect(result).toContain("left");
    expect(result).toMatch(/\d+d/);
  });

  test("shows only minutes when under an hour", () => {
    const future = new Date(NOW_MS + 45 * 60_000);
    const result = formatDeadlineCountdown(future, NOW);
    expect(result).toContain("left");
    expect(result).toMatch(/\d+m/);
  });

  test("supports long style", () => {
    const future = new Date(NOW_MS + 2 * DAY_MS);
    const result = formatDeadlineCountdown(future, NOW, { style: "long" });
    expect(result).toContain("left");
  });
});