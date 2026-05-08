import { notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { Vibration } from "react-native";
import { parseDueDate, resolveTaskDueDate } from "../utils/academicTaskModel";
import { formatDeadlineCountdown } from "../utils/deadlineTime";
import { warnIfDev } from "../utils/logger";
import { PRIORITY_COLOR, TYPE_META } from "../utils/taskConstants";

let Audio = null;
try {
  Audio = require("expo-av").Audio;
} catch (err) {
  warnIfDev("DeadlineAlarmModal: expo-av unavailable", err);
}

export {
  formatDeadlineCountdown,
  parseDueDate,
  resolveTaskDueDate,
  PRIORITY_COLOR,
  TYPE_META,
};

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

export async function playAlarmSound(soundRef) {
  if (!Audio) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });
    // Stop and unload any previously playing sound first to prevent orphaning
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    const { sound } = await Audio.Sound.createAsync(
      require("../assets/sounds/ctu_alarm.wav"),
      { shouldPlay: true, isLooping: true, volume: 1.0 }
    );
    soundRef.current = sound;
  } catch (err) {
    soundRef.current = null;
    console.warn("DeadlineAlarmModal: audio unavailable", err);
  }
}

export async function stopAlarmSound(soundRef) {
  try {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
  } catch (err) {
    warnIfDev("DeadlineAlarmModal: failed to stop alarm sound", err);
  }
}

// ---------------------------------------------------------------------------
// Vibration
//
// Uses React Native's Vibration API with a repeating pattern instead of a
// haptics setInterval, which was unreliable on Android and produced no
// continuous feedback. Pattern: 0ms delay → 600ms vibrate → 900ms pause,
// repeat=true keeps it looping until stopVibration() calls Vibration.cancel().
// The ref is kept so callers can guard against double-starts, but the actual
// loop is managed by the OS via Vibration.vibrate.
// ---------------------------------------------------------------------------

const VIBRATION_PATTERN = [0, 600, 900]; // [delay, vibrate, pause]

export function startVibration(ref) {
  // Guard: don't start a second loop if one is already running.
  if (ref.current) return;

  // Mark as active with a sentinel value (true) so the guard above works.
  ref.current = true;

  // Fire one haptic burst immediately for instant tactile feedback on iOS,
  // where Vibration.vibrate with repeat may not be supported.
  notificationAsync(NotificationFeedbackType.Warning).catch(() => {});

  // Start the repeating OS-level vibration (effective on Android).
  Vibration.vibrate(VIBRATION_PATTERN, /* repeat */ true);
}

export function stopVibration(ref) {
  if (ref.current) {
    Vibration.cancel();
    ref.current = null;
  }
}

// ---------------------------------------------------------------------------
// Task type helpers
// ---------------------------------------------------------------------------

export function isPlannerTask(task = {}) {
  const source =
    typeof task?.source === "string" ? task.source.trim().toLowerCase() : "";
  if (task?.plannerArchived || source === "planner") return true;
  return (
    typeof task?.plannerRef === "string" && task.plannerRef.trim().length > 0
  );
}
