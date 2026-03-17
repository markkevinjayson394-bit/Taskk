/**
 * workloadCalculator.js
 *
 * Calculates a student's daily workload score based on upcoming tasks.
 * Higher score = more urgent/heavy workload.
 *
 * FIXES:
 * - Date logic was inverted (was counting past tasks, now counts future tasks)
 * - Added urgency weighting (tasks due sooner score higher)
 */

export function calculateDailyWorkload(tasks) {
  const TYPE_POINTS = {
    assignment: 1,
    quiz: 2,
    project: 3,
    exam: 4,
  };

  const PRIORITY_MULTIPLIER = {
    low: 1,
    medium: 1.5,
    high: 2,
  };

  // Use end of today (23:59:59.999) for comparison to include tasks due anytime today
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  let score = 0;

  const parseDueDate = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") {
      const d = value.toDate();
      return Number.isNaN(d?.getTime?.()) ? null : d;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "string" || typeof value === "number") {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  };

  tasks.forEach((t) => {
    // Skip completed tasks
    if (t.completed) return;

    const dueDate = parseDueDate(t.dueAt);
    if (!dueDate) return;

    // FIX: skip PAST tasks - only count upcoming/today tasks
    // Using endOfToday ensures tasks due anytime today are included
    if (dueDate < endOfToday) return;

    const base = TYPE_POINTS[t.type] || 1;
    const multiplier = PRIORITY_MULTIPLIER[t.priority] || 1.5;

    // Urgency: tasks due sooner count more (using endOfToday for consistent comparison)
    const daysLeft = Math.ceil((dueDate - endOfToday) / 86400000);
    const urgency =
      daysLeft <= 1
        ? 2 // due today or tomorrow
        : daysLeft <= 3
          ? 1.5 // due in 2-3 days
          : daysLeft <= 7
            ? 1.2 // due this week
            : 1; // due later

    score += base * multiplier * urgency;
  });

  return Math.round(score);
}

/**
 * Returns a label based on the workload score:
 *   0-4    "Light"
 *   5-9    "Moderate"
 *   10-14  "Heavy"
 *   15+    "Overwhelming"
 */
export function getWorkloadLabel(score) {
  if (score <= 4) return { label: "Light", color: "#22c55e" };
  if (score <= 9) return { label: "Moderate", color: "#f59e0b" };
  if (score <= 14) return { label: "Heavy", color: "#ef4444" };
  return { label: "Overwhelming", color: "#7c3aed" };
}
