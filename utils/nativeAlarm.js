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

export const NATIVE_ALARM_ID_PREFIX = "native-alarm:";

export const isNativeAlarmSupported =
  hasNativeAlarmModule &&
  typeof NativeAlarmModule.scheduleExactAlarm === "function";

export const canPickNativeAlarmTone =
  hasNativeAlarmModule && typeof NativeAlarmModule.pickAlarmTone === "function";

export const canPickNativeAlarmAudioFile =
  hasNativeAlarmModule &&
  typeof NativeAlarmModule.pickAlarmAudioFile === "function";

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

export async function scheduleNativeAlarm({
  alarmId,
  triggerAt,
  title,
  body,
  payload,
}) {
  if (!isNativeAlarmSupported) return null;
  if (!alarmId) return null;
  const triggerMs = Number(triggerAt);
  if (!Number.isFinite(triggerMs) || triggerMs <= 0) return null;

  try {
    const payloadJson =
      payload && typeof payload === "object" ? JSON.stringify(payload) : null;
    const resolvedId = await NativeAlarmModule.scheduleExactAlarm(
      String(alarmId),
      triggerMs,
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
