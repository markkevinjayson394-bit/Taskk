import {
    Alert,
    NativeModules,
    Platform,
    TurboModuleRegistry,
} from "react-native";
import { warnIfDev } from "./logger";

const NativeAlarmModule =
  NativeModules.NativeAlarmModule ??
  TurboModuleRegistry?.get?.("NativeAlarmModule");

const hasNativeAlarmModule =
  Platform.OS === "android" && Boolean(NativeAlarmModule);

/**
 * The raw NativeAlarmModule reference, exported so callers can construct a
 * NativeEventEmitter with it (e.g. for the `onAlarmNotificationTap` event).
 * Will be `null` on iOS or when the native module is unavailable.
 */
export { NativeAlarmModule as rawNativeAlarmModule };

export const NATIVE_ALARM_ID_PREFIX = "native-alarm:";

export const isNativeAlarmSupported =
  hasNativeAlarmModule &&
  typeof NativeAlarmModule.scheduleExactAlarm === "function";

export const canPickNativeAlarmTone =
  hasNativeAlarmModule && typeof NativeAlarmModule.pickAlarmTone === "function";

export const canPickNativeAlarmAudioFile =
  hasNativeAlarmModule &&
  typeof NativeAlarmModule.pickAlarmAudioFile === "function";

const PERMISSION_PROMPT_COOLDOWN_MS = 60 * 1000;
const permissionPromptState = {
  exactAlarm: { open: false, lastAt: 0 },
  fullScreen: { open: false, lastAt: 0 },
};

export function isNativeAlarmScheduledId(value) {
  return typeof value === "string" && value.startsWith(NATIVE_ALARM_ID_PREFIX);
}

export function toNativeAlarmScheduledId(alarmId) {
  return `${NATIVE_ALARM_ID_PREFIX}${alarmId}`;
}

export function fromNativeAlarmScheduledId(scheduledId) {
  if (!isNativeAlarmScheduledId(scheduledId)) return scheduledId;
  return scheduledId.slice(NATIVE_ALARM_ID_PREFIX.length);
}

export async function canScheduleExactAlarms() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.canScheduleExactAlarms !== "function")
    return { status: "unsupported" };
  try {
    return {
      status: "success",
      value: Boolean(await NativeAlarmModule.canScheduleExactAlarms()),
    };
  } catch (err) {
    warnIfDev("NativeAlarm: canScheduleExactAlarms failed:", err);
    return { status: "error", error: err };
  }
}

export function openExactAlarmSettings() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.openExactAlarmSettings !== "function")
    return { status: "unsupported" };
  try {
    NativeAlarmModule.openExactAlarmSettings();
    return { status: "success" };
  } catch (err) {
    warnIfDev("NativeAlarm: openExactAlarmSettings failed:", err);
    return { status: "error", error: err };
  }
}

export async function canUseFullScreenIntent() {
  if (!isNativeAlarmSupported) return true;
  if (typeof NativeAlarmModule.canUseFullScreenIntent !== "function")
    return true;
  try {
    return Boolean(await NativeAlarmModule.canUseFullScreenIntent());
  } catch {
    return true;
  }
}

export function openFullScreenIntentSettings() {
  if (!isNativeAlarmSupported) return;
  if (typeof NativeAlarmModule.openFullScreenIntentSettings !== "function")
    return;
  NativeAlarmModule.openFullScreenIntentSettings();
}

export async function isIgnoringBatteryOptimizations() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.isIgnoringBatteryOptimizations !== "function")
    return { status: "unsupported" };
  try {
    return {
      status: "success",
      value: Boolean(await NativeAlarmModule.isIgnoringBatteryOptimizations()),
    };
  } catch (err) {
    warnIfDev("NativeAlarm: isIgnoringBatteryOptimizations failed:", err);
    return { status: "error", error: err };
  }
}

export function requestIgnoreBatteryOptimizations() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.requestIgnoreBatteryOptimizations !== "function")
    return { status: "unsupported" };
  try {
    NativeAlarmModule.requestIgnoreBatteryOptimizations();
    return { status: "success" };
  } catch (err) {
    warnIfDev("NativeAlarm: requestIgnoreBatteryOptimizations failed:", err);
    return { status: "error", error: err };
  }
}

