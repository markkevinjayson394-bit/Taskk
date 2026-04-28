import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { warnIfDev } from "../utils/logger";

export default function EmptyStateCard({
  title,
  message,
  icon = "alert-circle-outline",
  actionLabel,
  onAction,
  tone = "neutral",
  compact = false,
  style,
}) {
  const { colors, isDark } = useTheme();
  const borderColor = colors.border || (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)");
  const iconColor = tone === "warn"
    ? "#f59e0b"
    : tone === "danger"
      ? "#ef4444"
      : colors.muted;

  useEffect(() => {
    if (__DEV__) {
      const hasActionLabel = Boolean(actionLabel);
      const hasOnAction = typeof onAction === "function";
      if (hasActionLabel !== hasOnAction) {
        warnIfDev(
          "EmptyStateCard: actionLabel and onAction should be provided together."
        );
      }
    }
  }, [actionLabel, onAction]);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor },
        compact && styles.compact,
        style,
      ]}
    >
      <Ionicons name={icon} size={compact ? 20 : 28} color={iconColor} style={compact ? null : styles.icon} />
      <Text style={[styles.title, { color: colors.text }, compact && styles.titleCompact]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, { color: colors.muted }, compact && styles.messageCompact]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={[styles.action, { backgroundColor: colors.primary || "#3b82f6" }]}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 22,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  compact: {
    padding: 14,
    borderRadius: 14,
  },
  icon: { marginBottom: 2 },
  title: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  titleCompact: { fontSize: 13 },
  message: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  messageCompact: { fontSize: 11, lineHeight: 16 },
  action: {
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
