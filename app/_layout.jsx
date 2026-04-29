import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Component, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { app, db } from "../config/firebase";
import { ThemeProvider } from "../context/ThemeContext";
import {
  ACTION_MARK_DONE,
  ACTION_NOT_DONE,
  bootstrapDeadlineAlarmChannel,
  DEADLINE_NOTIF_TYPE,
  handleDeadlineAlarmResponse,
} from "../utils/deadlineAlarmBackground";
import {
  errorIfDev,
  reportError,
  reportWarning,
  warnIfDev,
} from "../utils/logger";
import {
  getPostOnboardingRoute,
  getTutorialRoute,
  hasCompletedOnboarding,
} from "../utils/onboarding";

const sentryDsn = Constants.expoConfig?.extra?.sentryDsn || "";

function buildSentryIntegrations() {
  const integrations = [];

  if (typeof Sentry.mobileReplayIntegration === "function") {
    try {
      integrations.push(Sentry.mobileReplayIntegration());
    } catch (error) {
      warnIfDev(
        "Sentry mobile replay integration failed to initialize:",
        error
      );
    }
  }

  if (typeof Sentry.feedbackIntegration === "function") {
    try {
      integrations.push(Sentry.feedbackIntegration());
    } catch (error) {
      warnIfDev("Sentry feedback integration failed to initialize:", error);
    }
  }

  return integrations;
}

try {
  Sentry.init({
    dsn: sentryDsn,
    enabled: Boolean(sentryDsn) && !__DEV__,
    sendDefaultPii: false,
    enableLogs: __DEV__,
    tracesSampleRate: __DEV__ ? 1 : 0.2,
    replaysSessionSampleRate: __DEV__ ? 1 : 0.1,
    replaysOnErrorSampleRate: 1,
    integrations: buildSentryIntegrations(),
  });
} catch (error) {
  warnIfDev(
    "Sentry initialization failed; continuing without Sentry startup features:",
    error
  );
}

const OTA_SKIP_UNTIL_KEY = "ota_skip_until_v1";
const OTA_CHANNEL_BACKOFF_MS = 12 * 60 * 60 * 1000;
const OTA_UPDATE_CHECK_TIMEOUT_MS = 5000;
const OTA_UPDATE_FETCH_TIMEOUT_MS = 12000;
const OTA_PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const OTA_FOREGROUND_CHECK_COOLDOWN_MS = 30 * 60 * 1000;
const AUTH_ROUTE_TIMEOUT_MS = 15000;

function canRunStartupUpdateCheck() {
  const isExpoGo = Constants.appOwnership === "expo";

  if (__DEV__ || isExpoGo) return false;

  try {
    return (
      Updates.isEnabled === true &&
      typeof Updates.checkForUpdateAsync === "function" &&
      typeof Updates.fetchUpdateAsync === "function"
    );
  } catch (err) {
    warnIfDev("Unable to determine OTA update capability:", err);
    return false;
  }
}

function isUnlinkedChannelError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("no branches linked to the channel");
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => resolve({ timedOut: true, value: null }),
      timeoutMs
    );

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve({ timedOut: false, value });
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function resolveStartupUpdate() {
  if (!canRunStartupUpdateCheck()) return;

  try {
    const raw = await AsyncStorage.getItem(OTA_SKIP_UNTIL_KEY);
    const skipUntil = Number(raw);
    if (Number.isFinite(skipUntil) && skipUntil > Date.now()) {
      return;
    }
  } catch (error) {
    reportWarning(error, {
      message: "Failed to read OTA update backoff state.",
      tags: { location: "startup_update_backoff_read" },
    });
  }

  try {
    const checkResult = await withTimeout(
      Updates.checkForUpdateAsync(),
      OTA_UPDATE_CHECK_TIMEOUT_MS
    );
    if (checkResult.timedOut) return;
    if (!checkResult.value?.isAvailable) return;

    const fetchResult = await withTimeout(
      Updates.fetchUpdateAsync(),
      OTA_UPDATE_FETCH_TIMEOUT_MS
    );
    if (fetchResult.timedOut) return;

    try {
      await AsyncStorage.removeItem(OTA_SKIP_UNTIL_KEY);
    } catch (error) {
      reportWarning(error, {
        message: "Failed to clear OTA update backoff state.",
        tags: { location: "startup_update_backoff_clear" },
      });
    }

    await Updates.reloadAsync();
  } catch (err) {
    if (isUnlinkedChannelError(err)) {
      try {
        await AsyncStorage.setItem(
          OTA_SKIP_UNTIL_KEY,
          String(Date.now() + OTA_CHANNEL_BACKOFF_MS)
        );
      } catch (error) {
        reportWarning(error, {
          message: "Failed to persist OTA channel backoff state.",
          tags: { location: "startup_update_backoff_write" },
        });
      }
      warnIfDev(
        "OTA update check paused for this build: update channel has no linked branch."
      );
      return;
    }
    reportError(err, {
      message: "OTA update check failed.",
      tags: { location: "startup_update_check" },
    });
    warnIfDev("OTA update check failed (non-blocking):", err);
  }
}

