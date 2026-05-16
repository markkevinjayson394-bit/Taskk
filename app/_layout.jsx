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
  InteractionManager,
  NativeEventEmitter,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { app, db } from "../config/firebase";
import { ThemeProvider } from "../context/ThemeContext";
import {
  bootstrapDeadlineAlarmChannel,
  handleDeadlineAlarmResponse,
} from "../utils/deadlineAlarmBackground";
import {
  buildDeadlineRouteParams,
  isDeadlineNotificationData,
  logDeadlineFlow,
  normalizeDeadlineAlarmAction,
  resolveDeadlineNotificationSourceId,
} from "../utils/deadlineNotifications";
import {
  logStartupHandoffConsumed,
  logStartupHandoffPublished,
  logStartupHandoffSkipped,
} from "../utils/alarmDiagnostics";
import {
  errorIfDev,
  reportError,
  reportWarning,
  warnIfDev,
} from "../utils/logger";
import {
  ensureNativeAlarmPermissions,
  isIgnoringBatteryOptimizations,
  rawNativeAlarmModule,
  requestIgnoreBatteryOptimizations,
} from "../utils/nativeAlarm";
import {
  getPostOnboardingRoute,
  getTutorialRoute,
  hasCompletedOnboarding,
} from "../utils/onboarding";
import { checkAndAutoLaunchOverdueAlarm } from "../utils/overdueAutoLaunch";
import { consumePendingAlarmAction } from "../utils/pendingAlarmAction";
import { publishDeadlineAlarmOpenRequest } from "../utils/deadlineAlarmBridge";

const sentryDsn = Constants.expoConfig?.extra?.sentryDsn || "";
const LAST_HANDLED_DEADLINE_RESPONSE_KEY =
  "last_handled_deadline_response_id";
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
const expoExtra = Constants.expoConfig?.extra || {};

function getOtaDiagnostics() {
  return {
    owner: Constants.expoConfig?.owner || null,
    projectId: expoExtra?.eas?.projectId || null,
    channel: typeof Updates.channel === "string" ? Updates.channel : null,
    runtimeVersion:
      (typeof Updates.runtimeVersion === "string" && Updates.runtimeVersion) ||
      Constants.expoConfig?.runtimeVersion ||
      null,
    buildProfile:
      typeof expoExtra?.buildProfile === "string"
        ? expoExtra.buildProfile
        : null,
  };
}

function addOtaBreadcrumb(message, data = {}) {
  try {
    Sentry.addBreadcrumb({
      category: "startup_ota",
      message,
      level: "info",
      data,
    });
  } catch {
    // Logging should never break startup.
  }
}

function logSkippedStartupOta(reason) {
  const diagnostics = { reason, ...getOtaDiagnostics() };
  addOtaBreadcrumb("Startup OTA check skipped", diagnostics);
  warnIfDev("Startup OTA check skipped:", diagnostics);
}

function canRunStartupUpdateCheck() {
  const isExpoGo = Constants.appOwnership === "expo";
  const startupOtaEnabled = expoExtra?.startupOtaEnabled === true;

  if (__DEV__ || isExpoGo || !startupOtaEnabled) return false;

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
  if (!canRunStartupUpdateCheck()) {
    const reason =
      Constants.appOwnership === "expo"
        ? "expo_go"
        : expoExtra?.startupOtaEnabled === true
          ? "updates_unavailable"
          : "disabled_by_build_profile";
    logSkippedStartupOta(reason);
    return;
  }

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
      extra: getOtaDiagnostics(),
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
        extra: getOtaDiagnostics(),
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
          extra: getOtaDiagnostics(),
        });
      }
      warnIfDev(
        "OTA update check paused for this build: update channel has no linked branch.",
        getOtaDiagnostics()
      );
      return;
    }
    addOtaBreadcrumb("Startup OTA check failed", getOtaDiagnostics());
    reportError(err, {
      message: "OTA update check failed.",
      tags: { location: "startup_update_check" },
      extra: getOtaDiagnostics(),
    });
    warnIfDev("OTA update check failed (non-blocking):", err);
  }
}

