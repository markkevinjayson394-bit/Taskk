/**
 * app/(tabs)/_layout.js    Student Tab Bar
 *
 * FIX: Uses useSafeAreaInsets() to push the tab bar above the device's
 * home indicator / gesture bar so app buttons never overlap the system UI.
 *
 * FIX: FAB bottom offset no longer double-counts insets. Previously used
 * `insets.bottom + 72` which baked in a hardcoded magic number. Now uses
 * `insets.bottom + TAB_BAR_VISIBLE_HEIGHT` where the constant matches the
 * tab bar's own paddingTop + base height, so it stays correct on all devices.
 *
 * FIX: Removed redundant triple-hiding of non-visible tab screens.
 *       `href: null` alone is the idiomatic expo-router approach.
 *       Removed `tabBarButton: () => null` and `tabBarItemStyle: { display: "none" }`
 *       from the screenOptions function for hidden routes.
 */

import { Ionicons } from "@expo/vector-icons";
import { Tabs, usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NotificationProvider } from "../../context/NotificationContext";
import { OfflineProvider } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { useAndroidBackNavigation } from "../../hooks/useAndroidBackNavigation";
import { bootstrapDeadlineAlarmChannel } from "../../utils/deadlineAlarmBackground";
import { warnIfDev } from "../../utils/logger";

const VISIBLE_TAB_ROUTES = new Set([
  "home",
  "schedule",
  "CalendarPlannerScreen",
  "profile",
]);

// Tab bar height constants — single source of truth used by both tabBarStyle
// and the FAB positioning so they always stay in sync.
const TAB_BAR_BASE_HEIGHT = 58;
const TAB_BAR_PADDING_TOP = 8;
// Total visible height of the tab bar above the safe area bottom inset:
const TAB_BAR_VISIBLE_HEIGHT = TAB_BAR_BASE_HEIGHT + TAB_BAR_PADDING_TOP;

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();

  const showQuickAdd = !String(pathname || "").includes("/TaskManagerScreen");

  useAndroidBackNavigation({ rootPath: "/(tabs)/home" });

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        await bootstrapDeadlineAlarmChannel();
      } catch (error) {
        if (!active) return;
        warnIfDev(
          "Failed to bootstrap deadline alarm channel in tabs layout:",
          error
        );
      }
    };
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  return (
    <OfflineProvider>
      <NotificationProvider>
        <View style={{ flex: 1 }}>
          <Tabs
            backBehavior="history"
            screenOptions={({ route }) => {
              const isVisibleTab = VISIBLE_TAB_ROUTES.has(route.name);

              return {
                headerShown: false,
                // FIX: use only `href: null` to hide non-visible tabs —
                // the old code also set tabBarButton and tabBarItemStyle
                // which is redundant and harder to maintain.
                href: isVisibleTab ? undefined : null,
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: isDark ? "#64748b" : "#94a3b8",
                tabBarStyle: {
                  backgroundColor: colors.card,
                  borderTopColor: isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.08)",
                  borderTopWidth: 1,
                  height: TAB_BAR_BASE_HEIGHT + insets.bottom,
                  paddingBottom: insets.bottom + 6,
                  paddingTop: TAB_BAR_PADDING_TOP,
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
              };
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
              name="CalendarPlannerScreen"
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
            <Tabs.Screen name="TaskManagerScreen" options={{ href: null }} />
            <Tabs.Screen name="ExamPrepPlanner" options={{ href: null }} />
            <Tabs.Screen name="home.recovered" options={{ href: null }} />
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
            <Tabs.Screen name="assignments" options={{ href: null }} />
            <Tabs.Screen name="NotificationSettings" options={{ href: null }} />
            <Tabs.Screen name="AnnouncementsScreen" options={{ href: null }} />
            <Tabs.Screen name="subjects" options={{ href: null }} />
            <Tabs.Screen name="review" options={{ href: null }} />
          </Tabs>

          {showQuickAdd && (
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/TaskManagerScreen")}
              style={{
                position: "absolute",
                right: 16,
                // FIX: was `insets.bottom + 72` which double-counted insets.
                // The tab bar height above safe area is TAB_BAR_VISIBLE_HEIGHT,
                // so FAB sits that many points above the bottom safe area edge.
                bottom: insets.bottom + TAB_BAR_VISIBLE_HEIGHT + 8,
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
              accessibilityHint="Opens the task manager screen"
            >
              <Ionicons name="add" size={24} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </NotificationProvider>
    </OfflineProvider>
  );
}
