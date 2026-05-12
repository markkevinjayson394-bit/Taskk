import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React from "react";
import {
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

function getSubjectSourceLabel(source) {
  if (source === "catalog") return "Subject List";
  if (source === "schedule_admin") return "Admin Schedule";
  if (source === "schedule") return "Schedule";
  if (source === "task") return "Recent Task";
  return "General";
}

// Reminder presets: minutes before due date
// "custom" is now a manual-offset mode, not a datetime picker
const REMINDER_PRESETS = [
  {
    key: "at_creation",
    label: "At creation",
    minutesBefore: null,
    icon: "flag-outline",
  },
  {
    key: "15min",
    label: "15 min before",
    minutesBefore: 15,
    icon: "time-outline",
  },
  {
    key: "30min",
    label: "30 min before",
    minutesBefore: 30,
    icon: "time-outline",
  },
  { key: "1h", label: "1 hr before", minutesBefore: 60, icon: "alarm-outline" },
  {
    key: "2h",
    label: "2 hrs before",
    minutesBefore: 120,
    icon: "alarm-outline",
  },
  {
    key: "4h",
    label: "4 hrs before",
    minutesBefore: 240,
    icon: "alarm-outline",
  },
  {
    key: "1d",
    label: "1 day before",
    minutesBefore: 1440,
    icon: "calendar-outline",
  },
  {
    key: "custom",
    label: "Custom offset",
    minutesBefore: "custom",
    icon: "create-outline",
  },
];

function formatTime(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function computeReminderFromPreset(preset, dueAt, createdAt) {
  if (!preset || preset.minutesBefore === "custom") return null;
  if (preset.minutesBefore === null) {
    return createdAt instanceof Date && !isNaN(createdAt.getTime())
      ? createdAt
      : new Date();
  }
  if (!(dueAt instanceof Date) || isNaN(dueAt.getTime())) return null;
  return new Date(dueAt.getTime() - preset.minutesBefore * 60 * 1000);
}

// --- NEW: Format a ms duration into a human-readable countdown ---
function formatTimeLeft(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMins = Math.ceil(ms / 60000);
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
}

// --- NEW: Urgency level from ms remaining ---
function getUrgencyLevel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "overdue";
  const h = ms / (60 * 60 * 1000);
  if (h < 2) return "critical";
  if (h < 24) return "urgent";
  if (h < 72) return "soon";
  return "comfortable";
}

const URGENCY_META = {
  overdue: { label: "Already past due", color: "#ef4444", bg: "#fee2e2" },
  critical: { label: "Due very soon", color: "#dc2626", bg: "#fee2e2" },
  urgent: { label: "Due today", color: "#d97706", bg: "#fef3c7" },
  soon: { label: "Due in a few days", color: "#2563eb", bg: "#dbeafe" },
  comfortable: { label: "Plenty of time", color: "#16a34a", bg: "#dcfce7" },
};

export default function TaskEditorModal({
  visible,
  onClose,
  colors,
  isDark,
  isEditMode,
  isSubmitting,
  taskTitle,
  onChangeTaskTitle,
  titleError,
  subjectName,
  generalSubjectLabel,
  onOpenSubjectPicker,
  showSubjectPicker,
  onCloseSubjectPicker,
  subjectPickerOptions,
  subjectPickerTitle,
  selectedSubjectId,
  onSelectSubject,
  dueAt,
  dueDateLabel,
  dueTimeLabel,
  dueDateWarning,
  dueQuickOptions,
  showDueDatePicker,
  showDueTimePicker,
  customReminderAt,
  customReminderLabel,
  customReminderLeadLabel,
  showReminderPicker,
  showClearedReminderHint,
  onOpenDueDatePicker,
  onOpenDueTimePicker,
  onOpenReminderPicker,
  onCloseReminderPicker,
  onDueDateChange,
  onDueTimeChange,
  onReminderChange,
  onClearCustomReminder,
  onApplyDueQuickOption,
  priorityOptions,
  priorityValue,
  onChangePriority,
  typeRows,
  typeMeta,
  typeValue,
  onChangeType,
  onSubmit,
  createdAt,
  activeReminderPresetKey = null,
  showReminderControls = true,
}) {
  // --- NEW: Custom offset state (hours + minutes typed by user) ---
  const [customOffsetHours, setCustomOffsetHours] = React.useState("0");
  const [customOffsetMins, setCustomOffsetMins] = React.useState("30");
  const [showCustomOffsetInput, setShowCustomOffsetInput] =
    React.useState(false);
  const [customOffsetError, setCustomOffsetError] = React.useState("");

  const activePresetKey = (() => {
    if (
      typeof activeReminderPresetKey === "string" &&
      activeReminderPresetKey
    ) {
      return activeReminderPresetKey;
    }
    if (!customReminderAt) return null;
    if (
      !(customReminderAt instanceof Date) ||
      isNaN(customReminderAt.getTime())
    ) {
      return null;
    }
    for (const preset of REMINDER_PRESETS) {
      if (preset.minutesBefore === "custom") continue;
      const computed = computeReminderFromPreset(preset, dueAt, createdAt);
      if (!computed) continue;
      const diff = Math.abs(computed.getTime() - customReminderAt.getTime());
      if (diff < 60 * 1000) return preset.key;
    }
    return "custom";
  })();

  // --- CHANGED: "custom" preset now shows inline offset inputs instead of opening a datetime picker ---
  function handlePresetSelect(preset) {
    if (preset.minutesBefore === "custom") {
      setShowCustomOffsetInput(true);
      setCustomOffsetError("");
      return;
    }
    setShowCustomOffsetInput(false);
    const computed = computeReminderFromPreset(preset, dueAt, createdAt);
    if (computed) {
      onReminderChange?.(computed, { presetKey: preset.key });
    }
  }

  // --- NEW: Apply manual offset ---
  function applyCustomOffset() {
    const h = parseInt(customOffsetHours, 10) || 0;
    const m = parseInt(customOffsetMins, 10) || 0;
    const totalMins = h * 60 + m;
    if (totalMins <= 0) {
      setCustomOffsetError("Enter at least 1 minute.");
      return;
    }
    if (!(dueAt instanceof Date) || isNaN(dueAt.getTime())) {
      setCustomOffsetError("Set a due date first.");
      return;
    }
    const reminder = new Date(dueAt.getTime() - totalMins * 60 * 1000);
    if (reminder <= new Date()) {
      setCustomOffsetError(
        "That time is already in the past. Try a smaller offset."
      );
      return;
    }
    setCustomOffsetError("");
    setShowCustomOffsetInput(false);
    onReminderChange?.(reminder, { presetKey: "custom" });
  }

  const reminderSummary = (() => {
    if (activePresetKey === "at_creation") {
      return createdAt
        ? `Reminded at creation (${formatTime(createdAt)})`
        : "Reminded at creation";
    }
    if (!customReminderAt) return null;
    const reminderTime = formatTime(customReminderAt);
    if (!dueAt) return `Remind at ${reminderTime}`;
    const diffMs = dueAt.getTime() - customReminderAt.getTime();
    if (diffMs < 0) return `Remind at ${reminderTime}`;
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60) {
      return `${diffMins} min before deadline (${reminderTime})`;
    }
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    const lead = m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${lead} before deadline — remind at ${reminderTime}`;
  })();

  // --- NEW: Time left banner calculation ---
  const timeLeftMs =
    dueAt instanceof Date && !isNaN(dueAt.getTime())
      ? dueAt.getTime() - Date.now()
      : null;
  const timeLeftLabel = timeLeftMs !== null ? formatTimeLeft(timeLeftMs) : null;
  const urgency = timeLeftMs !== null ? getUrgencyLevel(timeLeftMs) : null;
  const urgencyMeta = urgency ? URGENCY_META[urgency] : null;
  const dueIsPast =
    dueAt instanceof Date &&
    !isNaN(dueAt.getTime()) &&
    dueAt.getTime() <= Date.now();
  const showReminderSection = showReminderControls && !dueIsPast;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <Text style={[styles.title, { color: colors.text }]}>
                {isEditMode ? "Edit Task" : "Create New Task"}
              </Text>
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                {isEditMode
                  ? "Update title, subject, due date, priority, and type."
                  : showReminderControls
                    ? "Quick add from Task Manager. Choose a preset or set the exact due date and time."
                    : "Quick add from Task Manager. Lead-time reminders are automatic before the due time."}
              </Text>

              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: titleError ? "#ef4444" : colors.border,
                  },
                ]}
                placeholder="Task title"
                placeholderTextColor={colors.muted}
                value={taskTitle}
                onChangeText={onChangeTaskTitle}
                editable={!isSubmitting}
                autoFocus={!isEditMode}
              />
              {titleError && (
                <Text style={styles.titleErrorText}>{titleError}</Text>
              )}

              <TouchableOpacity
                style={[
                  styles.subjectTrigger,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
                onPress={onOpenSubjectPicker}
                disabled={isSubmitting}
                activeOpacity={0.75}
              >
                <View style={styles.subjectTriggerLeft}>
                  <Ionicons
                    name="book-outline"
                    size={15}
                    color={colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.subjectLabel, { color: colors.muted }]}
                    >
                      Subject
                    </Text>
                    <Text
                      style={[styles.subjectValue, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {subjectName || generalSubjectLabel}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={colors.muted}
                />
              </TouchableOpacity>

              {/* Due Date & Time Row */}
              <View style={styles.dueRow}>
                <TouchableOpacity
                  style={[
                    styles.dueButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={onOpenDueDatePicker}
                  disabled={isSubmitting}
                >
                  <View style={styles.dueLabelRow}>
                    <Ionicons
                      name="calendar-outline"
                      size={13}
                      color={colors.muted}
                    />
                    <Text style={[styles.dueLabel, { color: colors.muted }]}>
                      Due Date
                    </Text>
                  </View>
                  <Text style={[styles.dueValue, { color: colors.text }]}>
                    {dueDateLabel}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.dueButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={onOpenDueTimePicker}
                  disabled={isSubmitting}
                >
                  <View style={styles.dueLabelRow}>
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color={colors.muted}
                    />
                    <Text style={[styles.dueLabel, { color: colors.muted }]}>
                      Due Time
                    </Text>
                  </View>
                  <Text style={[styles.dueValue, { color: colors.text }]}>
                    {dueTimeLabel}
                  </Text>
                </TouchableOpacity>
              </View>

              {dueDateWarning && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 8,
                    marginBottom: 8,
                    backgroundColor:
                      dueDateWarning.type === "error" ? "#fee2e2" : "#fef3c7",
                  }}
                >
                  <Ionicons
                    name={
                      dueDateWarning.type === "error"
                        ? "alert-circle-outline"
                        : "warning-outline"
                    }
                    size={14}
                    color={
                      dueDateWarning.type === "error" ? "#ef4444" : "#f59e0b"
                    }
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color:
                        dueDateWarning.type === "error" ? "#b91c1c" : "#b45309",
                      flex: 1,
                    }}
                  >
                    {dueDateWarning.text}
                  </Text>
                </View>
              )}

              {/* Quick due presets */}
              {Array.isArray(dueQuickOptions) && dueQuickOptions.length > 0 && (
                <View style={styles.duePresetRow}>
                  {dueQuickOptions.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[
                        styles.duePresetChip,
                        {
                          borderColor: colors.border,
                          backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                        },
                      ]}
                      onPress={() => onApplyDueQuickOption(option)}
                      disabled={isSubmitting}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[styles.duePresetText, { color: colors.text }]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* FIX: Defer iOS picker initialization until needed */}
              {showDueDatePicker && Platform.OS !== "ios" && (
                <DateTimePicker
                  value={dueAt}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  minimumDate={new Date()}
                  onChange={onDueDateChange}
                />
              )}
              {showDueDatePicker && Platform.OS === "ios" && (
                <DateTimePicker
                  value={dueAt}
                  mode="date"
                  display="spinner"
                  minimumDate={new Date()}
                  onChange={onDueDateChange}
                />
              )}
              {showDueTimePicker && Platform.OS !== "ios" && (
                <DateTimePicker
                  value={dueAt}
                  mode="time"
                  display="default"
                  onChange={onDueTimeChange}
                />
              )}
              {showDueTimePicker && Platform.OS === "ios" && (
                <DateTimePicker
                  value={dueAt}
                  mode="time"
                  display="spinner"
                  onChange={onDueTimeChange}
                />
              )}

              {/* --- NEW: Time Left Banner --- */}
              {timeLeftLabel && urgencyMeta && (
                <View
                  style={[
                    styles.timeLeftBanner,
                    { backgroundColor: urgencyMeta.bg },
                  ]}
                >
                  <Ionicons
                    name={
                      urgency === "overdue"
                        ? "alert-circle-outline"
                        : urgency === "critical"
                          ? "alarm-outline"
                          : urgency === "urgent"
                            ? "warning-outline"
                            : "time-outline"
                    }
                    size={14}
                    color={urgencyMeta.color}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.timeLeftLabel,
                        { color: urgencyMeta.color },
                      ]}
                    >
                      {timeLeftMs <= 0
                        ? "Task is already overdue"
                        : `${timeLeftLabel} until deadline`}
                    </Text>
                    <Text
                      style={[styles.timeLeftSub, { color: urgencyMeta.color }]}
                    >
                      {urgencyMeta.label}
                    </Text>
                  </View>
                </View>
              )}

              {!showReminderControls && !dueIsPast && (
                <View
                  style={[
                    styles.timeLeftBanner,
                    {
                      backgroundColor: isDark ? "#0f172a" : "#eff6ff",
                      marginBottom: 12,
                    },
                  ]}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={14}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.timeLeftLabel, { color: colors.primary }]}
                    >
                      Fixed reminders only
                    </Text>
                    <Text
                      style={[styles.timeLeftSub, { color: colors.primary }]}
                    >
                      This task will use the standard lead-time alerts before it
                      becomes due.
                    </Text>
                  </View>
                </View>
              )}

              {/* Flexible Reminder Section */}
              {showReminderSection && (
                <View style={styles.reminderSection}>
                  <View style={styles.reminderSectionHeader}>
                    <Ionicons
                      name="notifications-outline"
                      size={14}
                      color={customReminderAt ? colors.primary : colors.muted}
                    />
                    <Text
                      style={[styles.sectionLabel, { color: colors.muted }]}
                    >
                      Remind me
                    </Text>
                    {customReminderAt && (
                      <TouchableOpacity
                        style={styles.clearReminderBtn}
                        onPress={() => {
                          onClearCustomReminder?.();
                          setShowCustomOffsetInput(false);
                          setCustomOffsetError("");
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        disabled={isSubmitting}
                      >
                        <Ionicons
                          name="close-circle"
                          size={16}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Only show the "cleared" hint in edit mode with a previously set reminder */}
                  {isEditMode && showClearedReminderHint ? (
                    <Text
                      style={[
                        styles.clearedReminderText,
                        { color: colors.muted },
                      ]}
                    >
                      Previous reminder was cleared. Set a new one below.
                    </Text>
                  ) : null}

                  {/* Deadline context line */}
                  {dueAt && (
                    <View
                      style={[
                        styles.deadlineContext,
                        {
                          backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Ionicons name="flag-outline" size={12} color="#ef4444" />
                      <Text
                        style={[
                          styles.deadlineContextText,
                          { color: colors.muted },
                        ]}
                      >
                        Deadline:{" "}
                        <Text style={{ color: colors.text, fontWeight: "700" }}>
                          {formatTime(dueAt)}
                        </Text>
                      </Text>
                      {createdAt && (
                        <>
                          <Text
                            style={[
                              styles.deadlineContextDot,
                              { color: colors.muted },
                            ]}
                          >
                            ·
                          </Text>
                          <Ionicons
                            name="add-circle-outline"
                            size={12}
                            color={colors.muted}
                          />
                          <Text
                            style={[
                              styles.deadlineContextText,
                              { color: colors.muted },
                            ]}
                          >
                            Created:{" "}
                            <Text
                              style={{ color: colors.text, fontWeight: "600" }}
                            >
                              {formatTime(createdAt)}
                            </Text>
                          </Text>
                        </>
                      )}
                    </View>
                  )}

                  {/* Preset chips grid */}
                  <View style={styles.reminderPresets}>
                    {REMINDER_PRESETS.map((preset) => {
                      const isActive = activePresetKey === preset.key;

                      if (
                        preset.minutesBefore !== "custom" &&
                        preset.minutesBefore !== null
                      ) {
                        const computed = computeReminderFromPreset(
                          preset,
                          dueAt,
                          createdAt
                        );
                        if (computed && computed.getTime() <= Date.now()) {
                          return null;
                        }
                      }

                      let previewTime = null;
                      if (
                        preset.minutesBefore !== "custom" &&
                        preset.minutesBefore !== null &&
                        dueAt
                      ) {
                        const computed = computeReminderFromPreset(
                          preset,
                          dueAt,
                          createdAt
                        );
                        if (computed) {
                          previewTime = computed.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          });
                        }
                      }

                      return (
                        <TouchableOpacity
                          key={preset.key}
                          style={[
                            styles.reminderPresetChip,
                            {
                              borderColor: isActive
                                ? colors.primary
                                : colors.border,
                              backgroundColor: isActive
                                ? colors.primary + "18"
                                : isDark
                                  ? "#0f172a"
                                  : "#f8fafc",
                            },
                          ]}
                          onPress={() => handlePresetSelect(preset)}
                          disabled={isSubmitting}
                          activeOpacity={0.75}
                        >
                          <Ionicons
                            name={preset.icon}
                            size={12}
                            color={isActive ? colors.primary : colors.muted}
                          />
                          <View style={styles.reminderPresetTextWrap}>
                            <Text
                              style={[
                                styles.reminderPresetLabel,
                                {
                                  color: isActive
                                    ? colors.primary
                                    : colors.text,
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {preset.label}
                            </Text>
                            {previewTime && (
                              <Text
                                style={[
                                  styles.reminderPresetTime,
                                  {
                                    color: isActive
                                      ? colors.primary
                                      : colors.muted,
                                  },
                                ]}
                                numberOfLines={1}
                              >
                                {previewTime}
                              </Text>
                            )}
                          </View>
                          {isActive && (
                            <Ionicons
                              name="checkmark-circle"
                              size={13}
                              color={colors.primary}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* --- NEW: Inline custom offset input (shown when "Custom offset" is tapped) --- */}
                  {showCustomOffsetInput && (
                    <View
                      style={[
                        styles.customOffsetBox,
                        {
                          backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.customOffsetTitle,
                          { color: colors.text },
                        ]}
                      >
                        Remind me before due date
                      </Text>
                      <View style={styles.customOffsetRow}>
                        <View style={styles.customOffsetField}>
                          <TextInput
                            style={[
                              styles.customOffsetInput,
                              {
                                color: colors.text,
                                borderColor: customOffsetError
                                  ? "#ef4444"
                                  : colors.border,
                                backgroundColor: colors.card,
                              },
                            ]}
                            keyboardType="number-pad"
                            value={customOffsetHours}
                            onChangeText={(v) => {
                              setCustomOffsetHours(v.replace(/[^0-9]/g, ""));
                              setCustomOffsetError("");
                            }}
                            maxLength={3}
                            editable={!isSubmitting}
                            selectTextOnFocus
                          />
                          <Text
                            style={[
                              styles.customOffsetUnit,
                              { color: colors.muted },
                            ]}
                          >
                            hours
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.customOffsetSep,
                            { color: colors.muted },
                          ]}
                        >
                          +
                        </Text>
                        <View style={styles.customOffsetField}>
                          <TextInput
                            style={[
                              styles.customOffsetInput,
                              {
                                color: colors.text,
                                borderColor: customOffsetError
                                  ? "#ef4444"
                                  : colors.border,
                                backgroundColor: colors.card,
                              },
                            ]}
                            keyboardType="number-pad"
                            value={customOffsetMins}
                            onChangeText={(v) => {
                              setCustomOffsetMins(v.replace(/[^0-9]/g, ""));
                              setCustomOffsetError("");
                            }}
                            maxLength={3}
                            editable={!isSubmitting}
                            selectTextOnFocus
                          />
                          <Text
                            style={[
                              styles.customOffsetUnit,
                              { color: colors.muted },
                            ]}
                          >
                            min
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.customOffsetApplyBtn,
                            { backgroundColor: colors.primary },
                          ]}
                          onPress={applyCustomOffset}
                          disabled={isSubmitting}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.customOffsetApplyText}>Set</Text>
                        </TouchableOpacity>
                      </View>
                      {customOffsetError ? (
                        <Text style={styles.customOffsetError}>
                          {customOffsetError}
                        </Text>
                      ) : (
                        <Text
                          style={[
                            styles.customOffsetHint,
                            { color: colors.muted },
                          ]}
                        >
                          Enter how long before the deadline to be reminded.
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Active reminder summary */}
                  {reminderSummary && (
                    <View
                      style={[
                        styles.reminderSummaryBox,
                        {
                          backgroundColor: colors.primary + "12",
                          borderColor: colors.primary + "40",
                        },
                      ]}
                    >
                      <Ionicons
                        name="notifications"
                        size={13}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.reminderSummaryText,
                          { color: colors.primary },
                        ]}
                      >
                        {reminderSummary}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Priority */}
              <View style={styles.priorityRow}>
                {priorityOptions.map((option) => {
                  const active = priorityValue === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.priorityButton,
                        {
                          borderColor: active ? option.color : colors.border,
                          backgroundColor: active ? option.color : colors.card,
                        },
                      ]}
                      onPress={() => onChangePriority(option.value)}
                      disabled={isSubmitting}
                    >
                      <Text
                        style={[
                          styles.priorityButtonText,
                          { color: active ? "#fff" : colors.text },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Type rows */}
              {typeRows.map((row, rowIndex) => (
                <View key={String(rowIndex)} style={styles.typeRow}>
                  {row.map((type) => {
                    const meta = typeMeta[type];
                    const active = typeValue === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.typeButton,
                          {
                            borderColor: active ? meta.color : colors.border,
                            backgroundColor: active
                              ? `${meta.color}22`
                              : colors.card,
                          },
                        ]}
                        onPress={() => onChangeType(type)}
                        disabled={isSubmitting}
                      >
                        <Ionicons
                          name={meta.icon}
                          size={20}
                          color={meta.color}
                        />
                        <Text
                          style={[
                            styles.typeButtonText,
                            { color: active ? meta.color : colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {meta.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[
                    styles.cancelButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={onClose}
                  disabled={isSubmitting}
                >
                  <Text
                    style={[styles.cancelButtonText, { color: colors.muted }]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: isSubmitting ? 0.65 : 1,
                    },
                  ]}
                  onPress={onSubmit}
                  disabled={isSubmitting}
                >
                  <Text style={styles.submitButtonText}>
                    {isSubmitting
                      ? isEditMode
                        ? "Saving..."
                        : "Creating..."
                      : isEditMode
                        ? "Save Changes"
                        : "Create"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* iOS custom datetime picker — kept for at_creation / fallback edge cases,
          but "Custom offset" preset no longer uses this. Only reached via
          onOpenReminderPicker called externally if needed. */}
      {Platform.OS === "ios" && showReminderControls && showReminderPicker ? (
        <Modal
          transparent
          animationType="slide"
          visible={showReminderPicker}
          onRequestClose={onCloseReminderPicker}
        >
          <View style={styles.overlay}>
            <View
              style={[
                styles.reminderModalCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.reminderModalTitle, { color: colors.text }]}>
                Set Custom Reminder
              </Text>
              <Text
                style={[styles.reminderModalSubtitle, { color: colors.muted }]}
              >
                Pick any time before your deadline
              </Text>
              <DateTimePicker
                // FIXED: guard against invalid dueAt before passing maximumDate
                value={
                  customReminderAt instanceof Date &&
                  !isNaN(customReminderAt.getTime())
                    ? customReminderAt
                    : new Date()
                }
                mode="datetime"
                minimumDate={new Date()}
                maximumDate={
                  dueAt instanceof Date &&
                  !isNaN(dueAt.getTime()) &&
                  dueAt > new Date()
                    ? dueAt
                    : undefined
                }
                display="spinner"
                onChange={(_event, selected) => {
                  if (!selected) return;
                  onReminderChange?.(selected);
                }}
              />
              <TouchableOpacity
                style={[
                  styles.reminderConfirmButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={onCloseReminderPicker}
                disabled={isSubmitting}
              >
                <Text style={styles.reminderConfirmText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.reminderCancelButton,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
                onPress={onCloseReminderPicker}
                disabled={isSubmitting}
              >
                <Text
                  style={[styles.reminderCancelText, { color: colors.muted }]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Subject picker modal */}
      <Modal
        visible={showSubjectPicker}
        transparent
        animationType="fade"
        onRequestClose={onCloseSubjectPicker}
      >
        <View style={styles.overlay}>
          <View
            style={[
              styles.subjectCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.subjectHeader}>
              <Text style={[styles.subjectTitle, { color: colors.text }]}>
                {subjectPickerTitle || "Select Subject"}
              </Text>
              <TouchableOpacity
                onPress={onCloseSubjectPicker}
                style={styles.subjectClose}
              >
                <Ionicons name="close" size={18} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.subjectList}
              contentContainerStyle={styles.subjectListContent}
              showsVerticalScrollIndicator={false}
            >
              {subjectPickerOptions.length === 0 ? (
                <View
                  style={[
                    styles.subjectEmpty,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[styles.subjectEmptyTitle, { color: colors.text }]}
                  >
                    No subjects available yet
                  </Text>
                  <Text
                    style={[styles.subjectEmptyMeta, { color: colors.muted }]}
                  >
                    Add schedule subjects first, then try again.
                  </Text>
                </View>
              ) : (
                subjectPickerOptions.map((option) => {
                  const isSelected = option.id === selectedSubjectId;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.subjectOption,
                        {
                          borderColor: isSelected
                            ? colors.primary
                            : colors.border,
                          backgroundColor: isSelected
                            ? isDark
                              ? "#0f172a"
                              : "#eff6ff"
                            : colors.card,
                        },
                      ]}
                      onPress={() => onSelectSubject(option)}
                    >
                      <View style={styles.subjectOptionMain}>
                        <Text
                          style={[
                            styles.subjectOptionText,
                            { color: colors.text },
                          ]}
                        >
                          {option.name}
                        </Text>
                        <Text
                          style={[
                            styles.subjectOptionMeta,
                            { color: colors.muted },
                          ]}
                        >
                          {getSubjectSourceLabel(option.source)}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                      ) : (
                        <Ionicons
                          name="ellipse-outline"
                          size={18}
                          color={colors.border}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
    maxHeight: "92%",
    width: "100%",
    maxWidth: 420,
  },
  title: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  subtitle: { fontSize: 12, fontWeight: "500", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  titleErrorText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ef4444",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  subjectTrigger: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  subjectTriggerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  subjectLabel: { fontSize: 11, fontWeight: "600", marginBottom: 1 },
  subjectValue: { fontSize: 14, fontWeight: "700" },
  dueRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  dueButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  dueLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  dueLabel: { fontSize: 11, fontWeight: "600" },
  dueValue: { fontSize: 13, fontWeight: "700" },
  duePresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  duePresetChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  duePresetText: { fontSize: 11, fontWeight: "700" },

  // --- NEW: Time left banner ---
  timeLeftBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  timeLeftLabel: { fontSize: 13, fontWeight: "800", lineHeight: 16 },
  timeLeftSub: { fontSize: 10, fontWeight: "600", marginTop: 1, opacity: 0.8 },
  dueWarningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  dueWarningText: { fontSize: 12, fontWeight: "700", flex: 1 },

  // Reminder Section
  reminderSection: { marginBottom: 12 },
  reminderSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  sectionLabel: { fontSize: 11, fontWeight: "700", flex: 1 },
  clearReminderBtn: { padding: 2 },
  clearedReminderText: { fontSize: 11, fontWeight: "600", marginBottom: 6 },
  deadlineContext: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  deadlineContextText: { fontSize: 11, fontWeight: "500" },
  deadlineContextDot: { fontSize: 11, marginHorizontal: 2 },
  reminderPresets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 8,
  },
  reminderPresetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    minWidth: "45%",
    flexGrow: 1,
  },
  reminderPresetTextWrap: { flex: 1, minWidth: 0 },
  reminderPresetLabel: { fontSize: 11, fontWeight: "700", lineHeight: 14 },
  reminderPresetTime: { fontSize: 10, fontWeight: "600", marginTop: 1 },

  // --- NEW: Custom offset inline input ---
  customOffsetBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  customOffsetTitle: { fontSize: 12, fontWeight: "700", marginBottom: 10 },
  customOffsetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  customOffsetField: { alignItems: "center", gap: 4 },
  customOffsetInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    width: 64,
  },
  customOffsetUnit: { fontSize: 11, fontWeight: "600" },
  customOffsetSep: { fontSize: 18, fontWeight: "700", marginTop: -10 },
  customOffsetApplyBtn: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: 4,
    alignSelf: "flex-start",
    marginTop: -2,
  },
  customOffsetApplyText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  customOffsetError: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ef4444",
  },
  customOffsetHint: { fontSize: 11, fontWeight: "500" },

  reminderSummaryBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 2,
    marginBottom: 2,
  },
  reminderSummaryText: { fontSize: 12, fontWeight: "700", flex: 1 },
  priorityRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  priorityButton: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  priorityButtonText: { fontSize: 13, fontWeight: "700" },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  typeButton: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 64,
  },
  typeButtonText: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelButtonText: { fontSize: 13, fontWeight: "700" },
  submitButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  reminderModalCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    width: "100%",
    maxWidth: 420,
  },
  reminderModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
    textAlign: "center",
  },
  reminderModalSubtitle: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 12,
    textAlign: "center",
  },
  reminderConfirmButton: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  reminderConfirmText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  reminderCancelButton: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  reminderCancelText: { fontSize: 13, fontWeight: "700" },
  subjectCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    width: "100%",
    maxWidth: 420,
    minHeight: 220,
    maxHeight: "86%",
  },
  subjectHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  subjectTitle: { fontSize: 16, fontWeight: "800" },
  subjectClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  subjectList: { marginBottom: 10, minHeight: 72, maxHeight: 320 },
  subjectListContent: { gap: 8, paddingBottom: 2 },
  subjectEmpty: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 4,
  },
  subjectEmptyTitle: { fontSize: 13, fontWeight: "700" },
  subjectEmptyMeta: { fontSize: 11, fontWeight: "600" },
  subjectOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  subjectOptionMain: { flex: 1 },
  subjectOptionText: { fontSize: 13, fontWeight: "700", marginBottom: 1 },
  subjectOptionMeta: { fontSize: 10, fontWeight: "600" },
});
