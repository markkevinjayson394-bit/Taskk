import { Stack, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth } from "../config/firebase";
import { ThemeProvider } from "../context/ThemeContext";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      const inAuth = segments[0] === "(auth)";

      // FIX #7: handle both directions of auth redirect
      if (user && inAuth) {
        // Logged-in user trying to access login/register — send them home
        router.replace("/(tabs)/home");
      } else if (!user && !inAuth) {
        // Unauthenticated user trying to access protected screen
        router.replace("/(auth)/login");
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
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}




