import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { resolveTaskDueDate } from "../utils/academicTaskModel";

function formatTaskDue(value) {
  const due = value instanceof Date ? value : null;
  if (!due) return "No due date";
  return due.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Task({ task, style, ...rest }) {
  const { colors, isDark } = useTheme();
  const title = String(task?.title || "Untitled Task").trim() || "Untitled Task";
  const subject = task?.subjectName || task?.subject || "General";
  const dueLabel = formatTaskDue(resolveTaskDueDate(task));

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: colors.primary,
        },
        style,
      ]}
      {...rest}
    >
      <View style={[styles.iconBox, { backgroundColor: `${colors.primary}18` }]}>
        <Ionicons name="book-outline" size={18} color={colors.primary} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.subject, { color: colors.muted }]} numberOfLines={1}>
          {subject}
        </Text>

        <View
          style={[
            styles.metaPill,
            {
              backgroundColor: isDark ? "#0f172a" : "#f8fafc",
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="time-outline" size={12} color={colors.muted} />
          <Text style={[styles.metaText, { color: colors.muted }]}>{dueLabel}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 12,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  subject: {
    fontSize: 12,
    fontWeight: "500",
  },
  metaPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  metaText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
