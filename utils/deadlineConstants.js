export const THRESHOLDS = [
  { key: "1d", ms: 24 * 60 * 60 * 1000, label: "1 day before" },
  { key: "2h", ms: 2 * 60 * 60 * 1000, label: "2 hours before" },
  { key: "30m", ms: 30 * 60 * 1000, label: "30 min before" },
  { key: "1m", ms: 60 * 1000, label: "1 minute before" },
  { key: "due", ms: 0, label: "Due NOW" },
];

export const OVERDUE_THRESHOLDS = [
  { key: "+15m", ms: 15 * 60 * 1000, window: 5 * 60 * 1000 },
  { key: "+1h", ms: 60 * 60 * 1000, window: 10 * 60 * 1000 },
  { key: "+3h", ms: 3 * 60 * 60 * 1000, window: 15 * 60 * 1000 },
];

export const FOREGROUND_THRESHOLDS = [
  { key: "1d", ms: 24 * 60 * 60 * 1000, window: 5 * 60 * 1000 },
  { key: "2h", ms: 2 * 60 * 60 * 1000, window: 3 * 60 * 1000 },
  { key: "30m", ms: 30 * 60 * 1000, window: 2 * 60 * 1000 },
  { key: "1m", ms: 60 * 1000, window: 90 * 1000 },
  { key: "due", ms: 0, window: 10 * 60 * 1000 },
];

// FIXED: added key field to every entry so all chain lookups work
export const OVERDUE_CHAIN = [
  { key: "due",   stage: "due",   delayMs: 0 },
  { key: "+15m",  stage: "+15m",  delayMs: 15 * 60 * 1000 },
  { key: "+1h",   stage: "+1h",   delayMs: 60 * 60 * 1000 },
  { key: "+3h",   stage: "+3h",   delayMs: 3 * 60 * 60 * 1000 },
  { key: "daily", stage: "daily", delayMs: null },
];

