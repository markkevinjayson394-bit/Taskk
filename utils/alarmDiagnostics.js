/**
 * utils/alarmDiagnostics.js (Minimal Version)
 * 
 * Integrates with your existing logger.js and Sentry.
 * Logs alarm lifecycle events without duplicate infrastructure.
 * 
 * Usage:
 *   import { logAlarmEvent } from './alarmDiagnostics';
 *   
 *   await logAlarmEvent('SCHEDULE_DUE', taskId, {
 *     dueAtMs,
 *     path: 'native', // or 'notifee' or 'expo'
 *     success: true,
 *   });
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError, reportWarning, warnIfDev, logIfDev } from './logger';

const DIAGNOSTICS_KEY = 'alarm_diagnostics_v2';
const MAX_LOGS = 500;

let diagnosticsBuffer = [];

/**
 * Core event structure
 */
function createEvent(eventType, taskId, data = {}) {
  return {
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    eventType,
    taskId,
    ...data,
  };
}

/**
 * Log alarm event to buffer + storage (integrates with your logger)
 */
export async function logAlarmEvent(eventType, taskId, data = {}) {
  const event = createEvent(eventType, taskId, data);
  diagnosticsBuffer.push(event);

  // Keep size manageable
  if (diagnosticsBuffer.length > MAX_LOGS) {
    diagnosticsBuffer = diagnosticsBuffer.slice(-MAX_LOGS);
  }

  // Persist to storage
  try {
    await AsyncStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(diagnosticsBuffer));
  } catch (err) {
    // Don't break the app if logging fails
    console.warn('[AlarmDiagnostics] Storage write failed:', err);
  }

  // Log to your existing logger
  const logLevel = eventType.includes('FAILED') ? 'warn' : 'log';
  const message = `[Alarm/${eventType}] ${taskId}`;

  if (logLevel === 'warn') {
    warnIfDev(message, data);
    // Also report to Sentry for failures
    if (data.error) {
      reportWarning(data.error, {
        message,
        tags: { alarm_event: eventType, task_id: taskId },
        extra: data,
      });
    }
  } else {
    logIfDev(message, data);
  }

  return event;
}

/**
 * High-level helpers for common events
 */

export async function logScheduleStart(taskId, taskTitle, dueAtMs) {
  const now = Date.now();
  const isOverdue = dueAtMs < now;
  const delayMs = dueAtMs - now;

  return logAlarmEvent('SCHEDULE_START', taskId, {
    taskTitle,
    dueAtMs: new Date(dueAtMs).toISOString(),
    delayMs,
    stage: isOverdue ? 'OVERDUE' : 'BEFORE_DUE',
  });
}

export async function logScheduleSuccess(taskId, alarmId, path, metadata = {}) {
  return logAlarmEvent('SCHEDULE_SUCCESS', taskId, {
    alarmId,
    path, // 'native', 'notifee_trigger', 'notifee_display', 'expo'
    ...metadata,
  });
}

export async function logScheduleFailed(taskId, path, error, metadata = {}) {
  return logAlarmEvent('SCHEDULE_FAILED', taskId, {
    path,
    error: error instanceof Error ? error.message : String(error),
    errorCode: error?.code,
    ...metadata,
  });
}

export async function logAlarmFired(taskId, alarmId, stage) {
  return logAlarmEvent('ALARM_FIRED', taskId, {
    alarmId,
    stage,
  });
}

export async function logCheckpointAdvance(
  taskId,
  fromStage,
  toStage,
  triggerAtMs
) {
  const delayToNextMs = Math.max(0, triggerAtMs - Date.now());

  return logAlarmEvent('CHECKPOINT_ADVANCE', taskId, {
    fromStage,
    toStage,
    triggerAtMs: new Date(triggerAtMs).toISOString(),
    delayToNextMs,
  });
}

export async function logCheckpointAdvanceFailed(
  taskId,
  stage,
  error,
  metadata = {}
) {
  return logAlarmEvent('CHECKPOINT_ADVANCE_FAILED', taskId, {
    stage,
    error: error instanceof Error ? error.message : String(error),
    ...metadata,
  });
}

export async function logMissedAlarmDetected(taskId, stage, expectedTriggerAt) {
  const overbyMs = Date.now() - expectedTriggerAt;

  return logAlarmEvent('MISSED_ALARM_DETECTED', taskId, {
    stage,
    expectedTriggerAt: new Date(expectedTriggerAt).toISOString(),
    overbyMs: Math.max(0, overbyMs),
  });
}