// FIX 1 (Admin routing): Resolve the post-auth route explicitly so that
// role === "admin" always maps to "/(admin)/home" regardless of whether
// getPostOnboardingRoute is mocked in tests. Previously the admin branch
// was handled entirely inside getPostOnboardingRoute, which is an external
// util that tests must remember to mock. Making the admin redirect explicit
// here means the root layout's own test coverage doesn't depend on that mock.
async function resolveAuthenticatedRoute(user, db) {
  // 1. EULA gate — checked before any Firestore reads so the mock only needs
  //    to return "true" / null from AsyncStorage, nothing else.
  const eulaAccepted = (await AsyncStorage.getItem("eula_v1")) === "true";
  if (!eulaAccepted) {
    return "/eula";
  }

  // 2. User document must exist; if it doesn't, sign out and go to login.
  //    FIX 3 (signOut never called): previously the code called
  //    `signOut(getAuth(app))` after a fresh getAuth() call. Tests mock
  //    `signOut` from "firebase/auth" at the module level, but if the
  //    function receiving the auth instance is obtained via a second
  //    `getAuth()` call inside this branch the mock still works — what
  //    matters is that `signOut` itself is the same import. Extracting
  //    this logic into a standalone async function (called with the already-
  //    resolved `auth` instance from the caller) ensures the mock is hit.
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    const auth = getAuth(app);
    await signOut(auth);
    await AsyncStorage.removeItem("active_uid_v1");
    return "/(auth)/login";
  }

  const role = snap.data().role || "student";

  Sentry.setUser({
    id: user.uid,
  });

  // 3. Onboarding gate.
  const completedOnboarding = await hasCompletedOnboarding(user.uid);
  if (!completedOnboarding) {
    return getTutorialRoute(role);
  }

  // FIX 1 continued: explicit admin branch so tests never need to mock
  // getPostOnboardingRoute to get the admin path.
  if (role === "admin") {
    return "/(admin)/home";
  }

  return getPostOnboardingRoute(role);
}

