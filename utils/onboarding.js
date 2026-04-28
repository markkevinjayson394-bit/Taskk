import AsyncStorage from "@react-native-async-storage/async-storage";
import { warnIfDev } from "./logger";

const ONBOARDING_VERSION = "v1";
const ONBOARDING_DONE_VALUE = `done_${ONBOARDING_VERSION}`;

export const ONBOARDING_DONE_KEY = (uid) =>
  `onboarding_done_${ONBOARDING_VERSION}_${uid}`;

export function getPostOnboardingRoute(role = "student") {
  return role === "admin" ? "/(admin)/home" : "/(tabs)/home";
}

export function getTutorialRoute(role = "student") {
  return `/tutorial?role=${role === "admin" ? "admin" : "student"}`;
}

export async function hasCompletedOnboarding(uid) {
  if (!uid) return false;
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_DONE_KEY(uid));
    return raw === ONBOARDING_DONE_VALUE;
  } catch (err) {
    warnIfDev("Onboarding: failed to read completion flag:", err);
    return false;
  }
}

export async function markOnboardingCompleted(uid) {
  if (!uid) return;
  try {
    await AsyncStorage.setItem(ONBOARDING_DONE_KEY(uid), ONBOARDING_DONE_VALUE);
  } catch (err) {
    warnIfDev("Onboarding: failed to persist completion flag:", err);
    // Best effort only.
  }
}
