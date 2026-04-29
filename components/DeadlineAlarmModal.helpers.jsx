import {
  cancelAsync,
  notificationAsync,
  NotificationFeedbackType,
} from "expo-haptics";
import { parseDueDate } from "../utils/academicTaskModel";
import { formatDeadlineCountdown } from "../utils/deadlineTime";
import { warnIfDev } from "../utils/logger";
import { PRIORITY_COLOR, TYPE_META } from "../utils/taskConstants";
let Audio = null;
try {
  Audio = require("expo-av").Audio;
} catch (err) {
  warnIfDev("DeadlineAlarmModal: expo-av unavailable", err);
}
export { formatDeadlineCountdown, parseDueDate, PRIORITY_COLOR, TYPE_META };
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
export function startVibration(ref) {
  if (ref.current) {
    clearInterval(ref.current);
    ref.current = null;
  }
  const fire = () =>
    notificationAsync(NotificationFeedbackType.Warning).catch(() => {});
  fire();
  ref.current = setInterval(fire, 2500);
}

export function stopVibration(ref) {
  if (ref.current) {
    clearInterval(ref.current);
    ref.current = null;
  }
  cancelAsync().catch(() => {});
}
