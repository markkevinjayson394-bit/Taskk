import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";
import { useNotifications } from "../context/NotificationContext";
import { warnIfDev } from "../utils/logger";

const EXACT_ALARM_STARTUP_PROMPT_KEY = "exact_alarm_startup_prompted_v1";

export function useExactAlarmStartupCheck() {
  const {
    nativeAlarmSupported,
    canScheduleExactAlarms,
    openExactAlarmSettings,
  } = useNotifications();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    if (Platform.OS !== "android" || !nativeAlarmSupported) return undefined;

    let cancelled = false;

    const run = async () => {
      const appVersion = Constants.expoConfig?.version ?? "1.0.0";

      try {
        const promptedVersion = await AsyncStorage.getItem(
          EXACT_ALARM_STARTUP_PROMPT_KEY
        );
        if (cancelled || promptedVersion === appVersion) return;

        const result = await canScheduleExactAlarms();
        if (cancelled) return;
        if (result?.status !== "success" || result.value !== false) return;

        await AsyncStorage.setItem(EXACT_ALARM_STARTUP_PROMPT_KEY, appVersion);
        if (cancelled) return;

        Alert.alert(
          "Enable Exact Alarms",
          "Exact alarm permission was reset (this happens after app updates). Your deadline alarms won't fire until you re-enable it.",
          [
            { text: "Enable Now", onPress: () => openExactAlarmSettings() },
            { text: "Later", style: "cancel" },
          ]
        );
      } catch (error) {
        if (!cancelled) {
          warnIfDev("useExactAlarmStartupCheck failed:", error);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [canScheduleExactAlarms, nativeAlarmSupported, openExactAlarmSettings]);
}
