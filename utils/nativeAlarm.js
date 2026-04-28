import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
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
  hasNativeAlarmModule &&
  typeof NativeAlarmModule.pickAlarmTone === "function";

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
    return { status: "success", value: Boolean(await NativeAlarmModule.canScheduleExactAlarms()) };
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

export async function isIgnoringBatteryOptimizations() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.isIgnoringBatteryOptimizations !== "function")
    return { status: "unsupported" };
  try {
    return { status: "success", value: Boolean(await NativeAlarmModule.isIgnoringBatteryOptimizations()) };
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
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (!alarmId) return { status: "error", error: new Error("no alarmId") };
  const triggerMs = Number(triggerAt);
  if (!Number.isFinite(triggerMs) || triggerMs <= 0)
    return { status: "error", error: new Error("invalid triggerAt") };

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
    return { status: "success", value: toNativeAlarmScheduledId(nativeId) };
  } catch (err) {
    warnIfDev("NativeAlarm: scheduleExactAlarm failed:", err);
    return { status: "error", error: err };
  }
}

export async function cancelNativeAlarmByScheduledId(scheduledId) {
  if (!isNativeAlarmSupported || !scheduledId)
    return { status: "unsupported" };
  const alarmId = fromNativeAlarmScheduledId(String(scheduledId));
  if (!alarmId) return { status: "error", error: new Error("invalid scheduledId") };
  if (typeof NativeAlarmModule.cancelExactAlarm !== "function")
    return { status: "unsupported" };
  try {
    return { status: "success", value: Boolean(await NativeAlarmModule.cancelExactAlarm(alarmId)) };
  } catch (err) {
    warnIfDev("NativeAlarm: cancelExactAlarm failed:", err);
    return { status: "error", error: err };
  }
}

export async function cancelAllNativeAlarms() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.cancelAllExactAlarms !== "function")
    return { status: "unsupported" };
  try {
    return { status: "success", value: Boolean(await NativeAlarmModule.cancelAllExactAlarms()) };
  } catch (err) {
    warnIfDev("NativeAlarm: cancelAllExactAlarms failed:", err);
    return { status: "error", error: err };
  }
}

export async function stopActiveNativeAlarm() {
  if (!isNativeAlarmSupported) return { status: "unsupported" };
  if (typeof NativeAlarmModule.stopActiveAlarm !== "function")
    return { status: "unsupported" };
  try {
    return { status: "success", value: Boolean(await NativeAlarmModule.stopActiveAlarm()) };
  } catch (err) {
    warnIfDev("NativeAlarm: stopActiveAlarm failed:", err);
    return { status: "error", error: err };
  }
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
    return normalizeSoundSelection(await NativeAlarmModule.pickAlarmAudioFile());
  } catch (err) {
    warnIfDev("NativeAlarm: pickAlarmAudioFile failed:", err);
    return null;
  }
}
