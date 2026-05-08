import { resolveTaskDueDate } from "./academicTaskModel";
import { localDaysBetween, startOfLocalDay } from "./dateHelpers";


export function calculateDailyWorkload(tasks) {
  const TYPE_POINTS = {
    assignment: 1,
    quiz: 2,
    review: 1.5,
    project: 3,
    exam: 4,
    custom: 1,
  };

  const PRIORITY_MULTIPLIER = {
    low: 1,
    medium: 1.5,
    high: 2,
  };

  // Use the shared local-day helper so workload calculations stay timezone-safe.
  const startOfToday = startOfLocalDay();
  if (!startOfToday) return 0;

  let score = 0;

  tasks.forEach((t) => {
    // Skip completed tasks
    if (t.completed) return;

    const dueDate = resolveTaskDueDate(t);
    if (!dueDate) return;

    // Skip tasks before today; keep today and future workload.
    if (dueDate < startOfToday) return;

    const base = TYPE_POINTS[t.type] || 1;
    const multiplier = PRIORITY_MULTIPLIER[t.priority] || 1.5;

    // Urgency: tasks due sooner count more.
    const daysLeft = localDaysBetween(startOfToday, dueDate);
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
 * Returns a label based on the workload score.
 */
export function getWorkloadLabel(score) {
  if (score >= 20) return "Heavy";
  if (score >= 10) return "Moderate";
  return "Light";
}
