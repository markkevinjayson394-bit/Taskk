const listeners = new Set();

function normalizeTaskMutation(event = {}) {
  const type =
    typeof event?.type === "string" ? event.type.trim().toLowerCase() : "";
  const taskId =
    typeof event?.taskId === "string" ? event.taskId.trim() : "";
  const userId =
    typeof event?.userId === "string" ? event.userId.trim() : "";

  if (!type || !taskId || !userId) return null;

  return {
    type,
    taskId,
    userId,
    completedTask: event?.completedTask ?? null,
    completedAt: event?.completedAt ?? null,
    source:
      typeof event?.source === "string" && event.source.trim()
        ? event.source.trim()
        : null,
  };
}

export function publishTaskMutation(event) {
  const normalized = normalizeTaskMutation(event);
  if (!normalized) return false;

  listeners.forEach((listener) => {
    try {
      listener(normalized);
    } catch (_error) {}
  });
  return true;
}

export function subscribeTaskMutations(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
