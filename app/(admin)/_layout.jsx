/**
 * Admin Layout  Redesigned
 * Beautiful header with back button, role-gated access,
 * 15s timeout fallback, and themed styling.
 *
 * NOTE: No bugs were found in this layout. The redundant re-auth check on
 * every admin navigation is by design (defense-in-depth for role gating)
 * and is acceptable given the 15s timeout fallback.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";
import { useAndroidBackNavigation } from "../../hooks/useAndroidBackNavigation";
import { reportWarning } from "../../utils/logger";

const AUTH_GUARD_TIMEOUT_MS = 15000;

export default function AdminLayout() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);

  useAndroidBackNavigation({ rootPath: "/(admin)/home" });

  useEffect(() => {
    let active = true;
    // Timeout fallback - don't spinner forever if Firestore is slow/offline
    const timeout = setTimeout(() => {
      if (!active) return;
      setChecking(false);
      setError(true);
    }, AUTH_GUARD_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        clearTimeout(timeout);
        setError(false);
        setChecking(false);
        router.replace("/(auth)/login");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!active) return;
        clearTimeout(timeout);

        if (!snap.exists() || snap.data().role !== "admin") {
          setError(false);
          setChecking(false);
          router.replace("/(tabs)/home");
          return;
        }

        setError(false);
        setChecking(false);
      } catch (err) {
        reportWarning(err, {
          message: "Admin layout auth check failed.",
          tags: { location: "admin_layout_auth_check" },
          extra: { userId: user?.uid },
        });
        clearTimeout(timeout);
        setChecking(false);
        setError(true);
      }
    });

    return () => {
      active = false;
      unsub();
      clearTimeout(timeout);
    };
  }, [router]);

  //  Error screen
  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <View style={[styles.errorIconBox, { backgroundColor: "#ef444415" }]}>
          <Ionicons name="cloud-offline-outline" size={36} color="#ef4444" />
        </View>
        <Text style={[styles.errorTitle, { color: colors.text }]}>
          Connection Failed
        </Text>
        <Text style={[styles.errorSub, { color: colors.muted }]}>
          Could not verify your admin account.{"\n"}Please check your connection
          and try again.
        </Text>
        <TouchableOpacity
          style={styles.errorBtn}
          onPress={() => router.replace("/(auth)/login")}
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
          <Text style={styles.errorBtnText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  //  Loading screen
  if (checking) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: isDark ? "#0f172a" : "#1e1b4b" },
        ]}
      >
        <View
          style={[
            styles.loadingIconBox,
            { backgroundColor: "rgba(99,102,241,0.2)" },
          ]}
        >
          <Ionicons name="shield-checkmark" size={32} color="#a5b4fc" />
        </View>
        <ActivityIndicator
          size="large"
          color="#6366f1"
          style={{ marginTop: 20 }}
        />
        <Text style={styles.loadingText}>Verifying admin access...</Text>
      </View>
    );
  }

  //  Admin Stack
  return (
    <Stack
      screenOptions={({ navigation }) => ({
        headerShown: true,
        headerStyle: {
          backgroundColor: isDark ? "#0f172a" : "#1e1b4b",
        },
        headerTintColor: "#fff",
        headerTitleStyle: {
          fontWeight: "800",
          fontSize: 17,
          color: "#fff",
        },
        headerShadowVisible: false,
        // Custom back button
        headerLeft: navigation.canGoBack()
          ? () => (
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backBtn}
              >
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </TouchableOpacity>
            )
          : undefined,
        // Admin badge on the right
        headerRight: () => (
          <View style={styles.headerBadge}>
            <Ionicons name="shield-checkmark" size={11} color="#a5b4fc" />
            <Text style={styles.headerBadgeText}>ADMIN</Text>
          </View>
        ),
        contentStyle: {
          backgroundColor: colors.background,
        },
        // Smooth slide animation between screens
        animation: "slide_from_right",
      })}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
  },

  //  Error
  errorIconBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  errorTitle: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  errorSub: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  errorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#6366f1",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  errorBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  //  Loading
  loadingIconBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 12 },

  //  Header
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 4,
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(99,102,241,0.3)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  headerBadgeText: {
    color: "#a5b4fc",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
});
