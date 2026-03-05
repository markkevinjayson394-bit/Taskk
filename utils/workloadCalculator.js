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

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  let score = 0;

  tasks.forEach((t) => {
    if (t.completed) return;

    const dueDate = t.dueAt.toDate();
    if (dueDate > today) return;

    const base = TYPE_POINTS[t.type] || 1;
    const multiplier = PRIORITY_MULTIPLIER[t.priority] || 1.5;

    score += base * multiplier;
  });

  return Math.round(score);
}