function RootLayoutNav() {
  const router = useRouter();
  const [showOverlay, setShowOverlay] = useState(true);
  const hasNavigated = useRef(false);
  const hasResolvedUpdate = useRef(false);
  const pendingRoute = useRef(null);
  const lastOtaCheckAt = useRef(0);
  const otaCheckInFlight = useRef(false);

  useEffect(() => {
    let unsubscribe;
    let timeoutId;
    let active = true;
    let notificationSubscription;
    let otaIntervalId;
    let appStateSubscription;

    const tryNavigate = () => {
      if (!active) return;
      if (hasNavigated.current) return;
      if (!hasResolvedUpdate.current) return;
      if (!pendingRoute.current) return;

      hasNavigated.current = true;
      router.replace(pendingRoute.current);
      setShowOverlay(false);
    };

    const resolveRoute = (route) => {
      if (pendingRoute.current) return;
      pendingRoute.current = route;
      tryNavigate();
    };

    const runOtaUpdateCheck = async (trigger = "unknown") => {
      if (!active) return;
      if (otaCheckInFlight.current) return;

      otaCheckInFlight.current = true;
      lastOtaCheckAt.current = Date.now();
      try {
        await resolveStartupUpdate();
      } catch (error) {
        reportWarning(error, {
          message: "Unexpected OTA update check failure.",
          tags: { location: "runtime_ota_update_check", trigger },
        });
      } finally {
        otaCheckInFlight.current = false;
      }
    };

    const bootstrap = async () => {
      await bootstrapDeadlineAlarmChannel();

      timeoutId = setTimeout(() => {
        if (!active) return;
        reportWarning(null, {
          message:
            "Auth state is taking longer than expected. Waiting for auth callback before routing.",
          tags: { location: "bootstrap_auth_timeout" },
        });
      }, AUTH_ROUTE_TIMEOUT_MS);

      runOtaUpdateCheck("startup").finally(() => {
        if (!active) return;
        hasResolvedUpdate.current = true;
        tryNavigate();
      });

      let runtimeAuth;
      try {
        runtimeAuth = getAuth(app);
      } catch (err) {
        reportError(err, {
          message: "Failed to initialize Firebase auth during bootstrap.",
          tags: { location: "bootstrap_auth_init" },
        });
        resolveRoute("/(auth)/login");
        return;
      }

      if (!runtimeAuth) {
        reportWarning(null, {
          message:
            "Firebase auth is unavailable during bootstrap; routing to login.",
          tags: { location: "bootstrap_auth_unavailable" },
        });
        resolveRoute("/(auth)/login");
        return;
      }

      try {
        unsubscribe = onAuthStateChanged(runtimeAuth, async (user) => {
          if (!active) return;
          if (pendingRoute.current) return;
          clearTimeout(timeoutId);

          if (!user) {
            Sentry.setUser(null);
            resolveRoute("/(auth)/login");
            return;
          }

          try {
            const snap = await getDoc(doc(db, "users", user.uid));
            if (!snap.exists()) {
              const auth = getAuth(app);
              await signOut(auth);
              await AsyncStorage.removeItem("active_uid_v1");
              resolveRoute("/(auth)/login");
              return;
            }
            const eulaAccepted =
              (await AsyncStorage.getItem("eula_v1")) === "true";
            if (!eulaAccepted) {
              resolveRoute("/eula");
              return;
            }
            const role = snap.data().role || "student";
            Sentry.setUser({
              id: user.uid,
              email: user.email || undefined,
            });
            const completedOnboarding = await hasCompletedOnboarding(user.uid);
            if (!completedOnboarding) {
              resolveRoute(getTutorialRoute(role));
              return;
            }
            resolveRoute(getPostOnboardingRoute(role));
          } catch (err) {
            reportError(err, {
              message: "Failed to resolve authenticated user bootstrap state.",
              tags: { location: "bootstrap_user_fetch" },
              extra: { userId: user.uid },
            });
            warnIfDev(
              "Failed to resolve user role, defaulting to tabs home:",
              err
            );
            resolveRoute("/(tabs)/home");
          }
        });
      } catch (err) {
        reportError(err, {
          message: "Failed to attach auth state listener during bootstrap.",
          tags: { location: "bootstrap_auth_listener" },
        });
        resolveRoute("/(auth)/login");
      }

      otaIntervalId = setInterval(() => {
        runOtaUpdateCheck("interval");
      }, OTA_PERIODIC_CHECK_INTERVAL_MS);

      let appState = AppState.currentState;
      appStateSubscription = AppState.addEventListener(
        "change",
        (nextState) => {
          const wasBackgrounded = appState !== "active";
          appState = nextState;
          if (!wasBackgrounded || nextState !== "active") return;

          const elapsedMs = Date.now() - lastOtaCheckAt.current;
          if (elapsedMs < OTA_FOREGROUND_CHECK_COOLDOWN_MS) return;
          runOtaUpdateCheck("foreground_resume");
        }
      );
    };

    bootstrap();

    notificationSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data ?? {};
        const action = response?.actionIdentifier;

        const isDeadlineAlarm =
          data?.type === DEADLINE_NOTIF_TYPE ||
          data?.type === "deadline" ||
          data?.notificationType === DEADLINE_NOTIF_TYPE;
        if (!isDeadlineAlarm) return;

        // Helper so we don't repeat this 3 times
        const parseDueAtMs = () => {
          const raw = Number(data?.dueAtMs);
          if (Number.isFinite(raw)) return raw;
          const fallback =
            typeof data?.dueAt === "string"
              ? new Date(data.dueAt).getTime()
              : NaN;
          return Number.isFinite(fallback) ? fallback : null;
        };

        const navigateTo = (pendingAction) => {
          const dueAtMs = parseDueAtMs();
          router.push({
            pathname: "/(tabs)/TaskManagerScreen",
            params: {
              focusTaskId: data.taskId,
              showAlarm: "1",
              ...(pendingAction ? { pendingAction } : {}),
              ...(dueAtMs !== null ? { dueAtMs: String(dueAtMs) } : {}),
            },
          });
        };

        handleDeadlineAlarmResponse(response);

        if (action === ACTION_MARK_DONE) {
          navigateTo("markdone");
          return;
        }

        if (action === ACTION_NOT_DONE) {
          navigateTo("notdone");
          return;
        }

        // Default: bare notification body tap
        navigateTo(null);
      });

    return () => {
      active = false;
      clearTimeout(timeoutId);
      clearInterval(otaIntervalId);
      if (unsubscribe) unsubscribe();
      if (appStateSubscription) appStateSubscription.remove();
      if (notificationSubscription) notificationSubscription.remove();
    };
  }, [router]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="eula"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="tutorial" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" options={{ headerShown: false }} />
      </Stack>

      {showOverlay && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
    </>
  );
}

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    reportError(error, {
      message: "Unhandled error in RootErrorBoundary.",
      tags: { location: "root_error_boundary" },
      extra: errorInfo,
    });
    errorIfDev("Unhandled error in RootErrorBoundary:", error);
  }

  handleRetry = () => {
    this.setState((prev) => ({ error: null, retryKey: prev.retryKey + 1 }));
  };

  handleReload = async () => {
    try {
      if (Updates?.reloadAsync) {
        await Updates.reloadAsync();
        return;
      }
    } catch (err) {
      reportWarning(err, {
        message: "Root error boundary reload attempt failed.",
        tags: { location: "root_error_boundary_reload" },
      });
      warnIfDev("Reload attempt failed:", err);
    }
    this.handleRetry();
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.errorRoot}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>
              The app hit an unexpected error. Try again or restart the app.
            </Text>
            <View style={styles.errorActions}>
              <TouchableOpacity
                style={[styles.errorBtn, styles.errorBtnPrimary]}
                onPress={this.handleRetry}
              >
                <Text style={styles.errorBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.errorBtn, styles.errorBtnGhost]}
                onPress={this.handleReload}
              >
                <Text style={[styles.errorBtnText, styles.errorBtnGhostText]}>
                  Restart
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View key={this.state.retryKey} style={{ flex: 1 }}>
        {this.props.children}
      </View>
    );
  }
}

export default Sentry.wrap(function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootErrorBoundary>
          <RootLayoutNav />
        </RootErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0057D9",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9998,
  },
  errorRoot: {
    flex: 1,
    backgroundColor: "#0b1020",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  errorTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  errorMessage: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  errorActions: { flexDirection: "row", gap: 10 },
  errorBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  errorBtnPrimary: { backgroundColor: "#2563eb" },
  errorBtnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  errorBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  errorBtnGhostText: { color: "#e2e8f0" },
});
