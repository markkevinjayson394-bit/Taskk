/**
 * app/_layout.js - Root Layout
 *
 * <Stack> is always mounted to avoid early router.replace white-screen issues.
 * A full-screen overlay stays visible until both startup checks finish:
 * 1) auth route resolution
 * 2) OTA update scan resolution (or timeout)
 */
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Component, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { app, db } from "../config/firebase";
import { ThemeProvider } from "../context/ThemeContext";

function canRunStartupUpdateCheck() {
  const isExpoGo = Constants.appOwnership === "expo";

  // Skip if in development or Expo Go (expo-updates only works in standalone builds)
  if (__DEV__ || isExpoGo) return false;

  // expo-updates may not be available or properly configured
  // Return true to attempt the update check (will handle errors gracefully)
  return true;
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
    const checkResult = await withTimeout(Updates.checkForUpdateAsync(), 5000);
    if (checkResult.timedOut) return;
    if (!checkResult.value?.isAvailable) return;

    const fetchResult = await withTimeout(Updates.fetchUpdateAsync(), 12000);
    if (fetchResult.timedOut) return;

    await Updates.reloadAsync();
  } catch (err) {
    console.warn("OTA update check failed (non-blocking):", err);
  }
}

function RootLayoutNav() {
  const router = useRouter();
  const [showOverlay, setShowOverlay] = useState(true);
  const hasNavigated = useRef(false);
  const hasResolvedUpdate = useRef(false);
  const pendingRoute = useRef(null);

  useEffect(() => {
    let unsubscribe;
    let timeoutId;
    let active = true;

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

    const bootstrap = async () => {
      timeoutId = setTimeout(() => {
        if (!active) return;
        resolveRoute("/(auth)/login");
      }, 15000); // Increased from 8s to 15s to handle slow networks

      resolveStartupUpdate().finally(() => {
        if (!active) return;
        hasResolvedUpdate.current = true;
        tryNavigate();
      });

      unsubscribe = onAuthStateChanged(getAuth(app), async (user) => {
        if (!active) return;
        if (pendingRoute.current) return;
        clearTimeout(timeoutId);

        if (!user) {
          resolveRoute("/(auth)/login");
          return;
        }

        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          // If user document doesn't exist, default to student role
          const role = snap.exists() ? snap.data().role : "student";
          resolveRoute(role === "admin" ? "/(admin)/home" : "/(tabs)/home");
        } catch (err) {
          console.warn(
            "Failed to resolve user role, defaulting to tabs home:",
            err
          );
          resolveRoute("/(tabs)/home");
        }
      });
    };

    bootstrap();

    return () => {
      active = false;
      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
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

  componentDidCatch(error) {
    console.error("Unhandled error in RootErrorBoundary:", error);
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
      console.warn("Reload attempt failed:", err);
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

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootErrorBoundary>
          <RootLayoutNav />
        </RootErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

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
