import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
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
    label: "Custom time",
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
    // "At creation" — use now/createdAt
    return createdAt instanceof Date && !isNaN(createdAt.getTime())
      ? createdAt
      : new Date();
  }
  if (!(dueAt instanceof Date) || isNaN(dueAt.getTime())) return null;
  const reminder = new Date(dueAt.getTime() - preset.minutesBefore * 60 * 1000);
  return reminder;
}

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
  // optional: pass createdAt for "at creation" preset display
  createdAt,
}) {
  // Determine which preset is currently active
  const activePresetKey = (() => {
    if (!customReminderAt) return null;
    if (
      !(customReminderAt instanceof Date) ||
      isNaN(customReminderAt.getTime())
    )
      return null;

    for (const preset of REMINDER_PRESETS) {
      if (preset.minutesBefore === "custom") continue;
      const computed = computeReminderFromPreset(preset, dueAt, createdAt);
      if (!computed) continue;
      const diff = Math.abs(computed.getTime() - customReminderAt.getTime());
      if (diff < 60 * 1000) return preset.key; // within 1 minute tolerance
    }
    return "custom";
  })();

  function handlePresetSelect(preset) {
    if (preset.minutesBefore === "custom") {
      onOpenReminderPicker?.();
      return;
    }
    const computed = computeReminderFromPreset(preset, dueAt, createdAt);
    if (computed) {
      onReminderChange?.(computed);
    }
  }

  // Build a summary line for the selected reminder
  const reminderSummary = (() => {
    if (!customReminderAt) return null;
    const reminderTime = formatTime(customReminderAt);
    if (!dueAt) return `Remind at ${reminderTime}`;
    const diffMs = dueAt.getTime() - customReminderAt.getTime();
    if (diffMs < 0) return `Remind at ${reminderTime}`;
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60)
      return `${diffMins} min before deadline (${reminderTime})`;
    const h = Math.floor(diffMins / 60),
      m = diffMins % 60;
    const lead = m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${lead} before deadline · remind at ${reminderTime}`;
  })();

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
                  : "Quick add from Task Manager. Choose a preset or set the exact due date and time."}
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

              {showDueDatePicker && (
                <DateTimePicker
                  value={dueAt}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  minimumDate={new Date()}
                  onChange={onDueDateChange}
                />
              )}
              {showDueTimePicker && (
                <DateTimePicker
                  value={dueAt}
                  mode="time"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={onDueTimeChange}
                />
              )}

              {/* ── Flexible Reminder Section ── */}
              <View style={styles.reminderSection}>
                <View style={styles.reminderSectionHeader}>
                  <Ionicons
                    name="notifications-outline"
                    size={14}
                    color={customReminderAt ? colors.primary : colors.muted}
                  />
                  <Text style={[styles.sectionLabel, { color: colors.muted }]}>
                    Remind me
                  </Text>
                  {customReminderAt && (
                    <TouchableOpacity
                      style={styles.clearReminderBtn}
                      onPress={onClearCustomReminder}
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

                {showClearedReminderHint ? (
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
                    // Compute what time this preset would fire
                    let previewTime = null;
                    if (preset.minutesBefore !== "custom" && dueAt) {
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
                                color: isActive ? colors.primary : colors.text,
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

      {/* iOS custom datetime picker */}
      {Platform.OS === "ios" && showReminderPicker ? (
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
                value={customReminderAt || new Date()}
                mode="datetime"
                minimumDate={new Date()}
                maximumDate={dueAt}
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

  // ── Reminder Section ──
  reminderSection: {
    marginBottom: 12,
  },
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
