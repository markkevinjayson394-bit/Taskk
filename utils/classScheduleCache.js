import AsyncStorage from "@react-native-async-storage/async-storage";
import { warnIfDev } from "./logger";

const CLASS_SCHEDULE_LOCAL_KEY = "local_parsed_class_schedule_v1";

export async function saveLocalClassSchedule(uid, parsedClasses) {
  if (!uid || !Array.isArray(parsedClasses)) return;
  try {
    await AsyncStorage.setItem(
      `${CLASS_SCHEDULE_LOCAL_KEY}_${uid}`,
      JSON.stringify({
        savedAt: Date.now(),
        classes: parsedClasses,
      })
    );
  } catch (err) {
    warnIfDev("classScheduleCache: failed to save:", err);
  }
}

export async function loadLocalClassSchedule(uid) {
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(`${CLASS_SCHEDULE_LOCAL_KEY}_${uid}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    warnIfDev("classScheduleCache: failed to load:", err);
    return null;
  }
}

export async function clearLocalClassSchedule(uid) {
  if (!uid) return;
  try {
    await AsyncStorage.removeItem(`${CLASS_SCHEDULE_LOCAL_KEY}_${uid}`);
  } catch (err) {
    warnIfDev("classScheduleCache: failed to clear:", err);
  }
}

export async function getDaysSinceLastSync(uid) {
  const cached = await loadLocalClassSchedule(uid);
  if (!cached?.savedAt) return null;
  return (Date.now() - cached.savedAt) / (1000 * 60 * 60 * 24);
}
