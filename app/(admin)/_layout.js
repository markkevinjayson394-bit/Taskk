import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ActivityIndicator, TouchableOpacity, View } from "react-native";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

export default function AdminLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/(tabs)/home"); return; }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists() || snap.data().role !== "admin") {
          router.replace("/(tabs)/home"); return;
        }
      } catch {
        router.replace("/(tabs)/home"); return;
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={({ navigation }) => ({
        headerShown: true,
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700", fontSize: 17 },
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerLeft: navigation.canGoBack()
          ? () => (
              <TouchableOpacity onPress={() => navigation.goBack()}
                style={{ marginRight: 8, padding: 4 }}>
                <Ionicons name="arrow-back" size={22} color={colors.text} />
              </TouchableOpacity>
            )
          : undefined,
      })}
    />
  );
}