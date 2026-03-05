import * as NavigationBar from "expo-navigation-bar";
import { Stack, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Platform, StatusBar, View,
} from "react-native";
import { auth, db } from "../config/firebase";
import { ThemeProvider } from "../context/ThemeContext";

const HIDE_AFTER_MS = 4000;

export default function RootLayout() {
  const router   = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const hideTimer = useRef(null);

  const showBars = async () => {
    if (Platform.OS !== "android") return;
    try {
      await NavigationBar.setVisibilityAsync("visible");
      await NavigationBar.setBackgroundColorAsync("#00000000");
      StatusBar.setHidden(false, "slide");
    } catch {}
  };

  const scheduleHide = () => {
    if (Platform.OS !== "android") return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(async () => {
      try {
        await NavigationBar.setVisibilityAsync("hidden");
        StatusBar.setHidden(true, "slide");
      } catch {}
    }, HIDE_AFTER_MS);
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;

    // ✅ KEY FIX: setPositionAsync("absolute") tells Android to draw the app
    // BEHIND the bars (edge-to-edge) so when bars hide, no white space is left
    NavigationBar.setPositionAsync("absolute").catch(() => {});
    NavigationBar.setBackgroundColorAsync("#00000001").catch(() => {}); // near-transparent
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});

    scheduleHide();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        showBars();
        scheduleHide();
      }
    });

    return () => {
      sub.remove();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // ── Auth gate ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      const inAuth  = segments[0] === "(auth)";
      const inAdmin = segments[0] === "(admin)";
      const inTabs  = segments[0] === "(tabs)";

      if (!user) {
        if (!inAuth) router.replace("/(auth)/login");
        setReady(true);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? snap.data().role : "student";
        if (role === "admin") {
          if (inAuth || inTabs) router.replace("/(admin)/home");
        } else {
          if (inAuth || inAdmin) router.replace("/(tabs)/home");
        }
      } catch (err) {
        console.log("Role check error:", err);
        if (inAuth) router.replace("/(tabs)/home");
      }

      setReady(true);
    });
    return unsub;
  }, [segments]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      {/* translucent=true makes status bar draw over the app, not push it down */}
      <StatusBar translucent backgroundColor="transparent" />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
