/**
 * components/UpdateBanner.js
 *
 * Shows students a friendly banner when an OTA update is available
 * and being downloaded. Stages:
 *   1. "Checking for updates..." (brief, on app launch)
 *   2. "Update available! Downloading..." (animated progress bar)
 *   3. "Update ready! Restarting app..." (auto-restarts)
 *   4. Silent if no update found
 *
 * Usage: Mount once inside app/_layout.js inside SafeAreaProvider.
 * It floats at the top of the screen and dismisses itself automatically.
 */
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { warnIfDev } from "../utils/logger";

const STAGE = {
  IDLE: "idle",
  CHECKING: "checking",
  DOWNLOADING: "downloading",
  READY: "ready",
  UP_TO_DATE: "up_to_date",
  ERROR: "error",
};

export default function UpdateBanner() {
  const [stage, setStage] = useState(STAGE.IDLE);
  const [message, setMessage] = useState("");
  const insets = useSafeAreaInsets();

  // Slide-down animation
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timeoutsRef = useRef([]);
  const mountedRef = useRef(true);

  // Don't run in development / Expo Go where updates aren't available.
  // Constants.appOwnership === "expo"   running inside Expo Go client
  // __DEV__                             dev server (npx expo start)
  // Updates.isEnabled                   expo-updates is configured (standalone build)
  const isExpoGo = Constants.appOwnership === "expo";
  const updatesEnabled = (() => {
    try {
      return Updates.isEnabled === true;
    } catch (err) {
      warnIfDev("UpdateBanner: failed to read Updates.isEnabled:", err);
      return false;
    }
  })();
  const isUpdateAvailable = !__DEV__ && !isExpoGo && updatesEnabled;

  const scheduleTimeout = (fn, delay = 0) => {
    const timeoutId = setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter(
        (id) => id !== timeoutId
      );
      fn();
    }, delay);
    timeoutsRef.current.push(timeoutId);
    return timeoutId;
  };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      timeoutsRef.current.forEach((id) => clearTimeout(id));
      timeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!isUpdateAvailable) return;
    checkForUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pulse animation for the downloading state
  useEffect(() => {
    if (stage === STAGE.DOWNLOADING) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      // Animate progress bar from 0  90% during download (we don't get real %)
      Animated.timing(progressAnim, {
        toValue: 0.9,
        duration: 8000,
        useNativeDriver: false,
      }).start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
    if (stage === STAGE.READY) {
      // Fill progress bar to 100%
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const showBanner = (msg) => {
    setMessage(msg);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  };

  const hideBanner = (delay = 0) => {
    scheduleTimeout(() => {
      Animated.timing(slideAnim, {
        toValue: -120,
        duration: 350,
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        setStage(STAGE.IDLE);
        progressAnim.setValue(0);
      });
    }, delay);
  };

  const checkForUpdate = async () => {
    try {
      setStage(STAGE.CHECKING);
      showBanner("Checking for updates");

      const result = await Updates.checkForUpdateAsync();
      if (!mountedRef.current) return;

      if (!result.isAvailable) {
        // No update  hide banner quickly
        hideBanner(1200);
        setStage(STAGE.UP_TO_DATE);
        return;
      }

      // Update found  start downloading
      setStage(STAGE.DOWNLOADING);
      showBanner("Update available! Downloading");

      await Updates.fetchUpdateAsync();
      if (!mountedRef.current) return;

      // Download done
      setStage(STAGE.READY);
      showBanner(" Update ready! Restarting");

      // Wait a moment so the student can read it, then reload
      scheduleTimeout(async () => {
        await Updates.reloadAsync();
      }, 2000);
    } catch (_err) {
      // Silently fail  updates aren't critical UX
      hideBanner(0);
      setStage(STAGE.IDLE);
    }
  };

  // Don't render anything in dev or when idle
  if (!isUpdateAvailable || stage === STAGE.IDLE) return null;

  const isDownloading = stage === STAGE.DOWNLOADING;
  const isReady = stage === STAGE.READY;
  const isChecking = stage === STAGE.CHECKING;
  const isUpToDate = stage === STAGE.UP_TO_DATE;

  // Color based on stage
  const bgColor = isReady
    ? "#16a34a"
    : isDownloading
      ? "#0057D9"
      : isChecking
        ? "#374151"
        : "#374151";

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          backgroundColor: bgColor,
          transform: [{ translateY: slideAnim }],
          top: insets.top,
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Icon + message row */}
      <View style={styles.row}>
        <View style={styles.textCol}>
          <Text style={styles.title}>
            {isReady
              ? "App Updated!"
              : isChecking
                ? "Checking for updates"
                : "Downloading update"}
          </Text>
          <Text style={styles.sub}>{message}</Text>
        </View>
        {/* Dismiss button  only shown during checking/up-to-date */}
        {(isChecking || isUpToDate) && (
          <TouchableOpacity
            onPress={() => hideBanner(0)}
            style={styles.dismissBtn}
          >
            <Text style={styles.dismissText}></Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Progress bar  shown during download and ready */}
      {(isDownloading || isReady) && (
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
                backgroundColor: isReady ? "#86efac" : "rgba(255,255,255,0.85)",
              },
            ]}
          />
        </View>
      )}

      {/* Thin bottom glow line */}
      <Animated.View
        style={[
          styles.glowLine,
          {
            backgroundColor: isReady ? "#86efac" : "#93c5fd",
            opacity: isDownloading ? pulseAnim : 0.6,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  icon: {
    fontSize: 20,
  },
  textCol: {
    flex: 1,
  },
  title: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  sub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  dismissText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  progressTrack: {
    height: 5,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 2,
    marginBottom: 4,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  glowLine: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.6,
  },
});

