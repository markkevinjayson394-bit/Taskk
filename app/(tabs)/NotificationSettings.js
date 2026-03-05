/**
 * NotificationSettings.js
 * 
 * Features:
 * 1. Toggle each notification on/off
 * 2. Edit the TIME of Morning Briefing, Daily Audit, Sunday Planning
 * 3. Edit how many minutes before class the reminder fires
 * 4. Create your own custom notifications (title, message, time, repeat)
 * 5. Delete or toggle custom notifications
 */

import { Ionicons } from "@expo/vector-icons";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import {
    Alert, Modal, ScrollView, StyleSheet,
    Switch, Text, TextInput,
    TouchableOpacity, View,
} from "react-native";
import { DEFAULT_TIMES, useNotifications } from "../../context/NotificationContext";
import { useTheme } from "../../context/ThemeContext";

// ── Notification items with editable time keys ────────────────────────────────
const NOTIFICATION_ITEMS = [
  {
    key:         "classReminder",
    icon:        "school",
    color:       "#007bff",
    title:       "Class Reminder",
    description: "Before each class starts",
    timeKey:     "classReminder",
    timeType:    "minutesBefore",
  },
  {
    key:         "deadlineWarning",
    icon:        "warning",
    color:       "#ef4444",
    title:       "Deadline Warnings",
    description: "7 days, 3 days, 1 day, and exact due time",
    timeKey:     null, // not editable — fires based on task due date
  },
  {
    key:         "morningBriefing",
    icon:        "sunny",
    color:       "#f59e0b",
    title:       "Morning Briefing",
    description: "Daily — check classes and tasks",
    timeKey:     "morningBriefing",
    timeType:    "clock",
  },
  {
    key:         "dailyAudit",
    icon:        "moon",
    color:       "#6366f1",
    title:       "Daily Time Audit",
    description: "Daily — reflect on your day",
    timeKey:     "dailyAudit",
    timeType:    "clock",
  },
  {
    key:         "sundayPlanning",
    icon:        "calendar",
    color:       "#10b981",
    title:       "Sunday Planning",
    description: "Every Sunday — plan your week",
    timeKey:     "sundayPlanning",
    timeType:    "clock",
  },
  {
    key:         "breakReminder",
    icon:        "cafe",
    color:       "#0ea5e9",
    title:       "Break Reminder",
    description: "After 90 minutes continuous use",
    timeKey:     null,
  },
  {
    key:         "appUsageCheck",
    icon:        "phone-portrait",
    color:       "#8b5cf6",
    title:       "App Usage Check",
    description: "After 30 minutes — study relevance check",
    timeKey:     null,
  },
];

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const REPEAT_OPTIONS = [
  { value: "daily",   label: "Every Day" },
  { value: "weekly",  label: "Every Week" },
  { value: "once",    label: "One Time"   },
];

// ── Format time helper ────────────────────────────────────────────────────────
function formatClock(hour, minute) {
  const h   = hour % 12 || 12;
  const m   = String(minute).padStart(2, "0");
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
}

