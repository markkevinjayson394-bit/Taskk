// CalendarPlannerScreen.components.js
// Extracted React components (PlanCard, CalendarGrid, PlannerModal, WorkflowCard)

import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import {
    Modal,
    Platform,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import {
    formatTime12,
    getDaysInMonth,
    getFirstDayOfMonth,
    PRIORITIES,
    REPEAT_OPTIONS,
    toDateKey,
    WEEKDAY_LABELS,
} from "./CalendarPlannerScreen.helpers";

// --- PlanCard ---
export const PlanCard = memo(function PlanCard({
  plan,
  colors,
  isDark,
  onEdit,
  onDelete,
  toggleNotif,
  focusedPlanId,
  textPrimary,
  textMuted,
  border,
  accent,
}) {
  const pm = PRIORITIES.find((p) => p.key === plan.priority) ?? PRIORITIES[1];
  const planTime = plan.time ? new Date(plan.time) : null;
  const isPast = planTime && planTime < new Date();
  const isFocused = focusedPlanId === plan.id;

  return (
    <View
      style={[
        styles.planCard,
        {
          backgroundColor: colors.card,
          borderColor: isFocused ? accent : border,
          borderLeftColor: pm.color,
        },
        isFocused && styles.planCardFocused,
      ]}
    >
      <View style={styles.planTop}>
        <View
          style={[styles.planIconBox, { backgroundColor: pm.color + "18" }]}
        >
          <Ionicons name={pm.icon} size={17} color={pm.color} />
        </View>
        <View style={styles.planContent}>
          <Text
            style={[styles.planTitle, { color: textPrimary }]}
            numberOfLines={2}
          >
            {plan.title}
          </Text>
          {plan.note ? (
            <Text
              style={[styles.planNote, { color: textMuted }]}
              numberOfLines={2}
            >
              {plan.note}
            </Text>
          ) : null}
        </View>
        <View style={styles.planActions}>
          <TouchableOpacity
            style={[
              styles.planActionBtn,
              {
                borderColor: border,
                backgroundColor: isDark ? "#0f172a" : "#f8fafc",
              },
            ]}
            onPress={onEdit}
          >
            <Ionicons name="create-outline" size={13} color={textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.planActionBtn,
              {
                borderColor: "#fecaca",
                backgroundColor: isDark ? "#3f1d1d" : "#fff1f2",
              },
            ]}
            onPress={onDelete}
          >
            <Ionicons name="trash-outline" size={13} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.planMeta}>
        {planTime && (
          <View
            style={[
              styles.metaChip,
              {
                backgroundColor: isPast
                  ? "#fee2e2"
                  : isDark
                    ? "#1e293b"
                    : "#f1f5f9",
              },
            ]}
          >
            <Ionicons
              name="time-outline"
              size={11}
              color={isPast ? "#ef4444" : textMuted}
            />
            <Text
              style={[
                styles.metaChipText,
                { color: isPast ? "#ef4444" : textMuted },
              ]}
            >
              {formatTime12(planTime)}
              {isPast ? " - Past" : ""}
            </Text>
          </View>
        )}
        <View style={[styles.metaChip, { backgroundColor: pm.color + "18" }]}>
          <Text style={[styles.metaChipText, { color: pm.color }]}>
            {pm.label}
          </Text>
        </View>
        {plan.repeat !== "once" && (
          <View
            style={[
              styles.metaChip,
              { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
            ]}
          >
            <Ionicons name="repeat" size={11} color={textMuted} />
            <Text style={[styles.metaChipText, { color: textMuted }]}>
              {plan.repeat === "daily" ? "Daily" : "Weekly"}
            </Text>
          </View>
        )}
        {isFocused && (
          <View style={[styles.metaChip, { backgroundColor: `${accent}18` }]}>
            <Ionicons name="arrow-undo-outline" size={11} color={accent} />
            <Text style={[styles.metaChipText, { color: accent }]}>
              Opened from Tasks
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.metaChip,
            {
              backgroundColor: plan.notifEnabled
                ? isDark
                  ? "#082f49"
                  : "#e0f2fe"
                : isDark
                  ? "#1e293b"
                  : "#f1f5f9",
            },
          ]}
          onPress={() => toggleNotif(plan)}
        >
          <Ionicons
            name={
              plan.notifEnabled ? "notifications" : "notifications-off-outline"
            }
            size={11}
            color={
              plan.notifEnabled ? (isDark ? "#7dd3fc" : "#0369a1") : textMuted
            }
          />
          <Text
            style={[
              styles.metaChipText,
              {
                color: plan.notifEnabled
                  ? isDark
                    ? "#bae6fd"
                    : "#0369a1"
                  : textMuted,
              },
            ]}
          >
            {plan.notifEnabled ? "Notif on" : "Notif off"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

PlanCard.displayName = "PlanCard";

// --- CalendarGrid ---
export const CalendarGrid = memo(function CalendarGrid({
  currentYear,
  currentMonth,
  today,
  selectedDate,
  dotMap,
  onDaySelect,
  colors,
  textPrimary,
  textMuted,
  accent,
  isCurrentMonth,
  isDark,
  border,
}) {
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const calCells = [];
  for (let i = 0; i < firstDay; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);

  return (
    <>
      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((d) => (
          <Text key={d} style={[styles.weekLabel, { color: textMuted }]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {calCells.map((day, idx) => {
          if (!day) return <View key={`empty-${idx}`} style={styles.cell} />;
          const dk = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday = isCurrentMonth && day === today.getDate();
          const isSelected = dk === toDateKey(selectedDate);
          const dots = dotMap[dk] ? Array.from(dotMap[dk]).slice(0, 3) : [];

          return (
            <TouchableOpacity
              key={dk}
              style={[
                styles.cell,
                isSelected && { backgroundColor: accent, borderRadius: 12 },
                isToday &&
                  !isSelected && {
                    backgroundColor: accent + "22",
                    borderRadius: 12,
                  },
              ]}
              onPress={() => onDaySelect(day)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.dayNum,
                  {
                    color: isSelected ? "#fff" : isToday ? accent : textPrimary,
                  },
                  isSelected && { fontWeight: "900" },
                ]}
              >
                {day}
              </Text>
              {dots.length > 0 && (
                <View style={styles.dotRow}>
                  {dots.map((pkey) => (
                    <View
                      key={pkey}
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            PRIORITIES.find((p) => p.key === pkey)?.color ||
                            "#3b82f6",
                        },
                      ]}
                    />
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
});

CalendarGrid.displayName = "CalendarGrid";

// --- PlannerModal (add/edit) ---
export const PlannerModal = memo(function PlannerModal({
  modalVisible,
  editingPlan,
  selectedDate,
  onClose,
  onSave,
  colors,
  textPrimary,
  textMuted,
  accent,
  border,
  isDark,
  saving,
  notifPermission,
  formTitle,
  formNote,
  formPriority,
  formTime,
  formRepeat,
  formNotifEnabled,
  showTimePicker,
  setShowTimePicker,
  setFormTitle,
  setFormNote,
  setFormPriority,
  setFormTime,
  setFormRepeat,
  setFormNotifEnabled,
}) {
  const handleTimeChange = (event, selected) => {
    if (Platform.OS !== "ios") setShowTimePicker(false);
    else if (event?.type === "dismissed") {
      setShowTimePicker(false);
      return;
    }
    if (selected) setFormTime(selected);
  };

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.card, borderColor: border },
          ]}
        >
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <View
              style={[
                styles.modalHeaderIcon,
                { backgroundColor: accent + "18" },
              ]}
            >
              <Ionicons
                name={editingPlan ? "create-outline" : "add-circle-outline"}
                size={20}
                color={accent}
              />
            </View>
            <View style={styles.modalCopy}>
              <Text style={[styles.modalTitle, { color: textPrimary }]}>
                {editingPlan ? "Edit Plan" : "Add Plan"}
              </Text>
              <Text style={[styles.modalSub, { color: textMuted }]}>
                {selectedDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.closeBtn, { borderColor: border }]}
              onPress={onClose}
              disabled={saving}
            >
              <Ionicons name="close" size={17} color={textMuted} />
            </TouchableOpacity>
          </View>

          {/* Form fields */}
          <Text style={[styles.fieldLabel, { color: textMuted }]}>Title *</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: formTitle ? accent : border,
                color: textPrimary,
              },
            ]}
            placeholder="e.g. Study for Finals"
            placeholderTextColor={textMuted}
            value={formTitle}
            onChangeText={setFormTitle}
            returnKeyType="next"
            editable={!saving}
          />

          <Text style={[styles.fieldLabel, { color: textMuted }]}>
            Notes (optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.inputMulti,
              {
                backgroundColor: colors.background,
                borderColor: border,
                color: textPrimary,
              },
            ]}
            placeholder="Add a short note..."
            placeholderTextColor={textMuted}
            value={formNote}
            onChangeText={setFormNote}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
            editable={!saving}
          />

          <Text style={[styles.fieldLabel, { color: textMuted }]}>
            Priority
          </Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => {
              const active = formPriority === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.priorityChip,
                    {
                      borderColor: active ? p.color : border,
                      backgroundColor: active ? p.color : "transparent",
                    },
                  ]}
                  onPress={() => setFormPriority(p.key)}
                  disabled={saving}
                >
                  <Ionicons
                    name={p.icon}
                    size={14}
                    color={active ? "#fff" : p.color}
                  />
                  <Text
                    style={[
                      styles.priorityChipText,
                      { color: active ? "#fff" : textPrimary },
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: textMuted }]}>Time</Text>
          <TouchableOpacity
            style={[
              styles.timeBtn,
              { borderColor: border, backgroundColor: colors.background },
            ]}
            onPress={() => setShowTimePicker((v) => !v)}
            disabled={saving}
          >
            <Ionicons name="time-outline" size={17} color={accent} />
            <Text style={[styles.timeBtnText, { color: textPrimary }]}>
              {formatTime12(formTime)}
            </Text>
            <View style={[styles.editChip, { backgroundColor: accent + "18" }]}>
              <Ionicons name="pencil" size={11} color={accent} />
              <Text style={[styles.editChipText, { color: accent }]}>Edit</Text>
            </View>
          </TouchableOpacity>

          {showTimePicker && (
            <DateTimePicker
              value={formTime}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={handleTimeChange}
            />
          )}

          <Text style={[styles.fieldLabel, { color: textMuted }]}>Repeat</Text>
          <View style={styles.repeatRow}>
            {REPEAT_OPTIONS.map((r) => {
              const active = formRepeat === r.key;
              return (
                <TouchableOpacity
                  key={r.key}
                  style={[
                    styles.repeatChip,
                    {
                      borderColor: active ? accent : border,
                      backgroundColor: active ? accent : "transparent",
                    },
                  ]}
                  onPress={() => setFormRepeat(r.key)}
                  disabled={saving}
                >
                  <Text
                    style={[
                      styles.repeatChipText,
                      { color: active ? "#fff" : textPrimary },
                    ]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.notifRow, { borderColor: border }]}>
            <Ionicons name="notifications-outline" size={18} color={accent} />
            <View style={styles.modalCopy}>
              <Text style={[styles.notifLabel, { color: textPrimary }]}>
                Notification
              </Text>
              <Text style={[styles.notifSub, { color: textMuted }]}>
                {notifPermission
                  ? formNotifEnabled
                    ? `Will remind at ${formatTime12(formTime)}`
                    : "Notification disabled for this plan"
                  : "Enable notifications in settings"}
              </Text>
            </View>
            <Switch
              value={formNotifEnabled && notifPermission}
              onValueChange={(v) => {
                if (!notifPermission) {
                  // Trigger permission request handled in parent
                  return;
                }
                setFormNotifEnabled(v);
              }}
              trackColor={{ false: border, true: accent + "66" }}
              thumbColor={
                formNotifEnabled && notifPermission
                  ? accent
                  : isDark
                    ? "#475569"
                    : "#cbd5e1"
              }
              disabled={saving}
            />
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: border }]}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={[styles.cancelBtnText, { color: textMuted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveBtn,
                { backgroundColor: accent, opacity: saving ? 0.65 : 1 },
              ]}
              onPress={onSave}
              disabled={saving}
            >
              <Ionicons
                name={saving ? "hourglass-outline" : "checkmark-circle-outline"}
                size={17}
                color="#fff"
              />
              <Text style={styles.saveBtnText}>
                {saving
                  ? "Saving..."
                  : editingPlan
                    ? "Save Changes"
                    : "Add Plan"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 20 }} />
        </View>
      </View>
    </Modal>
  );
});

PlannerModal.displayName = "PlannerModal";

const styles = StyleSheet.create({
  // PlanCard styles
  planCard: {
    borderRadius: 15,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  planCardFocused: {
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  planTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 8,
  },
  planIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planContent: { flex: 1, minWidth: 0 },
  planTitle: { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  planNote: { fontSize: 12, fontWeight: "500", lineHeight: 17 },
  planActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  planActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  planMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metaChipText: { fontSize: 10, fontWeight: "700" },

  // CalendarGrid styles
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingVertical: 4,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  dayNum: { fontSize: 13, fontWeight: "600" },
  dotRow: { flexDirection: "row", gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },

  // PlannerModal styles
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    maxHeight: "92%",
    width: "100%",
    maxWidth: 440,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  modalHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCopy: { flex: 1, minWidth: 0 },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalSub: { fontSize: 12, marginTop: 1 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 7,
    marginTop: 14,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 11,
    padding: 12,
    fontSize: 14,
    fontWeight: "500",
  },
  inputMulti: { minHeight: 68, textAlignVertical: "top" },
  priorityRow: { flexDirection: "row", gap: 8 },
  priorityChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 10,
  },
  priorityChipText: { fontSize: 12, fontWeight: "700" },
  timeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 11,
    padding: 12,
  },
  timeBtnText: { flex: 1, fontSize: 14, fontWeight: "600" },
  editChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  editChipText: { fontSize: 11, fontWeight: "700" },
  repeatRow: { flexDirection: "row", gap: 8 },
  repeatChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderWidth: 1.5,
    borderRadius: 11,
  },
  repeatChipText: { fontSize: 12, fontWeight: "700" },
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  notifLabel: { fontSize: 13, fontWeight: "700" },
  notifSub: { fontSize: 11, marginTop: 2 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 11,
    alignItems: "center",
  },
  cancelBtnText: { fontSize: 13, fontWeight: "700" },
  saveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 11,
    paddingVertical: 11,
  },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});