export async function logMissedRecoveryNotificationPosted(
  taskId,
  stage,
  alarmId,
  metadata = {}
) {
  return logAlarmEvent('MISSED_RECOVERY_NOTIFICATION_POSTED', taskId, {
    stage,
    alarmId,
    ...metadata,
  });
}

export async function logMissedRecoveryOpenHandoffWritten(
  taskId,
  stage,
  alarmId,
  metadata = {}
) {
  return logAlarmEvent('MISSED_RECOVERY_OPEN_HANDOFF_WRITTEN', taskId, {
    stage,
    alarmId,
    ...metadata,
  });
}

export async function logStartupHandoffConsumed(taskId, metadata = {}) {
  return logAlarmEvent('STARTUP_HANDOFF_CONSUMED', taskId, metadata);
}

export async function logStartupHandoffSkipped(
  taskId,
  reason,
  metadata = {}
) {
  return logAlarmEvent('STARTUP_HANDOFF_SKIPPED', taskId, {
    reason,
    ...metadata,
  });
}

export async function logPermissionState(permission, granted, metadata = {}) {
  return logAlarmEvent('PERMISSION_CHECK', null, {
    permission,
    granted,
    ...metadata,
  });
}

/**
 * Get all logged events (for debug view)
 */
export async function getDiagnosticLogs() {
  try {
    const stored = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
    return stored ? JSON.parse(stored) : diagnosticsBuffer;
  } catch (err) {
    console.warn('[AlarmDiagnostics] Failed to read logs:', err);
    return diagnosticsBuffer;
  }
}

/**
 * Clear all diagnostics
 */
export async function clearDiagnostics() {
  diagnosticsBuffer = [];
  try {
    await AsyncStorage.removeItem(DIAGNOSTICS_KEY);
  } catch (err) {
    console.warn('[AlarmDiagnostics] Failed to clear logs:', err);
  }
}

/**
 * Analyze diagnostics to find issues
 */
export async function analyzeDiagnostics() {
  const logs = await getDiagnosticLogs();

  const analysis = {
    totalEvents: logs.length,
    eventCounts: {},
    failureRate: 0,
    orphanedTasks: [],
  };

  // Count event types
  logs.forEach((log) => {
    analysis.eventCounts[log.eventType] =
      (analysis.eventCounts[log.eventType] || 0) + 1;
  });

  // Find tasks that scheduled but never fired
  const taskEvents = {};
  logs.forEach((log) => {
    if (log.taskId) {
      if (!taskEvents[log.taskId]) taskEvents[log.taskId] = [];
      taskEvents[log.taskId].push(log);
    }
  });

  Object.entries(taskEvents).forEach(([taskId, events]) => {
    const scheduled = events.some((e) => e.eventType === 'SCHEDULE_SUCCESS');
    const fired = events.some((e) => e.eventType === 'ALARM_FIRED');
    const missed = events.some((e) => e.eventType === 'MISSED_ALARM_DETECTED');

    if (scheduled && !fired && !missed) {
      analysis.orphanedTasks.push(taskId);
    }
  });

  // Calculate failure rate
  const successes = analysis.eventCounts['SCHEDULE_SUCCESS'] || 0;
  const failures = analysis.eventCounts['SCHEDULE_FAILED'] || 0;
  const total = successes + failures;
  analysis.failureRate = total > 0 ? ((failures / total) * 100).toFixed(1) : 0;

  return analysis;
}

/**
 * Export human-readable report
 */
export async function exportDiagnosticsReport() {
  const logs = await getDiagnosticLogs();
  const analysis = await analyzeDiagnostics();

  let report = `
=== ALARM DIAGNOSTICS REPORT ===
Generated: ${new Date().toISOString()}

SUMMARY
───────
Total Events: ${analysis.totalEvents}
Successes: ${analysis.eventCounts['SCHEDULE_SUCCESS'] || 0}
Failures: ${analysis.eventCounts['SCHEDULE_FAILED'] || 0}
Failure Rate: ${analysis.failureRate}%
Orphaned Tasks: ${analysis.orphanedTasks.length}

EVENT LOG
─────────
`;

  // Group by task for readability
  const taskEvents = {};
  logs.forEach((log) => {
    if (log.taskId) {
      if (!taskEvents[log.taskId]) taskEvents[log.taskId] = [];
      taskEvents[log.taskId].push(log);
    }
  });

  Object.entries(taskEvents).forEach(([taskId, events]) => {
    report += `\nTask: ${taskId}\n`;
    events.forEach((event) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      report += `  ${time} [${event.eventType}]`;

      if (event.path) report += ` path=${event.path}`;
      if (event.stage) report += ` stage=${event.stage}`;
      if (event.error) report += ` ERROR: ${event.error}`;

      report += '\n';
    });
  });

  return report;
}