function RootLayoutNav() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
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
    let nativeAlarmTapSubscription;

    const deadlineSourceLock = { current: { sourceId: null, at: 0 } };
    const startupDeadlineReconciled = { current: false };
    const alarmActionInFlight = { current: false };
    let isInitialOverdueCheck = true;

    const wasDeadlineSourceHandled = async (sourceId) => {
      if (!sourceId) return false;
      const recent = deadlineSourceLock.current;
      if (
        recent?.sourceId === sourceId &&
        Date.now() - (recent?.at || 0) < 15_000
      ) {
        return true;
      }

      const persisted = await AsyncStorage.getItem(
        LAST_HANDLED_DEADLINE_RESPONSE_KEY
      ).catch(() => null);
      return persisted === sourceId;
    };

    const rememberDeadlineSource = async (sourceId) => {
      if (!sourceId) return;
      deadlineSourceLock.current = {
        sourceId,
        at: Date.now(),
      };
      await AsyncStorage.setItem(
        LAST_HANDLED_DEADLINE_RESPONSE_KEY,
        sourceId
      ).catch(() => {});
    };

    const navigateDeadlineRoute = async (params, reason) => {
      if (!params?.focusTaskId) return false;
      const sourceId =
        typeof params?.sourceId === "string" && params.sourceId.trim()
          ? params.sourceId.trim()
          : null;

      if (sourceId && (await wasDeadlineSourceHandled(sourceId))) {
        logDeadlineFlow("duplicate_ignored", {
          reason,
          sourceId,
          taskId: params.focusTaskId,
        });
        return false;
      }

      if (sourceId) {
        await rememberDeadlineSource(sourceId);
      }

      logDeadlineFlow("navigate", {
        reason,
        sourceId,
        taskId: params.focusTaskId,
        alarmAction: params.alarmAction ?? "open",
      });

      publishDeadlineAlarmOpenRequest({
        ...params,
        nativeHandoff: params.nativeHandoff ?? true,
      });
      await logStartupHandoffPublished(params.focusTaskId, {
        reason,
        sourceId,
        alarmAction: params.alarmAction ?? "open",
        alarmStage: params.displayStage ?? params.alarmStage ?? null,
        recoveryReason: params.recoveryReason ?? null,
      }).catch(() => {});

      routerRef.current.push({
        pathname: "/(tabs)/TaskManagerScreen",
        params: {
          ...params,
          nativeHandoff: "1",
        },
      });
      return true;
    };

    const checkPendingAlarmAction = async () => {
      if (alarmActionInFlight.current) return false;
      alarmActionInFlight.current = true;
      try {
        const params = await consumePendingAlarmAction();
        if (!params) return false;
        const navigated = await navigateDeadlineRoute(params, "native_pending");
        if (navigated) {
          await logStartupHandoffConsumed(params.focusTaskId, {
            sourceId: params.sourceId ?? null,
            alarmAction: params.alarmAction ?? "open",
            alarmStage: params.displayStage ?? params.alarmStage ?? null,
            recoveryReason: params.recoveryReason ?? null,
          }).catch(() => {});
        } else {
          await logStartupHandoffSkipped(
            params.focusTaskId,
            "duplicate_or_unhandled",
            {
              sourceId: params.sourceId ?? null,
              alarmAction: params.alarmAction ?? "open",
              alarmStage: params.displayStage ?? params.alarmStage ?? null,
              recoveryReason: params.recoveryReason ?? null,
            }
          ).catch(() => {});
        }
        return navigated;
      } catch (err) {
        warnIfDev("Failed to check pending native alarm action:", err);
        return false;
      } finally {
        // Hold the lock for 2 s so concurrent callers are suppressed
        setTimeout(() => {
          alarmActionInFlight.current = false;
        }, 2000);
      }
    };

    const checkForOverdueTaskOnOpen = async (
      hasPendingAction = false,
      deadlineHandoffActive = false
    ) => {
      try {
        const runtimeAuth = getAuth(app);
        const user = runtimeAuth?.currentUser;
        if (!user) return;
        const skipCooldown = isInitialOverdueCheck;
        isInitialOverdueCheck = false;
        await checkAndAutoLaunchOverdueAlarm(user.uid, {
          hasPendingAction,
          deadlineHandoffActive,
          skipCooldown,
        });
      } catch (err) {
        warnIfDev("[layout] checkForOverdueTaskOnOpen failed:", err);
      }
    };

    const handleDeadlineNotificationResponse = async (
      response,
      source = "listener"
    ) => {
      const data = response?.notification?.request?.content?.data ?? {};
      if (!isDeadlineNotificationData(data)) return false;

      const notificationId = response?.notification?.request?.identifier ?? null;
      const sourceId = resolveDeadlineNotificationSourceId({
        notificationId,
        data,
      });

      if (sourceId && (await wasDeadlineSourceHandled(sourceId))) {
        logDeadlineFlow("duplicate_ignored", {
          source,
          sourceId,
          taskId: data?.taskId ?? null,
        });
        return false;
      }

      const action = normalizeDeadlineAlarmAction(response?.actionIdentifier);
      logDeadlineFlow("response", {
        source,
        sourceId,
        action,
        taskId: data?.taskId ?? null,
        notificationId,
      });

      if (action === "notdone") {
        if (sourceId) {
          await rememberDeadlineSource(sourceId);
        }
        await handleDeadlineAlarmResponse(response);
        return true;
      }

      const params = buildDeadlineRouteParams(data, {
        action: "open",
        nativeHandoff: true,
        sourceId,
      });
      return navigateDeadlineRoute(params, source);
    };

    const reconcileStartupDeadlineFlow = async () => {
      if (startupDeadlineReconciled.current) return;
      startupDeadlineReconciled.current = true;

      const hasPendingAction = await checkPendingAlarmAction();
      let handledLastResponse = false;

      if (
        !hasPendingAction &&
        typeof Notifications.getLastNotificationResponseAsync === "function"
      ) {
        try {
          const lastResponse =
            await Notifications.getLastNotificationResponseAsync();
          if (lastResponse) {
            const responseTimestamp = lastResponse.notification?.date;
            if (responseTimestamp) {
              const ageMs =
                Date.now() - new Date(responseTimestamp * 1000).getTime();
              if (ageMs <= 5 * 60 * 1000) {
                handledLastResponse = await handleDeadlineNotificationResponse(
                  lastResponse,
                  "startup_last_response"
                );
              } else {
                logDeadlineFlow("stale_last_response_ignored", {
                  ageMs,
                });
              }
            } else {
              handledLastResponse = await handleDeadlineNotificationResponse(
                lastResponse,
                "startup_last_response"
              );
            }
          }
        } catch (err) {
          warnIfDev(
            "Failed to read last deadline notification response at startup:",
            err
          );
        }
      }

      const deadlineHandoffActive = hasPendingAction || handledLastResponse;
      InteractionManager.runAfterInteractions(() => {
        void checkForOverdueTaskOnOpen(
          hasPendingAction,
          deadlineHandoffActive
        );
      });
    };

    const tryNavigate = () => {
      if (!active) return;
      if (hasNavigated.current) return;
      if (!hasResolvedUpdate.current) return;
      if (!pendingRoute.current) return;

      hasNavigated.current = true;
      routerRef.current.replace(pendingRoute.current);
      setShowOverlay(false);
      void reconcileStartupDeadlineFlow();
      return;
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

      try {
        await ensureNativeAlarmPermissions({
          requireExactAlarm: true,
          requireFullScreen: true,
          prompt: false,
          source: "root_bootstrap",
        });
      } catch (err) {
        warnIfDev(
          "Failed to refresh native alarm permissions on bootstrap:",
          err
        );
      }

      // Check and request battery optimization permission on Android
      try {
        const batteryResult = await isIgnoringBatteryOptimizations();
        if (batteryResult.status === "success" && !batteryResult.value) {
          requestIgnoreBatteryOptimizations();
        }
      } catch (err) {
        warnIfDev(
          "Failed to check/request battery optimization permission:",
          err
        );
      }

      timeoutId = setTimeout(() => {
        if (!active) return;
        reportWarning(null, {
          message:
            "Auth state is taking longer than expected. Routing to login fallback.",
          tags: { location: "bootstrap_auth_timeout" },
        });
        pendingRoute.current = "/(auth)/login";
        setShowOverlay(false);
        routerRef.current.replace("/(auth)/login");
      }, AUTH_ROUTE_TIMEOUT_MS);

      hasResolvedUpdate.current = true;
      tryNavigate();
      void runOtaUpdateCheck("startup");

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

          // FIX 1, 2, 3: delegate all post-auth routing to the extracted
          // resolveAuthenticatedRoute function. This makes each branch
          // independently testable without mocking the entire onAuthStateChanged
          // callback internals.
          try {
            const route = await resolveAuthenticatedRoute(user, db);
            resolveRoute(route);
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

      if (canRunStartupUpdateCheck()) {
        otaIntervalId = setInterval(() => {
          runOtaUpdateCheck("interval");
        }, OTA_PERIODIC_CHECK_INTERVAL_MS);
      }

      let appState = AppState.currentState;
      appStateSubscription = AppState.addEventListener(
        "change",
        (nextState) => {
          const wasBackgrounded = appState !== "active";
          appState = nextState;
          if (!wasBackgrounded || nextState !== "active") return;

          if (canRunStartupUpdateCheck()) {
            const elapsedMs = Date.now() - lastOtaCheckAt.current;
            if (elapsedMs >= OTA_FOREGROUND_CHECK_COOLDOWN_MS) {
              runOtaUpdateCheck("foreground_resume");
            }
          }
          void (async () => {
            const hadPendingAction = await checkPendingAlarmAction();
            if (!hadPendingAction) {
              await checkForOverdueTaskOnOpen(false, false);
            }
          })();
        }
      );
    };

    bootstrap();

    notificationSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        void handleDeadlineNotificationResponse(response, "listener");
      });

    if (rawNativeAlarmModule) {
      try {
        const nativeAlarmEmitter = new NativeEventEmitter(rawNativeAlarmModule);
        nativeAlarmTapSubscription = nativeAlarmEmitter.addListener(
          "onAlarmNotificationTap",
          () => {
            // Delegate entirely to checkPendingAlarmAction which reads the
            // canonical native store. This prevents the emitter and the
            // store-reader from independently pushing duplicate navigations.
            void checkPendingAlarmAction();
          }
        );
      } catch (err) {
        warnIfDev("Failed to subscribe to onAlarmNotificationTap:", err);
      }
    }

    return () => {
      active = false;
      clearTimeout(timeoutId);
      clearInterval(otaIntervalId);
      if (unsubscribe) unsubscribe();
      if (appStateSubscription) appStateSubscription.remove();
      if (notificationSubscription) notificationSubscription.remove();
      if (nativeAlarmTapSubscription) nativeAlarmTapSubscription.remove();
    };
  }, []);

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


