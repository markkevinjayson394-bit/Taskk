export function parsePlannerRef(ref) {
  if (typeof ref !== "string") return null;
  const value = ref.trim();
  if (!value) return null;
  if (value.split(":").some((segment) => segment === "")) {
    console.warn("parsePlannerRef: malformed ref (empty segment):", ref);
    return null;
  }
  const calendarMatch = value.match(/^calendar:day:([^:]+):plan:(.+)$/);
  if (calendarMatch) {
    const planId = (calendarMatch[2] || "").trim();
    if (!planId) {
      console.warn(
        "parsePlannerRef: malformed calendar ref (empty planId):",
        ref
      );
      return null;
    }
    return {
      mode: "calendar-day",
      dayKey: calendarMatch[1],
      planId,
    };
  }
  const dayMatch = value.match(/^planner:day:([^:]+):block:(.+)$/);
  if (dayMatch) {
    const blockId = (dayMatch[2] || "").trim();
    if (!blockId) {
      console.warn(
        "parsePlannerRef: malformed day-planner ref (empty blockId):",
        ref
      );
      return null;
    }
    return { mode: "day", dayKey: dayMatch[1], blockId };
  }
  const monthMatch = value.match(
    /^planner:month:(\d{4}-\d{2}):milestone:(\d+)$/
  );
  if (monthMatch)
    return {
      mode: "month",
      monthKey: monthMatch[1],
      milestoneIndex: Number(monthMatch[2]),
    };
  console.warn("parsePlannerRef: unrecognized ref format:", ref);
  return null;
}
