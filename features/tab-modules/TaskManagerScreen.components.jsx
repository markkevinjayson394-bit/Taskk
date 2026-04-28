// TaskManagerScreen.components.js
// Extracted sub-components from TaskManagerScreen.js

import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  formatDeadlineCountdown,
  getUrgencyMeta,
} from "../../utils/deadlineTime";
import {
  PRIORITY_COLOR,
  TYPE_META,
  formatEstimatedMinutes,
  getQuickSnoozePlan,
  getWorkloadLabel,
  parseDueDate,
} from "./TaskManagerScreen.helpers";

const URGENCY_VISUALS = {
  none: { bg: "#f1f5f9", icon: "calendar-clear-outline" },
  overdue: { bg: "#fee2e2", icon: "alert-circle-outline" },
  critical: { bg: "#fee2e2", icon: "alarm-outline" },
  urgent: { bg: "#fef3c7", icon: "warning-outline" },
  soon: { bg: "#dbeafe", icon: "time-outline" },
  upcoming: { bg: "#dcfce7", icon: "calendar-outline" },
};

const WORKLOAD_COLOR = {
  Light: "#22c55e",
  Moderate: "#f59e0b",
  Heavy: "#ef4444",
};

function getUrgencyPresentation(deadlineMs, nowMs) {
  const urgency = getUrgencyMeta(deadlineMs, nowMs);
  return {
    ...urgency,
    ...(URGENCY_VISUALS[urgency.severity] || URGENCY_VISUALS.none),
  };
}

export const WorkloadBanner = memo(function WorkloadBanner({ score, colors, isDark }) {
  const label = getWorkloadLabel(score);
  const color = WORKLOAD_COLOR[label] || colors.primary;
  const pct = Math.min(
    100,
    label === "Heavy" ? 100 : label === "Moderate" ? 65 : 30
  );

  return (
    <View
      style={[
        wbStyles.container,
        {
          backgroundColor: isDark ? "#1a2540" : "#f0f6ff",
          borderColor: colors.border,
        },
      ]}
    >
      <View style={wbStyles.row}>
        <Ionicons name="pulse-outline" size={14} color={color} />
        <Text style={[wbStyles.title, { color: colors.text }]}>
          Daily Workload
        </Text>
        <View style={[wbStyles.badge, { backgroundColor: color + "22" }]}>
          <Text style={[wbStyles.badgeText, { color }]}>{label}</Text>
        </View>
        <Text style={[wbStyles.score, { color }]}>{score} pts</Text>
      </View>
      <View
        style={[
          wbStyles.track,
          { backgroundColor: isDark ? "#1e293b" : "#e2e8f0" },
        ]}
      >
        <View
          style={[wbStyles.fill, { width: `${pct}%`, backgroundColor: color }]}
        />
      </View>
      <Text style={[wbStyles.hint, { color: colors.muted }]}>
        Score based on type, priority & urgency of pending tasks
      </Text>
    </View>
  );
});

const wbStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  title: { fontSize: 12, fontWeight: "700", flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  score: { fontSize: 13, fontWeight: "900" },
  track: { height: 6, borderRadius: 99, overflow: "hidden", marginBottom: 5 },
  fill: { height: "100%", borderRadius: 99 },
  hint: { fontSize: 10, fontWeight: "500" },
});

// Subject breakdown

