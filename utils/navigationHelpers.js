export const FILTERS = [
  "All",
  "Today",
  "Overdue",
  "Planner",
  "High",
  "Medium",
  "Low",
];

export function normalizeFilterParam(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) return "All";
  return (
    FILTERS.find((f) => f.toLowerCase() === raw.trim().toLowerCase()) || "All"
  );
}

export function normalizeRouteString(value) {
  if (Array.isArray(value)) return normalizeRouteString(value[0]);
  return typeof value === "string" ? value.trim() : "";
}