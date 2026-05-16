import {
    isDeadlineAlarmModalEligible,
    resolveDeadlineAlarmStage,
} from "./deadlineAlarmStage";
import {
  logStartupHandoffAccepted,
  logStartupHandoffRead,
  logStartupHandoffSkipped,
} from "./alarmDiagnostics";
import {
    buildDeadlineRouteParams,
    normalizeDeadlineAlarmAction,
} from "./deadlineNotifications";
import { clearPendingAlarmAction, getPendingAlarmAction } from "./nativeAlarm";

const SHORT_MAX_AGE_MS = 25 * 60 * 1000; // 25 minutes
const DEADLINE_OPEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  const pendingAction =
    typeof pending?.action === "string" && pending.action.trim()
      ? pending.action.trim()
      : null;

  const logSkipped = async (reason, details = {}) => {
    await logStartupHandoffSkipped(resolvedTaskId, reason, {
      sourceId:
        typeof pending?.alarmId === "string" && pending.alarmId.trim()
          ? pending.alarmId.trim()
          : null,
      action: pendingAction,
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

  await logStartupHandoffRead(resolvedTaskId, {
    sourceId:
      typeof pending?.alarmId === "string" && pending.alarmId.trim()
        ? pending.alarmId.trim()
        : null,
    action: pendingAction,
    ageMs: Date.now() - pendingTimestamp,
  }).catch(() => {});

  if (pendingAction === "notdone") {
    await clearPending();
    await logSkipped("notdone_already_handled", {
      ageMs: Date.now() - pendingTimestamp,
    });
    return null;
  }

  const normalizedPendingAction =
    pendingAction === "done" || pendingAction === "markdone"
      ? "open"
      : normalizeDeadlineAlarmAction(pendingAction);
  const maxAgeMs =
    normalizedPendingAction === "open"
      ? DEADLINE_OPEN_MAX_AGE_MS
      : SHORT_MAX_AGE_MS;

  if (Date.now() - pendingTimestamp > maxAgeMs) {
    await clearPending();
    await logSkipped("expired", {
      ageMs: Date.now() - pendingTimestamp,
      maxAgeMs,
      alarmStage:
        typeof payload?.stage === "string" && payload.stage.trim()
          ? payload.stage.trim()
          : null,
      displayStage:
        typeof payload?.displayStage === "string" && payload.displayStage.trim()
          ? payload.displayStage.trim()
          : null,
      recoveryReason:
        typeof payload?.recoveryReason === "string" &&
        payload.recoveryReason.trim()
          ? payload.recoveryReason.trim()
          : null,
    });
    return null;
  }

  if (payloadParseFailed) {
    await clearPending();
    await logSkipped("invalid_payload_json");
    return null;
  }

  // Clear BEFORE returning so no second caller can consume it
  await clearPending();

  const action = normalizedPendingAction;

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

  const routeParams = buildDeadlineRouteParams(
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
  await logStartupHandoffAccepted(taskId, {
    sourceId: pending.alarmId,
    action,
    alarmStage,
    displayStage:
      typeof payload?.displayStage === "string" ? payload.displayStage : null,
    recoveryReason:
      typeof payload?.recoveryReason === "string"
        ? payload.recoveryReason
        : null,
    ageMs: Date.now() - pendingTimestamp,
  }).catch(() => {});
  return routeParams;
}