export const SubjectBreakdown = memo(function SubjectBreakdown({
  tasks,
  colors,
  isDark,
  nowTick,
}) {
  const [open, setOpen] = useState(false);

  const subjects = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      const name = t.subjectName || t.subject || "General";
      const prev = map.get(name) || { name, count: 0, overdue: 0 };
      prev.count += 1;
      const due = parseDueDate(t.dueAt);
      if (due && due < nowTick) prev.overdue += 1;
      map.set(name, prev);
    });
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [tasks, nowTick]);

  if (subjects.length === 0) return null;

  return (
    <View
      style={[
        sbStyles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <TouchableOpacity
        style={sbStyles.header}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.8}
      >
        <Ionicons name="bar-chart-outline" size={14} color={colors.primary} />
        <Text style={[sbStyles.title, { color: colors.text }]}>By Subject</Text>
        <Text style={[sbStyles.hint, { color: colors.muted }]}>
          {subjects.length} subjects
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.muted}
        />
      </TouchableOpacity>
      {open && (
        <View style={sbStyles.body}>
          {subjects.map((s) => (
            <View key={s.name} style={sbStyles.row}>
              <Text
                style={[sbStyles.subject, { color: colors.text }]}
                numberOfLines={1}
              >
                {s.name}
              </Text>
              <View
                style={[
                  sbStyles.countPill,
                  { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                ]}
              >
                <Text style={[sbStyles.countText, { color: colors.muted }]}>
                  {s.count} task{s.count > 1 ? "s" : ""}
                </Text>
              </View>
              {s.overdue > 0 && (
                <View
                  style={[sbStyles.overduePill, { backgroundColor: "#fee2e2" }]}
                >
                  <Text style={[sbStyles.overdueText, { color: "#ef4444" }]}>
                    {s.overdue} overdue
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
});

const sbStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 7, padding: 11 },
  title: { fontSize: 12, fontWeight: "700", flex: 1 },
  hint: { fontSize: 11, fontWeight: "600" },
  body: { paddingHorizontal: 11, paddingBottom: 11, gap: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  subject: { flex: 1, fontSize: 12, fontWeight: "600" },
  countPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  countText: { fontSize: 10, fontWeight: "700" },
  overduePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  overdueText: { fontSize: 10, fontWeight: "700" },
});

// Task card

export function TaskCard({
  task,
  nowTick,
  colors,
  isDark,
  isSelected,
  isBulkMode,
  isHighlighted,
  onDone,
  onSnooze,
  onEdit,
  onDelete,
  onOpenPlanner,
  onToggleSelect,
  savingMode,
  snoozingMode,
  deletingMode,
  canEdit = true,
}) {
  const due = parseDueDate(task.dueAt);
  const urgency = getUrgencyPresentation(due?.getTime(), nowTick.getTime());
  const tm = TYPE_META[task.type] || TYPE_META.assignment;
  const pColor = PRIORITY_COLOR[task.priority] || colors.primary;
  const isPlannerLinked = task.source === "planner" && !task.plannerArchived;
  const quickSnooze = !isPlannerLinked
    ? getQuickSnoozePlan(task, nowTick)
    : null;
  const dueLabel = due
    ? formatDeadlineCountdown(due, nowTick, { style: "short" })
    : "";
  const estimate = Number(task.estimatedMinutes);
  const customReminderDate = task?.customReminderAt
    ? new Date(task.customReminderAt?.toDate?.() || task.customReminderAt)
    : null;
  const hasCustomReminder =
    customReminderDate instanceof Date &&
    !Number.isNaN(customReminderDate.getTime()) &&
    !task.completed;
  const actionDisabled = Boolean(savingMode || snoozingMode || deletingMode);
  const editDisabled = actionDisabled || !canEdit;
  const primaryActionLabel = actionDisabled
    ? savingMode
      ? "Saving..."
      : snoozingMode
        ? "Snoozing..."
        : "Deleting..."
    : "Done";

  return (
    <View
      style={[
        tcStyles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        { borderLeftColor: pColor },
        isHighlighted && { borderColor: colors.primary, borderWidth: 2 },
        isSelected && {
          borderColor: colors.primary,
          backgroundColor: isDark ? "#0d1f3c" : "#eff6ff",
        },
      ]}
    >
      {isBulkMode && (
        <TouchableOpacity
          style={tcStyles.selectCircle}
          onPress={onToggleSelect}
        >
          <View
            style={[
              tcStyles.circle,
              { borderColor: isSelected ? colors.primary : colors.border },
              isSelected && { backgroundColor: colors.primary },
            ]}
          >
            {isSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
          </View>
        </TouchableOpacity>
      )}

      <View style={tcStyles.mainContent}>
        <View style={tcStyles.topRow}>
          <View
            style={[tcStyles.iconBox, { backgroundColor: tm.color + "18" }]}
          >
            <Ionicons name={tm.icon} size={18} color={tm.color} />
          </View>

          <View style={tcStyles.body}>
            <Text
              style={[tcStyles.title, { color: colors.text }]}
              numberOfLines={2}
            >
              {task.title}
            </Text>
            <Text style={[tcStyles.subject, { color: colors.muted }]}>
              {task.subjectName || task.subject || "General"}
            </Text>

            <View style={tcStyles.metaRow}>
              <View style={[tcStyles.pill, { backgroundColor: urgency.bg }]}>
                <Ionicons name={urgency.icon} size={10} color={urgency.color} />
                <Text style={[tcStyles.pillText, { color: urgency.color }]}>
                  {urgency.label}
                </Text>
              </View>

              <View
                style={[tcStyles.pill, { backgroundColor: tm.color + "18" }]}
              >
                <Text style={[tcStyles.pillText, { color: tm.color }]}>
                  {tm.label}
                </Text>
              </View>

              {isPlannerLinked && (
                <View
                  style={[
                    tcStyles.pill,
                    { backgroundColor: isDark ? "#082f49" : "#e0f2fe" },
                  ]}
                >
                  <Ionicons
                    name="link-outline"
                    size={10}
                    color={isDark ? "#7dd3fc" : "#0369a1"}
                  />
                  <Text
                    style={[
                      tcStyles.pillText,
                      { color: isDark ? "#bae6fd" : "#0369a1" },
                    ]}
                  >
                    Planner
                  </Text>
                </View>
              )}

              {dueLabel ? (
                <View
                  style={[
                    tcStyles.pill,
                    {
                      backgroundColor:
                        due && due < nowTick
                          ? "#fee2e2"
                          : isDark
                            ? "#1e293b"
                            : "#f1f5f9",
                    },
                  ]}
                >
                  <Ionicons
                    name="time-outline"
                    size={10}
                    color={due && due < nowTick ? "#ef4444" : colors.muted}
                  />
                  <Text
                    style={[
                      tcStyles.pillText,
                      {
                        color: due && due < nowTick ? "#ef4444" : colors.muted,
                      },
                    ]}
                  >
                    {dueLabel}
                  </Text>
                </View>
              ) : null}

              {hasCustomReminder ? (
                <View
                  style={[
                    tcStyles.pill,
                    { backgroundColor: colors.primary + "18" },
                  ]}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={10}
                    color={colors.primary}
                  />
                  <Text style={[tcStyles.pillText, { color: colors.primary }]}>
                    {customReminderDate.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              ) : null}

              {Number.isFinite(estimate) && estimate > 0 && (
                <View
                  style={[
                    tcStyles.pill,
                    { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                  ]}
                >
                  <Ionicons
                    name="timer-outline"
                    size={10}
                    color={colors.muted}
                  />
                  <Text style={[tcStyles.pillText, { color: colors.muted }]}>
                    {formatEstimatedMinutes(estimate)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {!isBulkMode && (
          <View
            style={[
              tcStyles.footerRow,
              {
                borderTopColor: isDark ? "#1e293b" : "#e2e8f0",
              },
            ]}
          >
            <View style={tcStyles.secondaryActions}>
              {isPlannerLinked ? (
                <TouchableOpacity
                  style={[
                    tcStyles.secondaryBtn,
                    {
                      borderColor: colors.primary,
                      backgroundColor: isDark ? "#0f172a" : "#eff6ff",
                    },
                  ]}
                  onPress={onOpenPlanner}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={11}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      tcStyles.secondaryBtnText,
                      { color: colors.primary },
                    ]}
                  >
                    Plan
                  </Text>
                </TouchableOpacity>
              ) : quickSnooze ? (
                <TouchableOpacity
                  style={[
                    tcStyles.secondaryBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: isDark ? "#1e293b" : "#f8fafc",
                      opacity: editDisabled ? 0.6 : 1,
                    },
                  ]}
                  onPress={onSnooze}
                  disabled={actionDisabled}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="play-forward-outline"
                    size={11}
                    color={colors.text}
                  />
                  <Text
                    style={[tcStyles.secondaryBtnText, { color: colors.text }]}
                  >
                    {snoozingMode ? "..." : quickSnooze.label}
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[
                  tcStyles.secondaryBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                    opacity: editDisabled ? 0.6 : 1,
                  },
                ]}
                onPress={onEdit}
                disabled={editDisabled}
                activeOpacity={0.75}
              >
                <Ionicons name="create-outline" size={11} color={colors.text} />
                <Text
                  style={[tcStyles.secondaryBtnText, { color: colors.text }]}
                >
                  Edit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  tcStyles.secondaryBtn,
                  tcStyles.secondaryDangerBtn,
                  {
                    borderColor: "#fecaca",
                    backgroundColor: isDark ? "#3f1d1d" : "#fff1f2",
                    opacity: editDisabled ? 0.6 : 1,
                  },
                ]}
                onPress={onDelete}
                disabled={actionDisabled}
                activeOpacity={0.75}
              >
                <Ionicons name="trash-outline" size={11} color="#ef4444" />
                <Text style={[tcStyles.secondaryBtnText, { color: "#ef4444" }]}>
                  Delete
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                tcStyles.doneBtn,
                {
                  backgroundColor: pColor,
                  opacity: actionDisabled ? 0.6 : 1,
                },
              ]}
              onPress={onDone}
              disabled={actionDisabled}
              activeOpacity={0.75}
            >
              <Ionicons name="checkmark" size={13} color="#fff" />
              <Text style={tcStyles.doneText}>{primaryActionLabel}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const tcStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 11,
    marginBottom: 9,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  selectCircle: { paddingTop: 2 },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  mainContent: { flex: 1, minWidth: 0 },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "800", marginBottom: 3, lineHeight: 20 },
  subject: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  subtaskRow: { marginBottom: 6 },
  subtaskTrack: { height: 4, borderRadius: 99, overflow: "hidden" },
  subtaskFill: { height: "100%", borderRadius: 99 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: { fontSize: 10, fontWeight: "700" },
  footerRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
  },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  secondaryBtnText: { fontSize: 10, fontWeight: "800" },
  secondaryDangerBtn: { minWidth: 68 },
  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: 88,
    alignSelf: "stretch",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  doneText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});









