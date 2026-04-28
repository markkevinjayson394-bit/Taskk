export function formatEstimatedMinutes(mins) {
  if (!Number.isFinite(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60),
    m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatDurationMs(ms) {
  if (!ms || ms <= 0) return "Done";
  const totalMins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMins / 60),
    m = totalMins % 60;
  if (h > 0 && m > 0) return `Done in ${h}h ${m}m`;
  if (h > 0) return `Done in ${h}h`;
  return `Done in ${m}m`;
}
