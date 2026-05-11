import {
  clearPendingAlarmAction,
  getPendingAlarmAction,
} from "./nativeAlarm";
import {
  isDeadlineAlarmModalEligible,
  resolveDeadlineAlarmStage,
} from "./deadlineAlarmStage";

const MAX_AGE_MS = 25 * 60 * 1000;  // 25 minutes

/**
 * Reads the native pending alarm action, validates it, clears it,
 * and returns a normalized params object ready to pass to the router.
 * Returns null if there is nothing to act on.
 */
export async function consumePendingAlarmAction() {
  let pending;
  try {
    pending = await getPendingAlarmAction();
  } catch {
    return null;
  }

  if (!pending?.action || !pending?.alarmId || !pending?.timestamp) {
    return null;
  }

  if (Date.now() - pending.timestamp > MAX_AGE_MS) {
    await clearPendingAlarmAction().catch(() => {});
    return null;
  }

  // Clear BEFORE returning so no second caller can consume it
  await clearPendingAlarmAction().catch(() => {});

  const action =
    pending.action === "done" || pending.action === "markdone"
      ? "markdone"
      : pending.action === "not_done" || pending.action === "notdone"
        ? "__handled_directly__"
        : pending.action === "default"
          ? null
          : undefined;

  if (action === undefined) return null;
  if (action === "__handled_directly__") return null;

  let taskId = pending.alarmId;
  let alarmStage = null;
  let dueAtMs = null;
  let payload = null;

  try {
    payload = JSON.parse(pending.payloadJson || "{}");
    if (payload?.taskId) taskId = payload.taskId;
    alarmStage = resolveDeadlineAlarmStage(payload);
    const raw = Number(payload?.dueAtMs);
    dueAtMs = Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {}

  if (!isDeadlineAlarmModalEligible(payload ?? { stage: alarmStage })) {
    return null;
  }

  return {
    focusTaskId: taskId,
    showAlarm: "1",
    ...(action ? { pendingAction: action } : {}),
    nativeHandoff: "1",
    ...(dueAtMs !== null ? { dueAtMs: String(dueAtMs) } : {}),
    ...(alarmStage ? { alarmStage } : {}),
  };
}
