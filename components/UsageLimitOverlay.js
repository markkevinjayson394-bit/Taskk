import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNotifications } from "../context/NotificationContext";
import { useTheme } from "../context/ThemeContext";

function formatMinutes(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
  if (hours > 0) return `${hours}h`;
  return `${rem}m`;
}

export default function UsageLimitOverlay() {
  const { colors, isDark } = useTheme();
  const { usageGuard, usageLimitLocked, appUsageMin, extendUsageUnlock } = useNotifications();

  if (!usageGuard?.limitEnabled || !usageLimitLocked) return null;

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Daily Usage Limit Reached</Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          You spent {formatMinutes(appUsageMin)} today. Limit is {formatMinutes(usageGuard.limitMinutes)}.
        </Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          Take a short break, then unlock if you still need study time.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => extendUsageUnlock(15)}
          >
            <Text style={styles.primaryText}>Unlock 15 min</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: isDark ? "#0f172a" : "#f8fafc" }]}
            onPress={() => extendUsageUnlock(30)}
          >
            <Text style={[styles.secondaryText, { color: colors.text }]}>Unlock 30 min</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    zIndex: 9999,
  },
  card: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  body: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 19,
    marginBottom: 2,
  },
  actions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: "center",
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
