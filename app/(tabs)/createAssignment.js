import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import {
  addDoc, collection, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  Alert, Animated,
  StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import { useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";

const TYPES = [
  { value: "assignment", label: "Assignment", icon: "document-text", color: "#6366f1" },
  { value: "quiz",       label: "Quiz",       icon: "help-circle",   color: "#0ea5e9" },
  { value: "exam",       label: "Exam",       icon: "school",        color: "#ef4444" },
  { value: "project",    label: "Project",    icon: "construct",     color: "#f59e0b" },
];

const PRIORITIES = [
  { value: "high",   label: "High",   color: "#ef4444" },
  { value: "medium", label: "Medium", color: "#f59e0b" },
  { value: "low",    label: "Low",    color: "#22c55e" },
];

const QUEUE_KEY = (uid) => `pending_create_${uid}`;

export default function CreateAssignment() {
  const { colors, isDark } = useTheme();
  const { isOnline, markSynced } = useOffline();
  const { rescheduleAll } = useNotifications(); // ← NEW

  const [title,        setTitle]        = useState("");
  const [subject,      setSubject]      = useState("");
  const [dueDate,      setDueDate]      = useState(new Date());
  const [type,         setType]         = useState("assignment");
  const [priority,     setPriority]     = useState("medium");
  const [saving,       setSaving]       = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [syncing,      setSyncing]      = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    loadQueue();
  }, []);

  useEffect(() => {
    if (isOnline) flushQueue();
  }, [isOnline]);

  const loadQueue = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY(user.uid));
      if (raw) setPendingQueue(JSON.parse(raw));
    } catch {}
  };

  const flushQueue = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const raw = await AsyncStorage.getItem(QUEUE_KEY(user.uid));
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (queue.length === 0) return;

    setSyncing(true);
    let remaining = [...queue];

    for (const task of queue) {
      try {
        await addDoc(collection(db, "assignments"), {
          userId:    user.uid,
          title:     task.title,
          subject:   task.subject,
          dueAt:     Timestamp.fromDate(new Date(task.dueAt)),
          completed: false,
          type:      task.type,
          priority:  task.priority,
          createdAt: serverTimestamp(),
        });
        remaining = remaining.filter((t) => t.localId !== task.localId);
      } catch (err) {
        console.warn("Sync failed for task:", task.title, err);
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY(user.uid), JSON.stringify(remaining));
    setPendingQueue(remaining);
    setSyncing(false);

    if (remaining.length < queue.length) {
      const synced = queue.length - remaining.length;
      await markSynced();
      await rescheduleAll(); // ← reschedule after synced offline tasks
      Alert.alert(
        "✅ Synced!",
        `${synced} offline task${synced > 1 ? "s" : ""} have been saved to the server.`
      );
    }
  };

  const save = async () => {
    if (!title.trim() || !subject.trim()) {
      Alert.alert("Missing Fields", "Please fill in the title and subject.");
      return;
    }
    const user = auth.currentUser;
    if (!user) { Alert.alert("Error", "Not logged in."); return; }

    setSaving(true);

    if (isOnline) {
      try {
        await addDoc(collection(db, "assignments"), {
          userId:    user.uid,
          title:     title.trim(),
          subject:   subject.trim(),
          dueAt:     Timestamp.fromDate(dueDate),
          completed: false,
          type, priority,
          createdAt: serverTimestamp(),
        });
        await rescheduleAll(); // ← reschedule so deadline warnings update
        Alert.alert("✅ Task Added", `"${title}" has been saved.`);
        resetForm();
      } catch (err) {
        Alert.alert("Error", "Failed to save task. Please try again.");
      }
    } else {
      try {
        const newTask = {
          localId:   `local_${Date.now()}`,
          title:     title.trim(),
          subject:   subject.trim(),
          dueAt:     dueDate.toISOString(),
          type,
          priority,
          completed: false,
          queuedAt:  new Date().toISOString(),
        };
        const raw   = await AsyncStorage.getItem(QUEUE_KEY(user.uid));
        const queue = raw ? JSON.parse(raw) : [];
        queue.push(newTask);
        await AsyncStorage.setItem(QUEUE_KEY(user.uid), JSON.stringify(queue));
        setPendingQueue(queue);
        Alert.alert(
          "📥 Saved Offline",
          `"${title}" has been saved to your device. It will sync to the server automatically when you're back online.`,
          [{ text: "OK" }]
        );
        resetForm();
      } catch (err) {
        Alert.alert("Error", "Failed to save task locally.");
      }
    }

    setSaving(false);
  };

  const resetForm = () => {
    setTitle(""); setSubject(""); setDueDate(new Date());
    setType("assignment"); setPriority("medium");
  };

  const openDateTimePicker = () => {
    DateTimePickerAndroid.open({
      value: dueDate, mode: "date",
      onChange: (event, selectedDate) => {
        if (event.type !== "set" || !selectedDate) return;
        const newDate = new Date(dueDate);
        newDate.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        DateTimePickerAndroid.open({
          value: newDate, mode: "time", is24Hour: true,
          onChange: (event, selectedTime) => {
            if (event.type !== "set" || !selectedTime) return;
            newDate.setHours(selectedTime.getHours(), selectedTime.getMinutes());
            setDueDate(newDate);
          },
        });
      },
    });
  };

  const selectedType = TYPES.find((t) => t.value === type);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: selectedType?.color || colors.primary }]}>
        <View style={styles.headerCircle} />
        <Text style={styles.headerSub}>Stay on top of your work</Text>
        <Text style={styles.headerTitle}>New Task</Text>

        {!isOnline && (
          <View style={styles.offlinePill}>
            <Ionicons name="cloud-offline-outline" size={12} color="#fff" />
            <Text style={styles.offlinePillText}>Offline — tasks will sync when connected</Text>
          </View>
        )}

        {pendingQueue.length > 0 && (
          <TouchableOpacity
            style={[styles.syncPill, { backgroundColor: isOnline ? "#22c55e33" : "rgba(0,0,0,0.2)" }]}
            onPress={isOnline ? flushQueue : undefined}
            activeOpacity={isOnline ? 0.7 : 1}
          >
            <Ionicons name={syncing ? "sync" : "cloud-upload-outline"} size={12} color="#fff" />
            <Text style={styles.syncPillText}>
              {syncing
                ? "Syncing..."
                : `${pendingQueue.length} task${pendingQueue.length > 1 ? "s" : ""} waiting to sync`}
              {isOnline && !syncing ? " · Tap to sync now" : ""}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={styles.form}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Pending queue list */}
        {pendingQueue.length > 0 && (
          <View style={styles.queueSection}>
            <Text style={[styles.queueTitle, { color: colors.muted }]}>
              ⏳ Waiting to sync ({pendingQueue.length})
            </Text>
            {pendingQueue.map((task) => {
              const tColor = TYPES.find((t) => t.value === task.type)?.color || "#6366f1";
              return (
                <View key={task.localId}
                  style={[styles.queueCard, { backgroundColor: colors.card, borderLeftColor: tColor }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.queueCardTitle, { color: colors.text }]}>{task.title}</Text>
                    <Text style={[styles.queueCardSub, { color: colors.muted }]}>
                      {task.subject} · {task.type}
                    </Text>
                  </View>
                  <View style={[styles.pendingBadge, { backgroundColor: "#f59e0b22" }]}>
                    <Ionicons name="time-outline" size={11} color="#f59e0b" />
                    <Text style={styles.pendingBadgeText}>Pending</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Title */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Task Title *</Text>
        <TextInput
          placeholder="e.g. Chapter 5 Essay"
          placeholderTextColor={colors.muted}
          value={title}
          onChangeText={setTitle}
          style={[styles.input, {
            backgroundColor: colors.card, color: colors.text,
            borderColor: title ? selectedType?.color || colors.primary : colors.border,
          }]}
        />

        {/* Subject */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Subject *</Text>
        <TextInput
          placeholder="e.g. Mathematics"
          placeholderTextColor={colors.muted}
          value={subject}
          onChangeText={setSubject}
          style={[styles.input, {
            backgroundColor: colors.card, color: colors.text,
            borderColor: subject ? selectedType?.color || colors.primary : colors.border,
          }]}
        />

        {/* Task Type */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Category</Text>
        <View style={styles.typeGrid}>
          {TYPES.map((t) => {
            const isActive = type === t.value;
            return (
              <TouchableOpacity key={t.value} onPress={() => setType(t.value)}
                style={[styles.typeCard, {
                  backgroundColor: isActive ? t.color : colors.card,
                  borderColor: isActive ? t.color : colors.border,
                }]}>
                <Ionicons name={t.icon} size={22} color={isActive ? "#fff" : t.color} />
                <Text style={[styles.typeLabel, { color: isActive ? "#fff" : colors.text }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Priority */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Priority</Text>
        <View style={styles.priorityRow}>
          {PRIORITIES.map((p) => {
            const isActive = priority === p.value;
            return (
              <TouchableOpacity key={p.value} onPress={() => setPriority(p.value)}
                style={[styles.priorityBtn, {
                  backgroundColor: isActive ? p.color : colors.card,
                  borderColor: isActive ? p.color : colors.border,
                  flex: 1,
                }]}>
                <View style={[styles.priorityDot, { backgroundColor: isActive ? "#fff" : p.color }]} />
                <Text style={[styles.priorityLabel, { color: isActive ? "#fff" : colors.text }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Due Date */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>Due Date & Time</Text>
        <TouchableOpacity onPress={openDateTimePicker}
          style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="calendar-outline" size={18} color={selectedType?.color || colors.primary} />
          <Text style={[styles.dateBtnText, { color: colors.text }]}>
            {dueDate.toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} style={{ marginLeft: "auto" }} />
        </TouchableOpacity>

        {/* Preview card */}
        <View style={[styles.previewCard, {
          backgroundColor: colors.card,
          borderLeftColor: selectedType?.color || colors.primary,
        }]}>
          <Text style={[styles.previewLabel, { color: colors.muted }]}>Preview</Text>
          <Text style={[styles.previewTitle, { color: colors.text }]}>{title || "Task title..."}</Text>
          <Text style={[styles.previewSub, { color: colors.muted }]}>
            {subject || "Subject..."} · {selectedType?.label}
          </Text>
          <View style={styles.previewBadgeRow}>
            <View style={[styles.previewBadge,
              { backgroundColor: (PRIORITIES.find(p => p.value === priority)?.color || colors.primary) + "22" }]}>
              <Text style={[styles.previewBadgeText,
                { color: PRIORITIES.find(p => p.value === priority)?.color || colors.primary }]}>
                {priority.toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.previewDate, { color: colors.muted }]}>
              Due {dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </Text>
            {!isOnline && (
              <View style={[styles.previewBadge, { backgroundColor: "#f59e0b22", marginLeft: "auto" }]}>
                <Text style={[styles.previewBadgeText, { color: "#f59e0b" }]}>OFFLINE</Text>
              </View>
            )}
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveBtn, {
            backgroundColor: saving ? colors.muted : (selectedType?.color || colors.primary),
          }]}
          onPress={save}
          disabled={saving}
        >
          <Ionicons
            name={saving ? "hourglass-outline" : isOnline ? "checkmark-circle-outline" : "cloud-offline-outline"}
            size={20} color="#fff"
          />
          <Text style={styles.saveBtnText}>
            {saving ? "Saving..." : isOnline ? "Save Task" : "Save Offline"}
          </Text>
        </TouchableOpacity>

        {!isOnline && (
          <View style={[styles.tipBox, { backgroundColor: isDark ? "#1e293b" : "#fefce8" }]}>
            <Ionicons name="information-circle-outline" size={16} color="#f59e0b" />
            <Text style={[styles.tipText, { color: isDark ? "#fbbf24" : "#92400e" }]}>
              You're offline. Tasks saved here are stored on your device and will automatically upload to the server the next time you open the app with internet.
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingTop: 52, paddingBottom: 20, paddingHorizontal: 22,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden",
  },
  headerCircle: {
    position: "absolute", width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)", top: -40, right: -30,
  },
  headerSub:   { color: "rgba(255,255,255,0.7)", fontSize: 12, letterSpacing: 0.5 },
  headerTitle: { color: "#fff", fontSize: 26, fontWeight: "800", marginBottom: 8 },
  offlinePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(239,68,68,0.3)", alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, marginBottom: 6,
  },
  offlinePillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  syncPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  syncPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  form: { padding: 18 },
  queueSection: { marginBottom: 20 },
  queueTitle: {
    fontSize: 12, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 10,
  },
  queueCard: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 12, padding: 12, marginBottom: 8, borderLeftWidth: 4,
    elevation: 1, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3,
  },
  queueCardTitle:   { fontSize: 13, fontWeight: "700" },
  queueCardSub:     { fontSize: 11, marginTop: 2 },
  pendingBadge:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  pendingBadgeText: { fontSize: 10, fontWeight: "700", color: "#f59e0b" },
  inputLabel: {
    fontSize: 12, fontWeight: "600", textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 8, marginTop: 16,
  },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 13, fontSize: 15 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: { width: "47%", padding: 14, borderRadius: 14, borderWidth: 1.5, alignItems: "center", gap: 6 },
  typeLabel: { fontSize: 13, fontWeight: "600" },
  priorityRow: { flexDirection: "row", gap: 8 },
  priorityBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, padding: 11, borderRadius: 12, borderWidth: 1.5,
  },
  priorityDot:   { width: 8, height: 8, borderRadius: 4 },
  priorityLabel: { fontSize: 13, fontWeight: "600" },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  dateBtnText: { fontSize: 14, fontWeight: "500" },
  previewCard:      { marginTop: 20, borderRadius: 14, padding: 16, borderLeftWidth: 4 },
  previewLabel:     { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  previewTitle:     { fontSize: 16, fontWeight: "700", marginBottom: 3 },
  previewSub:       { fontSize: 13, marginBottom: 10 },
  previewBadgeRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  previewBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  previewBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  previewDate:      { fontSize: 12 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 16, borderRadius: 14, marginTop: 20,
    elevation: 3, shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  tipBox: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 14, padding: 12, borderRadius: 12 },
  tipText: { flex: 1, fontSize: 12, lineHeight: 18 },
});