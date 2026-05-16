const listeners = new Set();
const pendingRequests = [];
const MAX_PENDING_REQUESTS = 20;

function normalizeRequest(request = {}) {
  const focusTaskId =
    typeof request?.focusTaskId === "string" && request.focusTaskId.trim()
      ? request.focusTaskId.trim()
      : typeof request?.taskId === "string" && request.taskId.trim()
        ? request.taskId.trim()
        : null;
  if (!focusTaskId) return null;

  const alarmStage =
    typeof request?.displayStage === "string" && request.displayStage.trim()
      ? request.displayStage.trim()
      : typeof request?.alarmStage === "string" && request.alarmStage.trim()
        ? request.alarmStage.trim()
        : typeof request?.stage === "string" && request.stage.trim()
          ? request.stage.trim()
          : null;

  return {
    ...request,
    focusTaskId,
    alarmStage,
    alarmAction:
      typeof request?.alarmAction === "string" && request.alarmAction.trim()
        ? request.alarmAction.trim()
        : "open",
    nativeHandoff:
      request?.nativeHandoff === true ||
      request?.nativeHandoff === "1" ||
      request?.nativeHandoff === "true",
    sourceId:
      typeof request?.sourceId === "string" && request.sourceId.trim()
        ? request.sourceId.trim()
        : null,
  };
}

export function publishDeadlineAlarmOpenRequest(request) {
  const normalized = normalizeRequest(request);
  if (!normalized) return false;

  if (listeners.size === 0) {
    pendingRequests.push(normalized);
    while (pendingRequests.length > MAX_PENDING_REQUESTS) {
      pendingRequests.shift();
    }
    return true;
  }

  listeners.forEach((listener) => {
    listener(normalized);
  });
  return true;
}

export function subscribeDeadlineAlarmOpenRequests(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  if (pendingRequests.length > 0) {
    const queued = pendingRequests.splice(0, pendingRequests.length);
    queued.forEach((request) => listener(request));
  }

  return () => {
    listeners.delete(listener);
  };
}