export default function NotificationSettings() {
  const { colors, isDark } = useTheme();
  const {
    settings, updateSettings,
    times, updateTimes,
    customNotifs, addCustomNotif, updateCustomNotif, deleteCustomNotif,
    permission, requestPermission, rescheduleAll,
  } = useNotifications();

  const [saving,       setSaving]       = useState(false);
  const [showCustom,   setShowCustom]   = useState(false);

  // ── New custom notif form state ───────────────────────────────────────────
  const [newTitle,   setNewTitle]   = useState("");
  const [newBody,    setNewBody]    = useState("");
  const [newHour,    setNewHour]    = useState(8);
  const [newMinute,  setNewMinute]  = useState(0);
  const [newRepeat,  setNewRepeat]  = useState("daily");
  const [newWeekday, setNewWeekday] = useState(1); // Monday

  // ── Toggle notification on/off ────────────────────────────────────────────
  const handleToggle = async (key, value) => {
    setSaving(true);
    await updateSettings({ [key]: value });
    setSaving(false);
  };

  // ── Open time picker for editable notifications ───────────────────────────
  const openTimePicker = (timeKey, currentHour, currentMinute) => {
    const now = new Date();
    now.setHours(currentHour, currentMinute, 0, 0);

    DateTimePickerAndroid.open({
      value: now,
      mode: "time",
      is24Hour: false,
      onChange: async (event, selected) => {
        if (event.type !== "set" || !selected) return;
        await updateTimes({
          [timeKey]: {
            hour:   selected.getHours(),
            minute: selected.getMinutes(),
          },
        });
      },
    });
  };

  // ── Open minutes-before picker for class reminder ─────────────────────────
  const editMinutesBefore = () => {
    const current = times.classReminder?.minutesBefore ?? 15;
    Alert.prompt(
      "Class Reminder",
      "How many minutes before class should we remind you?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async (val) => {
            const mins = parseInt(val);
            if (isNaN(mins) || mins < 1 || mins > 120) {
              Alert.alert("Invalid", "Please enter a number between 1 and 120.");
              return;
            }
            await updateTimes({ classReminder: { minutesBefore: mins } });
          },
        },
      ],
      "plain-text",
      String(current),
      "numeric",
    );
  };

  // ── Open time picker for NEW custom notif ────────────────────────────────
  const openNewTimePicker = () => {
    const now = new Date();
    now.setHours(newHour, newMinute, 0, 0);
    DateTimePickerAndroid.open({
      value: now,
      mode: "time",
      is24Hour: false,
      onChange: (event, selected) => {
        if (event.type !== "set" || !selected) return;
        setNewHour(selected.getHours());
        setNewMinute(selected.getMinutes());
      },
    });
  };

  // ── Save new custom notification ─────────────────────────────────────────
  const saveCustomNotif = async () => {
    if (!newTitle.trim()) {
      Alert.alert("Missing Title", "Please enter a title for your notification.");
      return;
    }
    await addCustomNotif({
      title:   newTitle.trim(),
      body:    newBody.trim() || "Time for your reminder!",
      hour:    newHour,
      minute:  newMinute,
      repeat:  newRepeat,
      weekday: newWeekday,
    });
    // Reset form
    setNewTitle(""); setNewBody(""); setNewHour(8);
    setNewMinute(0); setNewRepeat("daily"); setNewWeekday(1);
    setShowCustom(false);
    Alert.alert("✅ Reminder Added", `"${newTitle}" has been scheduled.`);
  };

  const handlePermission = async () => {
    const granted = await requestPermission();
    if (granted) {
      Alert.alert("✅ Enabled", "You'll now receive reminders.");
      await rescheduleAll();
    } else {
      Alert.alert("Permission Denied", "Enable notifications in your phone Settings > Apps > CTU Danao.");
    }
  };

  const enabledCount = NOTIFICATION_ITEMS.filter((i) => settings[i.key]).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: "#007bff" }]}>
        <View style={styles.headerCircle} />
        <Text style={styles.headerSub}>Stay on track</Text>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.headerStats}>
          <View style={[styles.statPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Ionicons name="notifications" size={12} color="#fff" />
            <Text style={styles.statPillText}>{enabledCount} of {NOTIFICATION_ITEMS.length} active</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Ionicons name="add-circle" size={12} color="#fff" />
            <Text style={styles.statPillText}>{customNotifs.length} custom</Text>
          </View>
          {!permission && (
            <View style={[styles.statPill, { backgroundColor: "rgba(239,68,68,0.4)" }]}>
              <Ionicons name="warning" size={12} color="#fff" />
              <Text style={styles.statPillText}>Permission needed</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Permission warning ── */}
        {!permission && (
          <TouchableOpacity
            style={[styles.permissionBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}
            onPress={handlePermission}
          >
            <View style={styles.permissionLeft}>
              <Ionicons name="notifications-off" size={22} color="#ef4444" />
              <View>
                <Text style={styles.permissionTitle}>Notifications are disabled</Text>
                <Text style={styles.permissionSub}>Tap here to enable them</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#ef4444" />
          </TouchableOpacity>
        )}

        {/* ── Section: Built-in Notifications ── */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>Built-in Reminders</Text>

        {NOTIFICATION_ITEMS.map((item) => {
          const isEnabled  = settings[item.key] ?? true;
          const t          = times[item.timeKey] || DEFAULT_TIMES[item.timeKey];

          return (
            <View key={item.key}
              style={[styles.card, {
                backgroundColor: colors.card,
                borderColor: isEnabled ? item.color + "30" : colors.border,
                opacity: !permission ? 0.65 : 1,
              }]}
            >
              <View style={styles.cardTop}>
                <View style={[styles.iconBox, {
                  backgroundColor: isEnabled ? item.color + "18" : (isDark ? "#1e293b" : "#f1f5f9"),
                }]}>
                  <Ionicons name={item.icon} size={20} color={isEnabled ? item.color : colors.muted} />
                </View>

                <View style={styles.cardText}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                  <Text style={[styles.cardDesc,  { color: colors.muted }]}>{item.description}</Text>
                </View>

                <Switch
                  value={isEnabled}
                  onValueChange={(val) => handleToggle(item.key, val)}
                  trackColor={{ false: colors.border, true: item.color + "66" }}
                  thumbColor={isEnabled ? item.color : (isDark ? "#475569" : "#cbd5e1")}
                  disabled={!permission || saving}
                />
              </View>

              {/* ── Editable time row ── */}
              {isEnabled && item.timeKey && (
                <TouchableOpacity
                  style={[styles.timeRow, { borderTopColor: colors.border }]}
                  onPress={() => {
                    if (item.timeType === "minutesBefore") {
                      editMinutesBefore();
                    } else {
                      openTimePicker(item.timeKey, t?.hour ?? 7, t?.minute ?? 0);
                    }
                  }}
                  disabled={!permission}
                >
                  <Ionicons name="time-outline" size={14} color={item.color} />
                  <Text style={[styles.timeLabel, { color: colors.muted }]}>
                    {item.timeType === "minutesBefore"
                      ? `${t?.minutesBefore ?? 15} minutes before class`
                      : `Every day at ${formatClock(t?.hour ?? 7, t?.minute ?? 0)}`
                    }
                    {item.key === "sundayPlanning" ? " (Sundays)" : ""}
                  </Text>
                  <View style={[styles.editChip, { backgroundColor: item.color + "18" }]}>
                    <Ionicons name="pencil" size={11} color={item.color} />
                    <Text style={[styles.editChipText, { color: item.color }]}>Edit time</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* ── Section: Custom Notifications ── */}
        <View style={styles.customHeader}>
          <Text style={[styles.sectionLabel, { color: colors.muted, marginBottom: 0 }]}>
            My Custom Reminders
          </Text>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: "#007bff" }]}
            onPress={() => setShowCustom(true)}
          >
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={styles.addBtnText}>Add New</Text>
          </TouchableOpacity>
        </View>

        {customNotifs.length === 0 ? (
          <View style={[styles.emptyCustom, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 28, marginBottom: 6 }}>🔔</Text>
            <Text style={[styles.emptyCustomTitle, { color: colors.text }]}>No custom reminders yet</Text>
            <Text style={[styles.emptyCustomSub, { color: colors.muted }]}>
              Tap "Add New" to create your own reminder — study sessions, medicine, anything!
            </Text>
          </View>
        ) : (
          customNotifs.map((cn) => (
            <View key={cn.id}
              style={[styles.customCard, {
                backgroundColor: colors.card,
                borderColor: cn.enabled ? "#007bff30" : colors.border,
              }]}
            >
              <View style={styles.customCardTop}>
                <View style={[styles.customIconBox, {
                  backgroundColor: cn.enabled ? "#007bff18" : (isDark ? "#1e293b" : "#f1f5f9"),
                }]}>
                  <Ionicons name="notifications" size={18} color={cn.enabled ? "#007bff" : colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.customTitle, { color: colors.text }]}>{cn.title}</Text>
                  <Text style={[styles.customSub,   { color: colors.muted }]} numberOfLines={1}>
                    {cn.body}
                  </Text>
                  <View style={styles.customMeta}>
                    <View style={[styles.metaChip, { backgroundColor: "#007bff15" }]}>
                      <Ionicons name="time-outline" size={10} color="#007bff" />
                      <Text style={[styles.metaChipText, { color: "#007bff" }]}>
                        {formatClock(cn.hour, cn.minute)}
                      </Text>
                    </View>
                    <View style={[styles.metaChip, { backgroundColor: "#10b98115" }]}>
                      <Ionicons name="repeat" size={10} color="#10b981" />
                      <Text style={[styles.metaChipText, { color: "#10b981" }]}>
                        {cn.repeat === "daily"  ? "Every day" :
                         cn.repeat === "weekly" ? `Every ${DAYS[cn.weekday ?? 1]}` :
                         "One time"}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.customActions}>
                  <Switch
                    value={cn.enabled}
                    onValueChange={(val) => updateCustomNotif(cn.id, { enabled: val })}
                    trackColor={{ false: colors.border, true: "#007bff66" }}
                    thumbColor={cn.enabled ? "#007bff" : (isDark ? "#475569" : "#cbd5e1")}
                    disabled={!permission}
                  />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => Alert.alert(
                      "Delete Reminder",
                      `Delete "${cn.title}"?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteCustomNotif(cn.id) },
                      ]
                    )}
                  >
                    <Ionicons name="trash-outline" size={17} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Add Custom Notification Modal ── */}
      <Modal visible={showCustom} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />

            <Text style={[styles.modalTitle, { color: colors.text }]}>New Reminder</Text>

            {/* Title */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Title *</Text>
            <TextInput
              placeholder="e.g. Study for Finals"
              placeholderTextColor={colors.muted}
              value={newTitle}
              onChangeText={setNewTitle}
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: newTitle ? "#007bff" : colors.border }]}
            />

            {/* Message */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Message (optional)</Text>
            <TextInput
              placeholder="e.g. Don't forget to review your notes!"
              placeholderTextColor={colors.muted}
              value={newBody}
              onChangeText={setNewBody}
              multiline
              numberOfLines={2}
              style={[styles.input, styles.inputMulti, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            />

            {/* Time */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Time</Text>
            <TouchableOpacity
              style={[styles.timePickerBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={openNewTimePicker}
            >
              <Ionicons name="time-outline" size={18} color="#007bff" />
              <Text style={[styles.timePickerText, { color: colors.text }]}>
                {formatClock(newHour, newMinute)}
              </Text>
              <View style={[styles.editChip, { backgroundColor: "#007bff18", marginLeft: "auto" }]}>
                <Ionicons name="pencil" size={11} color="#007bff" />
                <Text style={[styles.editChipText, { color: "#007bff" }]}>Change</Text>
              </View>
            </TouchableOpacity>

            {/* Repeat */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Repeat</Text>
            <View style={styles.repeatRow}>
              {REPEAT_OPTIONS.map((r) => (
                <TouchableOpacity key={r.value} onPress={() => setNewRepeat(r.value)}
                  style={[styles.repeatChip, {
                    backgroundColor: newRepeat === r.value ? "#007bff" : colors.background,
                    borderColor: newRepeat === r.value ? "#007bff" : colors.border,
                  }]}>
                  <Text style={[styles.repeatChipText, { color: newRepeat === r.value ? "#fff" : colors.muted }]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Weekday picker (only for weekly) */}
            {newRepeat === "weekly" && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>Day of Week</Text>
                <View style={styles.daysRow}>
                  {DAYS.map((day, i) => (
                    <TouchableOpacity key={day} onPress={() => setNewWeekday(i)}
                      style={[styles.dayChip, {
                        backgroundColor: newWeekday === i ? "#007bff" : colors.background,
                        borderColor: newWeekday === i ? "#007bff" : colors.border,
                      }]}>
                      <Text style={[styles.dayChipText, { color: newWeekday === i ? "#fff" : colors.muted }]}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Save / Cancel */}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: "#007bff" }]}
              onPress={saveCustomNotif}
            >
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>Save Reminder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowCustom(false)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingTop: 52, paddingBottom: 22, paddingHorizontal: 22,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden",
  },
  headerCircle: {
    position: "absolute", width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)", top: -40, right: -30,
  },
  headerSub:    { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerTitle:  { color: "#fff", fontSize: 26, fontWeight: "800", marginBottom: 12 },
  headerStats:  { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statPill:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  content: { padding: 16 },

  permissionBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 14,
  },
  permissionLeft:  { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  permissionTitle: { fontSize: 13, fontWeight: "700", color: "#ef4444" },
  permissionSub:   { fontSize: 11, color: "#f87171", marginTop: 2 },

  sectionLabel: {
    fontSize: 11, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.6, marginBottom: 10, marginTop: 6,
  },

  card: {
    borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1.5,
    elevation: 1, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3,
  },
  cardTop:   { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox:   { width: 42, height: 42, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  cardText:  { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  cardDesc:  { fontSize: 12, lineHeight: 17 },

  timeRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 12, paddingTop: 10, borderTopWidth: 1,
  },
  timeLabel:     { flex: 1, fontSize: 12, fontWeight: "500" },
  editChip:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  editChipText:  { fontSize: 11, fontWeight: "700" },

  customHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginTop: 8, marginBottom: 10,
  },
  addBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  emptyCustom: {
    alignItems: "center", padding: 28, borderRadius: 16,
    borderWidth: 1.5, borderStyle: "dashed", marginBottom: 10,
  },
  emptyCustomTitle: { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  emptyCustomSub:   { fontSize: 12, textAlign: "center", lineHeight: 18 },

  customCard: {
    borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1.5,
    elevation: 1, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3,
  },
  customCardTop:  { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  customIconBox:  { width: 38, height: 38, borderRadius: 10, justifyContent: "center", alignItems: "center", marginTop: 2 },
  customTitle:    { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  customSub:      { fontSize: 12, marginBottom: 6 },
  customMeta:     { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  metaChip:       { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  metaChipText:   { fontSize: 10, fontWeight: "700" },
  customActions:  { alignItems: "center", gap: 6 },
  deleteBtn:      { padding: 4 },

  // ── Modal ──────────────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  modalCard: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#cbd5e1", alignSelf: "center", marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 16, textAlign: "center" },
  fieldLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14 },
  inputMulti: { minHeight: 64, textAlignVertical: "top" },

  timePickerBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 12, padding: 12,
  },
  timePickerText: { fontSize: 15, fontWeight: "600" },

  repeatRow: { flexDirection: "row", gap: 8 },
  repeatChip: {
    flex: 1, alignItems: "center", paddingVertical: 9,
    borderRadius: 10, borderWidth: 1.5,
  },
  repeatChipText: { fontSize: 12, fontWeight: "700" },

  daysRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  dayChip: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1.5,
  },
  dayChipText: { fontSize: 11, fontWeight: "700" },

  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 14, borderRadius: 14, marginTop: 20,
  },
  saveBtnText:  { color: "#fff", fontSize: 15, fontWeight: "700" },
  cancelBtn:    { alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  cancelBtnText:{ fontSize: 14, fontWeight: "600" },
});
