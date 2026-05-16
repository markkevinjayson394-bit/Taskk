import {
    isDeadlineAlarmModalEligible,
    resolveDeadlineAlarmStage,
} from "./deadlineAlarmStage";
import { logStartupHandoffSkipped } from "./alarmDiagnostics";
import {
    buildDeadlineRouteParams,
    normalizeDeadlineAlarmAction,
} from "./deadlineNotifications";
import { clearPendingAlarmAction, getPendingAlarmAction } from "./nativeAlarm";

const MAX_AGE_MS = 25 * 60 * 1000; // 25 minutes

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

  const clearPending = async () => {
    await clearPendingAlarmAction().catch(() => {});
  };

  let payload = null;
  let payloadParseFailed = false;
  if (typeof pending?.payloadJson === "string" && pending.payloadJson.trim()) {
    try {
      payload = JSON.parse(pending.payloadJson);
    } catch {
      payloadParseFailed = true;
    }
  }

  const resolvedTaskId =
    typeof payload?.taskId === "string" && payload.taskId.trim()
      ? payload.taskId.trim()
      : typeof pending?.alarmId === "string" && pending.alarmId.trim()
        ? pending.alarmId.trim()
        : null;

  const logSkipped = async (reason, details = {}) => {
    await logStartupHandoffSkipped(resolvedTaskId, reason, {
      sourceId:
        typeof pending?.alarmId === "string" && pending.alarmId.trim()
          ? pending.alarmId.trim()
          : null,
      action:
        typeof pending?.action === "string" && pending.action.trim()
          ? pending.action.trim()
          : null,
      ...details,
    }).catch(() => {});
  };

  if (!pending?.action || !pending?.alarmId || !pending?.timestamp) {
    if (pending) {
      await clearPending();
      await logSkipped("missing_fields");
    }
    return null;
  }

  const pendingTimestamp = Number(pending.timestamp);
  if (!Number.isFinite(pendingTimestamp)) {
    await clearPending();
    await logSkipped("invalid_timestamp");
    return null;
  }

  if (Date.now() - pendingTimestamp > MAX_AGE_MS) {
    await clearPending();
    await logSkipped("expired", { ageMs: Date.now() - pendingTimestamp });
    return null;
  }

  if (payloadParseFailed) {
    await clearPending();
    await logSkipped("invalid_payload_json");
    return null;
  }

  // Clear BEFORE returning so no second caller can consume it
  await clearPending();

  const action =
    pending.action === "done" || pending.action === "markdone"
      ? "open"
      : normalizeDeadlineAlarmAction(pending.action);

  let taskId = pending.alarmId;
  let alarmStage = null;
  let dueAtMs = null;

  payload = payload && typeof payload === "object" ? payload : {};
  if (payload?.taskId) taskId = payload.taskId;
  alarmStage = resolveDeadlineAlarmStage(payload);
  const raw = Number(payload?.dueAtMs);
  dueAtMs = Number.isFinite(raw) && raw > 0 ? raw : null;

  if (!isDeadlineAlarmModalEligible(payload ?? { stage: alarmStage })) {
    await logSkipped("ineligible_stage", {
      alarmStage,
      displayStage:
        typeof payload?.displayStage === "string" ? payload.displayStage : null,
      recoveryReason:
        typeof payload?.recoveryReason === "string"
          ? payload.recoveryReason
          : null,
    });
    return null;
  }

  return buildDeadlineRouteParams(
    {
      ...payload,
      taskId,
      ...(alarmStage ? { stage: alarmStage } : {}),
      ...(dueAtMs !== null ? { dueAtMs } : {}),
    },
    {
      action,
      nativeHandoff: true,
      sourceId: pending.alarmId,
    }
  );
}