function maybeShowPermissionPrompt(kind, title, message, openSettings) {
  const state = permissionPromptState[kind];
  if (!state || state.open) return false;

  const now = Date.now();
  if (now - state.lastAt < PERMISSION_PROMPT_COOLDOWN_MS) return false;

  state.open = true;
  state.lastAt = now;

  let dismissed = false;
  const resetTimeout = setTimeout(() => {
    if (!dismissed) {
      state.open = false;
      dismissed = true;
    }
  }, 15000);

  Alert.alert(
    title,
    message,
    [
      {
        text: "Open Settings",
        onPress: () => {
          if (!dismissed) {
            state.open = false;
            dismissed = true;
            clearTimeout(resetTimeout);
            openSettings?.();
          }
        },
      },
      {
        text: "Later",
        style: "cancel",
        onPress: () => {
          if (!dismissed) {
            state.open = false;
            dismissed = true;
            clearTimeout(resetTimeout);
          }
        },
      },
    ],
    {
      cancelable: true,
      onDismiss: () => {
        if (!dismissed) {
          state.open = false;
          dismissed = true;
          clearTimeout(resetTimeout);
        }
      },
    }
  );

  return true;
}

export async function ensureNativeAlarmPermissions({
  requireExactAlarm = false,
  requireFullScreen = false,
  prompt = false,
  source = "unknown",
} = {}) {
  const result = {
    exactAlarm: { status: "unsupported", value: true },
    fullScreenIntent: { status: "unsupported", value: true },
  };

  if (Platform.OS !== "android" || !isNativeAlarmSupported) {
    return result;
  }

  if (requireExactAlarm) {
    const exactResult = await canScheduleExactAlarms();
    const exactGranted =
      exactResult?.status === "success"
        ? Boolean(exactResult.value)
        : exactResult?.status === "unsupported";
    result.exactAlarm = {
      status: exactResult?.status || "error",
      value: exactGranted !== false,
    };

    if (prompt && exactResult?.status === "success" && !exactResult.value) {
      maybeShowPermissionPrompt(
        "exactAlarm",
        "Enable Exact Alarms",
        "Due and overdue task alarms need Exact alarms to ring on time outside the app.",
        openExactAlarmSettings
      );
      warnIfDev(`NativeAlarm: exact alarm permission missing (${source})`);
    }
  }

  if (requireFullScreen) {
    if (Number(Platform.Version) < 34) {
      result.fullScreenIntent = { status: "not_required", value: true };
    } else {
      const granted = await canUseFullScreenIntent();
      result.fullScreenIntent = { status: "success", value: Boolean(granted) };

      if (prompt && !granted) {
        maybeShowPermissionPrompt(
          "fullScreen",
          "Enable Full-Screen Popups",
          "Due and overdue task alarms need Full-screen popups to open over the lock screen on Android 14+.",
          openFullScreenIntentSettings
        );
        warnIfDev(
          `NativeAlarm: full-screen popup permission missing (${source})`
        );
      }
    }
  }

  return result;
}

export async function scheduleNativeAlarm({
  alarmId,
  triggerAt,
  title,
  body,
  payload,
}) {
  if (!isNativeAlarmSupported) return null;
  if (!alarmId) return null;
  const now = Date.now();
  const triggerMs = Number(triggerAt);
  if (!Number.isFinite(triggerMs)) return null;
  const isPastDue = triggerMs <= now;
  const resolvedTriggerMs = isPastDue
    ? now + 1500
    : Math.max(triggerMs, now + 1500);

  try {
    const payloadJson =
      payload && typeof payload === "object" ? JSON.stringify(payload) : null;
    const resolvedId = await NativeAlarmModule.scheduleExactAlarm(
      String(alarmId),
      resolvedTriggerMs,
      String(title || "Task Reminder"),
      String(body || ""),
      payloadJson
    );
    const nativeId = String(resolvedId || alarmId);
    return toNativeAlarmScheduledId(nativeId);
  } catch (err) {
    warnIfDev("NativeAlarm: scheduleExactAlarm failed:", err);
    return null;
  }
}

export async function cancelNativeAlarmByScheduledId(scheduledId) {
  if (!isNativeAlarmSupported || !scheduledId) return false;
  const alarmId = fromNativeAlarmScheduledId(String(scheduledId));
  if (!alarmId) return false;
  if (typeof NativeAlarmModule.cancelExactAlarm !== "function") return false;
  try {
    return Boolean(await NativeAlarmModule.cancelExactAlarm(alarmId));
  } catch (err) {
    warnIfDev("NativeAlarm: cancelExactAlarm failed:", err);
    return false;
  }
}

export async function cancelNativeAlarmByAlarmId(alarmId) {
  if (!alarmId) return false;
  return cancelNativeAlarmByScheduledId(
    toNativeAlarmScheduledId(String(alarmId))
  );
}

export async function cancelAllNativeAlarms() {
  if (!isNativeAlarmSupported) return false;
  if (typeof NativeAlarmModule.cancelAllExactAlarms !== "function")
    return false;
  try {
    return Boolean(await NativeAlarmModule.cancelAllExactAlarms());
  } catch (err) {
    warnIfDev("NativeAlarm: cancelAllExactAlarms failed:", err);
    return false;
  }
}

