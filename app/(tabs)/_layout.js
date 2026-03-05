import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { NotificationProvider } from "../../context/NotificationContext";
import { OfflineProvider } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";

export default function TabsLayout() {
  const { colors, isDark } = useTheme();

  return (
    <OfflineProvider>
      <NotificationProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 62,
              paddingBottom: 8,
              paddingTop: 6,
              elevation: 12,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -3 },
              shadowOpacity: isDark ? 0.4 : 0.08,
              shadowRadius: 10,
            },
            tabBarLabelStyle: {
              fontSize: 10,
              fontWeight: "600",
              letterSpacing: 0.3,
            },
          }}
        >
          <Tabs.Screen
            name="home"
            options={{
              title: "Home",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="home" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="schedule"
            options={{
              title: "Schedule",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="calendar" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="assignments"
            options={{
              title: "Tasks",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="checkbox" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="AnnouncementsScreen"
            options={{
              title: "News",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="megaphone" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="createAssignment"
            options={{
              title: "Add Task",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="add-circle" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: "Profile",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="person-circle" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="NotificationSettings"
            options={{
              title: "Reminders",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="notifications" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="ExamPrepPlanner"
            options={{
              title: "Exam Prep",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="school" size={size} color={color} />
              ),
            }}
          />
        </Tabs>
      </NotificationProvider>
    </OfflineProvider>
  );
}
