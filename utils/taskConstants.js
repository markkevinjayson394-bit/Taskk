export const PRIORITY_COLOR = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

export const TYPE_META = {
  assignment: { icon: "document-text", label: "Assignment", color: "#3b82f6" },
  quiz: { icon: "help-circle", label: "Quiz", color: "#f59e0b" },
  exam: { icon: "school", label: "Exam", color: "#ef4444" },
  project: { icon: "construct", label: "Project", color: "#8b5cf6" },
  review: { icon: "book-outline", label: "Review", color: "#10b981" },
  custom: { icon: "ellipse", label: "Task", color: "#6366f1" },
};

export const TYPE_POINTS = { assignment: 1, quiz: 2, project: 3, exam: 4 };
export const PRIORITY_MULTIPLIER = { low: 1, medium: 1.5, high: 2 };
export const CREATE_PRIORITY_OPTIONS = [
  { label: "High", value: "high", color: "#ef4444" },
  { label: "Medium", value: "medium", color: "#f59e0b" },
  { label: "Low", value: "low", color: "#22c55e" },
];