export async function stopActiveNativeAlarm() {
  if (!isNativeAlarmSupported)
    return unwrapNativeResult({ status: "unsupported" });
  if (typeof NativeAlarmModule.stopActiveAlarm !== "function")
    return unwrapNativeResult({ status: "unsupported" });
  try {
    return unwrapNativeResult({
      status: "success",
      value: Boolean(await NativeAlarmModule.stopActiveAlarm()),
    });
  } catch (err) {
    warnIfDev("NativeAlarm: stopActiveAlarm failed:", err);
    return unwrapNativeResult({ status: "error", error: err });
  }
}

export async function forceStopNativeAlarm() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.forceStopAlarm !== "function")
    return { status: "unsupported" };
  try {
    return {
      status: "success",
      value: Boolean(await NativeAlarmModule.forceStopAlarm()),
    };
  } catch (err) {
    warnIfDev("NativeAlarm: forceStopAlarm failed:", err);
    return { status: "error", error: err };
  }
}

function unwrapNativeResult(result) {
  if (!result) return null;
  if (result.status === "success" && "value" in result) {
    return result.value;
  }
  if (result.status === "unsupported") {
    return false;
  }
  return null;
}

function normalizeSoundSelection(result) {
  if (!result || typeof result !== "object") return null;
  const uri = typeof result.uri === "string" ? result.uri.trim() : "";
  if (!uri) return null;
  const label =
    typeof result.label === "string" && result.label.trim()
      ? result.label.trim()
      : "Selected sound";
  const source =
    typeof result.source === "string" && result.source.trim()
      ? result.source.trim()
      : "device";
  return { uri, label, source };
}

export async function pickNativeAlarmTone(currentUri = "") {
  if (!canPickNativeAlarmTone) return null;
  const resolvedUri =
    typeof currentUri === "string" && currentUri.trim()
      ? currentUri.trim()
      : null;
  try {
    return normalizeSoundSelection(
      await NativeAlarmModule.pickAlarmTone(resolvedUri)
    );
  } catch (err) {
    warnIfDev("NativeAlarm: pickAlarmTone failed:", err);
    return null;
  }
}

export async function pickNativeAlarmAudioFile() {
  if (!canPickNativeAlarmAudioFile) return null;
  try {
    return normalizeSoundSelection(
      await NativeAlarmModule.pickAlarmAudioFile()
    );
  } catch (err) {
    warnIfDev("NativeAlarm: pickAlarmAudioFile failed:", err);
    return null;
  }
}

export async function checkAlarmPopupPermission() {
  const granted = await canUseFullScreenIntent();
  if (!granted) {
    Alert.alert(
      "Popup Alarms Disabled",
      "To see alarm popups on your lock screen, allow this app to display full-screen notifications.\\n\\nGo to Settings → Special app access → Alarms & reminders → enable this app.",
      [
        { text: "Open Settings", onPress: openFullScreenIntentSettings },
        { text: "Later", style: "cancel" },
      ]
    );
  }
}

export async function getPendingAlarmAction() {
  if (!isNativeAlarmSupported) return null;
  if (typeof NativeAlarmModule.getPendingAlarmAction !== "function")
    return null;
  try {
    const result = await NativeAlarmModule.getPendingAlarmAction();
    if (!result || typeof result !== "object") return null;
    return {
      action: typeof result.action === "string" ? result.action : null,
      alarmId: typeof result.alarmId === "string" ? result.alarmId : null,
      payloadJson:
        typeof result.payloadJson === "string" ? result.payloadJson : null,
      timestamp: typeof result.timestamp === "number" ? result.timestamp : null,
    };
  } catch (err) {
    warnIfDev("NativeAlarm: getPendingAlarmAction failed:", err);
    return null;
  }
}

export async function clearPendingAlarmAction() {
  if (!isNativeAlarmSupported) return false;
  if (typeof NativeAlarmModule.clearPendingAlarmAction !== "function")
    return false;
  try {
    return Boolean(await NativeAlarmModule.clearPendingAlarmAction());
  } catch (err) {
    warnIfDev("NativeAlarm: clearPendingAlarmAction failed:", err);
    return false;
  }
}

export async function writeAlarmAction(action, alarmId, payloadJson) {
  if (!isNativeAlarmSupported) return false;
  if (typeof NativeAlarmModule.writeAlarmAction !== "function") return false;
  try {
    return Boolean(
      await NativeAlarmModule.writeAlarmAction(
        String(action),
        String(alarmId),
        String(payloadJson || "{}")
      )
    );
  } catch (err) {
    warnIfDev("NativeAlarm: writeAlarmAction failed:", err);
    return false;
  }
}
