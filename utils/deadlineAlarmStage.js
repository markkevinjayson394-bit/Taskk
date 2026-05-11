const MODAL_ELIGIBLE_STAGES = new Set(["due", "+15m", "+1h", "+3h", "daily"]);

export function resolveDeadlineAlarmStage(data = {}) {
  if (typeof data?.stage === "string" && data.stage.trim()) {
    return data.stage.trim();
  }
  if (typeof data?.threshold === "string" && data.threshold.trim()) {
    return data.threshold.trim();
  }
  return null;
}

export function isDeadlineAlarmModalEligible(data = {}) {
  if (data?.isLeadTime === true) return false;
  const stage = resolveDeadlineAlarmStage(data);
  if (!stage) return false;
  return MODAL_ELIGIBLE_STAGES.has(stage);
}
