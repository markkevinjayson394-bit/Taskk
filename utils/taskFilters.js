export function isPlannerTask(task = {}) {
  const source =
    typeof task?.source === "string" ? task.source.trim().toLowerCase() : "";
  if (task?.plannerArchived || source === "planner") return true;
  return (
    typeof task?.plannerRef === "string" && task.plannerRef.trim().length > 0
  );
}
