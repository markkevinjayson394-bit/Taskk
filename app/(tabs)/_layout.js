/**
 * app/(tabs)/_layout.js    Student Tab Bar
 *
 * FIX: Uses useSafeAreaInsets() to push the tab bar above the device's
 * home indicator / gesture bar so app buttons never overlap the system UI.
 */
import { Ionicons } from "@expo/vector-icons";
import { Tabs, usePathname, useRouter } from "expo-router";
import { TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import UsageLimitOverlay from "../../components/UsageLimitOverlay";
import { NotificationProvider } from "../../context/NotificationContext";
import { OfflineProvider } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const showQuickAdd = !String(pathname || "").includes("/createAssignment");

  return (
    <OfflineProvider>
      <NotificationProvider>
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: isDark ? "#64748b" : "#94a3b8",
              tabBarStyle: {
                backgroundColor: colors.card,
                borderTopColor: isDark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.08)",
                borderTopWidth: 1,
                height: 58 + insets.bottom,
                paddingBottom: insets.bottom + 6,
                paddingTop: 8,
                elevation: 16,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: isDark ? 0.45 : 0.09,
                shadowRadius: 12,
              },
              tabBarLabelStyle: {
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 0.2,
              },
            }}
          >
            <Tabs.Screen
              name="home"
              options={{
                title: "Home",
                tabBarIcon: ({ color, size, focused }) => (
                  <Ionicons
                    name={focused ? "home" : "home-outline"}
                    size={size}
                    color={color}
                  />
                ),
              }}
            />
            <Tabs.Screen
              name="schedule"
              options={{
                title: "Schedule",
                tabBarIcon: ({ color, size, focused }) => (
                  <Ionicons
                    name={focused ? "calendar" : "calendar-outline"}
                    size={size}
                    color={color}
                  />
                ),
              }}
            />
            <Tabs.Screen
              name="planner"
              options={{
                title: "Planner",
                tabBarIcon: ({ color, size, focused }) => (
                  <Ionicons
                    name={focused ? "grid" : "grid-outline"}
                    size={size}
                    color={color}
                  />
                ),
              }}
            />
            <Tabs.Screen
              name="createAssignment"
              options={{
                title: "Add Task",
                tabBarIcon: ({ color, size, focused }) => (
                  <Ionicons
                    name={focused ? "add-circle" : "add-circle-outline"}
                    size={size + 4}
                    color={color}
                  />
                ),
              }}
            />
            <Tabs.Screen
              name="assignments"
              options={{
                title: "Tasks",
                tabBarIcon: ({ color, size, focused }) => (
                  <Ionicons
                    name={focused ? "checkbox" : "checkbox-outline"}
                    size={size}
                    color={color}
                  />
                ),
              }}
            />
            <Tabs.Screen
              name="profile"
              options={{
                title: "Profile",
                tabBarIcon: ({ color, size, focused }) => (
                  <Ionicons
                    name={focused ? "person-circle" : "person-circle-outline"}
                    size={size}
                    color={color}
                  />
                ),
              }}
            />
            <Tabs.Screen name="AnnouncementsScreen" options={{ href: null }} />
            <Tabs.Screen name="NotificationSettings" options={{ href: null }} />
            <Tabs.Screen name="ExamPrepPlanner" options={{ href: null }} />
            <Tabs.Screen name="appUsage" options={{ href: null }} />
          </Tabs>
          {showQuickAdd && (
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/createAssignment")}
              style={{
                position: "absolute",
                right: 16,
                bottom: insets.bottom + 72,
                width: 54,
                height: 54,
                borderRadius: 27,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.primary,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 8,
              }}
              accessibilityLabel="Quick add task"
              accessibilityHint="Opens the create assignment screen"
            >
              <Ionicons name="add" size={24} color="#fff" />
            </TouchableOpacity>
          )}
          <UsageLimitOverlay />
        </View>
      </NotificationProvider>
    </OfflineProvider>
  );
}
