import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    serverTimestamp,
    setDoc,
    Timestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Modal,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import { useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";

const TYPES = [
  {
    value: "assignment",
    label: "Assignment",
    icon: "document-text",
    color: "#6366f1",
  },
  { value: "quiz", label: "Quiz", icon: "help-circle", color: "#0ea5e9" },
  { value: "exam", label: "Exam", icon: "school", color: "#ef4444" },
  { value: "project", label: "Project", icon: "construct", color: "#f59e0b" },
];

const PRIORITIES = [
  { value: "high", label: "High", color: "#ef4444" },
  { value: "medium", label: "Medium", color: "#f59e0b" },
  { value: "low", label: "Low", color: "#22c55e" },
];

const QUEUE_KEY = (uid) => `pending_create_${uid}`;
const TEMPLATE_KEY = (uid) => `task_templates_${uid}`;
const TEMPLATE_COLLECTION = "task_templates";
const BUILTIN_TEMPLATES = [
  {
    id: "builtin-assignment",
    name: "Assignment 2-Day",
    title: "Assignment Work Session",
    subject: "",
    type: "assignment",
    priority: "medium",
    dueOffsetHours: 48,
    builtin: true,
  },
  {
    id: "builtin-quiz",
    name: "Quiz Tonight",
    title: "Quiz Review",
    subject: "",
    type: "quiz",
    priority: "high",
    dueOffsetHours: 8,
    builtin: true,
  },
  {
    id: "builtin-exam",
    name: "Exam 1-Week",
    title: "Exam Preparation",
    subject: "",
    type: "exam",
    priority: "high",
    dueOffsetHours: 24 * 7,
    builtin: true,
  },
  {
    id: "builtin-project",
    name: "Project Milestone",
    title: "Project Milestone",
    subject: "",
    type: "project",
    priority: "medium",
    dueOffsetHours: 24 * 5,
    builtin: true,
  },
];

const normalizeTemplate = (item = {}) => ({
  id:
    typeof item.id === "string" && item.id ? item.id : `template_${Date.now()}`,
  name:
    typeof item.name === "string" && item.name.trim()
      ? item.name.trim()
      : "Task Template",
  title: typeof item.title === "string" ? item.title.trim() : "",
  subject: typeof item.subject === "string" ? item.subject.trim() : "",
  type: TYPES.some((entry) => entry.value === item.type)
    ? item.type
    : "assignment",
  priority: PRIORITIES.some((entry) => entry.value === item.priority)
    ? item.priority
    : "medium",
  dueOffsetHours: Math.max(1, Number(item.dueOffsetHours) || 24),
  builtin: Boolean(item.builtin),
});

const parseTemplateList = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeTemplate({ ...item, builtin: false }));
  } catch (err) {
    console.warn("Failed to parse local templates:", err);
    return [];
  }
};

const mergeTemplates = (local = [], remote = []) => {
  const map = new Map();
  remote.forEach((tpl) => map.set(tpl.id, tpl));
  local.forEach((tpl) => map.set(tpl.id, tpl));
  return Array.from(map.values());
};

const saveTemplatesCache = async (uid, templates) => {
  if (!uid) return;
  await AsyncStorage.setItem(TEMPLATE_KEY(uid), JSON.stringify(templates));
};

const loadTemplatesFromFirestore = async (uid) => {
  const snap = await getDocs(collection(db, "users", uid, TEMPLATE_COLLECTION));
  return snap.docs.map((docSnap) =>
    normalizeTemplate({ id: docSnap.id, ...docSnap.data(), builtin: false })
  );
};

const syncTemplatesToFirestore = async (uid, templates) => {
  if (!uid) return;
  const templateIds = new Set(templates.map((tpl) => tpl.id));
  const existingSnap = await getDocs(
    collection(db, "users", uid, TEMPLATE_COLLECTION)
  );

  await Promise.all(
    templates.map((tpl) =>
      setDoc(
        doc(db, "users", uid, TEMPLATE_COLLECTION, tpl.id),
        {
          name: tpl.name,
          title: tpl.title,
          subject: tpl.subject,
          type: tpl.type,
          priority: tpl.priority,
          dueOffsetHours: tpl.dueOffsetHours,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );

  const deletions = [];
  existingSnap.forEach((docSnap) => {
    if (!templateIds.has(docSnap.id)) {
      deletions.push(
        deleteDoc(doc(db, "users", uid, TEMPLATE_COLLECTION, docSnap.id))
      );
    }
  });
  if (deletions.length) {
    await Promise.all(deletions);
  }
};
const normalizeCreateQueue = (queue = []) => {
  const unique = new Map();
  for (const item of queue) {
    if (!item?.localId) continue;
    unique.set(item.localId, item);
  }
  return Array.from(unique.values());
};
const parseCreateQueue = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeCreateQueue(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    console.warn("Failed to parse pending task queue:", err);
    return [];
  }
};

export default function CreateAssignment() {
  const { colors, isDark } = useTheme();
  const {
    isOnline,
    markSynced,
    refreshPendingSyncSummary,
    pendingSyncSummary,
  } = useOffline();
  const { rescheduleAll } = useNotifications(); // NEW
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState(new Date());
  const [type, setType] = useState("assignment");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [templates, setTemplates] = useState(BUILTIN_TEMPLATES);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState("");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const syncingRef = useRef(false);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
    loadQueue();
    loadTemplates();
  }, [fadeAnim, loadQueue, loadTemplates]);

  useEffect(() => {
    if (isOnline) flushQueue();
  }, [isOnline, flushQueue]);

  useFocusEffect(
    useCallback(() => {
      loadQueue();
      loadTemplates();
      if (isOnline) flushQueue();
    }, [isOnline, loadQueue, loadTemplates, flushQueue])
  );

  const loadQueue = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY(user.uid));
      setPendingQueue(parseCreateQueue(raw));
    } catch (err) {
      console.warn("Failed to load pending queue:", err);
      setPendingQueue([]);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setTemplates(BUILTIN_TEMPLATES);
      return;
    }
    let localTemplates = [];
    try {
      const raw = await AsyncStorage.getItem(TEMPLATE_KEY(user.uid));
      localTemplates = parseTemplateList(raw);
    } catch (err) {
      console.warn("Failed to load local templates:", err);
      localTemplates = [];
    }

    if (!isOnline) {
      setTemplates([...BUILTIN_TEMPLATES, ...localTemplates]);
      return;
    }

    try {
      const remoteTemplates = await loadTemplatesFromFirestore(user.uid);
      const merged = mergeTemplates(localTemplates, remoteTemplates);
      setTemplates([...BUILTIN_TEMPLATES, ...merged]);
      await saveTemplatesCache(user.uid, merged);
      await syncTemplatesToFirestore(user.uid, merged);
    } catch (err) {
      console.warn("Failed to load templates from server:", err);
      setTemplates([...BUILTIN_TEMPLATES, ...localTemplates]);
    }
  }, [isOnline]);

  const persistCustomTemplates = async (
    nextTemplates,
    uid = auth.currentUser?.uid
  ) => {
    if (!uid) return;
    const custom = nextTemplates
      .filter((item) => !item.builtin)
      .map((item) => normalizeTemplate({ ...item, builtin: false }));
    await saveTemplatesCache(uid, custom);
    if (isOnline) {
      try {
        await syncTemplatesToFirestore(uid, custom);
      } catch (err) {
        console.warn("Failed to sync templates to server:", err);
      }
    }
  };

  const enqueueTask = async (user, task) => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY(user.uid));
    const queue = parseCreateQueue(raw);
    const next = normalizeCreateQueue([...queue, task]);
    await AsyncStorage.setItem(QUEUE_KEY(user.uid), JSON.stringify(next));
    setPendingQueue(next);
    await refreshPendingSyncSummary(user.uid);
  };

  const flushQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const user = auth.currentUser;
    if (!user) {
      syncingRef.current = false;
      return;
    }

    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY(user.uid));
      if (!raw) {
        setPendingQueue([]);
        return;
      }

      const queue = parseCreateQueue(raw);
      if (queue.length === 0) {
        setPendingQueue([]);
        await AsyncStorage.removeItem(QUEUE_KEY(user.uid));
        return;
      }

      setSyncing(true);
      const remaining = [];
      let synced = 0;

      for (const task of queue) {
        try {
          const dueTimestamp = Timestamp.fromDate(new Date(task.dueAt));
          await addDoc(collection(db, "assignments"), {
            userId: user.uid,
            title: task.title,
            subject: task.subject,
            dueAt: dueTimestamp,
            completed: false,
            type: task.type,
            priority: task.priority,
            createdAt: serverTimestamp(),
          });
          synced++;
        } catch (_err) {
          console.warn("Sync failed for task:", task.title, _err);
          remaining.push(task);
        }
      }

      if (remaining.length > 0) {
        await AsyncStorage.setItem(
          QUEUE_KEY(user.uid),
          JSON.stringify(remaining)
        );
      } else {
        await AsyncStorage.removeItem(QUEUE_KEY(user.uid));
      }
      setPendingQueue(remaining);
      await refreshPendingSyncSummary(user.uid);

      if (synced > 0) {
        await markSynced();
        await rescheduleAll();
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [rescheduleAll, markSynced, refreshPendingSyncSummary]);

  const save = async () => {
    if (!title.trim() || !subject.trim()) {
      Alert.alert("Missing Fields", "Please fill in the title and subject.");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "Not logged in.");
      return;
    }

    setSaving(true);

    const queuedTask = {
      localId: `local_${Date.now()}`,
      title: title.trim(),
      subject: subject.trim(),
      dueAt: dueDate.toISOString(),
      type,
      priority,
      completed: false,
      queuedAt: new Date().toISOString(),
    };

    if (isOnline) {
      try {
        const dueTimestamp = Timestamp.fromDate(dueDate);
        await addDoc(collection(db, "assignments"), {
          userId: user.uid,
          title: title.trim(),
          subject: subject.trim(),
          dueAt: dueTimestamp,
          completed: false,
          type,
          priority,
          createdAt: serverTimestamp(),
        });
        await markSynced();
        await rescheduleAll();
        Alert.alert("Task Added", `"${title}" has been saved.`);
        resetForm();
      } catch (_err) {
        await enqueueTask(user, queuedTask);
        Alert.alert(
          "Saved Offline",
          `Couldn't reach the server. "${title}" was saved locally and will sync automatically when online.`
        );
        resetForm();
      }
    } else {
      try {
        await enqueueTask(user, queuedTask);
        Alert.alert(
          "Saved Offline",
          `"${title}" has been saved to your device. It will sync to the server automatically when you're back online.`
        );
        resetForm();
      } catch (_err) {
        Alert.alert("Error", "Failed to save task locally.");
      }
    }

    setSaving(false);
  };

  const resetForm = () => {
    setTitle("");
    setSubject("");
    setDueDate(new Date());
    setType("assignment");
    setPriority("medium");
  };

  const applyTemplate = (template) => {
    const normalized = normalizeTemplate(template);
    const due = new Date();
    due.setHours(
      due.getHours() + Math.max(1, Number(normalized.dueOffsetHours) || 24)
    );

    setTitle(normalized.title || title);
    setSubject(normalized.subject || subject);
    setType(normalized.type);
    setPriority(normalized.priority);
    setDueDate(due);
  };

  const openSaveTemplateModal = () => {
    if (!title.trim() || !subject.trim()) {
      Alert.alert(
        "Missing Fields",
        "Add a title and subject first before saving a template."
      );
      return;
    }
    setTemplateNameInput(`${subject.trim()} ${type}`);
    setShowTemplateModal(true);
  };

  const saveAsTemplate = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const templateName = templateNameInput.trim();
    if (!templateName) {
      Alert.alert("Missing Name", "Please enter a template name.");
      return;
    }

    const hoursUntilDue = Math.max(
      1,
      Math.round((dueDate.getTime() - Date.now()) / (1000 * 60 * 60))
    );

    const customTemplate = normalizeTemplate({
      id: `custom_${Date.now()}`,
      name: templateName,
      title: title.trim(),
      subject: subject.trim(),
      type,
      priority,
      dueOffsetHours: hoursUntilDue,
      builtin: false,
    });

    const next = [...templates, customTemplate];
    setTemplates(next);
    await persistCustomTemplates(next, user.uid);
    setShowTemplateModal(false);
    setTemplateNameInput("");
    Alert.alert(
      "Template Saved",
      `"${templateName}" is now available in Task Templates.`
    );
  };

  const removeTemplate = async (templateId) => {
    const user = auth.currentUser;
    if (!user) return;

    const next = templates.filter(
      (item) => item.id !== templateId || item.builtin
    );
    setTemplates(next);
    await persistCustomTemplates(next, user.uid);
  };

  const openDateTimePicker = () => {
    DateTimePickerAndroid.open({
      value: dueDate,
      mode: "date",
      onChange: (event, selectedDate) => {
        if (event.type !== "set" || !selectedDate) return;
        const newDate = new Date(dueDate);
        newDate.setFullYear(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate()
        );
        DateTimePickerAndroid.open({
          value: newDate,
          mode: "time",
          is24Hour: true,
          onChange: (event, selectedTime) => {
            if (event.type !== "set" || !selectedTime) return;
            newDate.setHours(
              selectedTime.getHours(),
              selectedTime.getMinutes()
            );
            setDueDate(newDate);
          },
        });
      },
    });
  };

  const selectedType = TYPES.find((t) => t.value === type);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={selectedType?.color || colors.primary}
      />
      <OfflineBanner />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: selectedType?.color || colors.primary,
            paddingTop: insets.top + 16,
          },
        ]}
      >
        <View style={styles.headerCircle} />
        <View style={styles.headerCircle2} />
        <Text style={styles.headerSub}>Stay on top of your work</Text>
        <Text style={styles.headerTitle}>New Task</Text>

        {!isOnline && (
          <View style={styles.offlinePill}>
            <Ionicons name="cloud-offline-outline" size={12} color="#fff" />
            <Text style={styles.offlinePillText}>
              Offline - tasks will sync when connected
            </Text>
          </View>
        )}

        {pendingQueue.length > 0 && (
          <TouchableOpacity
            style={[
              styles.syncPill,
              { backgroundColor: isOnline ? "#22c55e33" : "rgba(0,0,0,0.2)" },
            ]}
            onPress={isOnline ? flushQueue : undefined}
            activeOpacity={isOnline ? 0.7 : 1}
          >
            <Ionicons
              name={syncing ? "sync" : "cloud-upload-outline"}
              size={12}
              color="#fff"
            />
            <Text style={styles.syncPillText}>
              {syncing
                ? "Syncing..."
                : `${pendingQueue.length} task${pendingQueue.length > 1 ? "s" : ""} waiting to sync`}
              {isOnline && !syncing ? " | Tap to sync now" : ""}
            </Text>
          </TouchableOpacity>
        )}
        {Number(pendingSyncSummary?.complete || 0) > 0 && (
          <View
            style={[
              styles.syncPill,
              { backgroundColor: "rgba(99,102,241,0.32)", marginTop: 6 },
            ]}
          >
            <Ionicons name="checkbox-outline" size={12} color="#fff" />
            <Text style={styles.syncPillText}>
              {pendingSyncSummary.complete} completed task update
              {pendingSyncSummary.complete > 1 ? "s" : ""} waiting to sync
            </Text>
          </View>
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
              Waiting to sync ({pendingQueue.length})
            </Text>
            {pendingQueue.map((task) => {
              const tColor =
                TYPES.find((t) => t.value === task.type)?.color || "#6366f1";
              return (
                <View
                  key={task.localId}
                  style={[
                    styles.queueCard,
                    { backgroundColor: colors.card, borderLeftColor: tColor },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.queueCardTitle, { color: colors.text }]}
                    >
                      {task.title}
                    </Text>
                    <Text
                      style={[styles.queueCardSub, { color: colors.muted }]}
                    >
                      {task.subject} | {task.type}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.pendingBadge,
                      { backgroundColor: "#f59e0b22" },
                    ]}
                  >
                    <Ionicons name="time-outline" size={11} color="#f59e0b" />
                    <Text style={styles.pendingBadgeText}>Pending</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.templateSection}>
          <View style={styles.templateHeaderRow}>
            <Text
              style={[
                styles.queueTitle,
                { color: colors.muted, marginBottom: 0 },
              ]}
            >
              Task Templates
            </Text>
            <TouchableOpacity
              onPress={openSaveTemplateModal}
              style={[
                styles.templateSaveBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons
                name="bookmark-outline"
                size={13}
                color={selectedType?.color || colors.primary}
              />
              <Text
                style={[
                  styles.templateSaveBtnText,
                  { color: selectedType?.color || colors.primary },
                ]}
              >
                Save Current
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.templateGrid}>
            {templates.map((template) => {
              const typeMeta = TYPES.find(
                (entry) => entry.value === template.type
              );
              const chipColor = typeMeta?.color || colors.primary;
              return (
                <View
                  key={template.id}
                  style={[
                    styles.templateChip,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.templateChipMain}
                    onPress={() => applyTemplate(template)}
                  >
                    <View
                      style={[
                        styles.templateTypeDot,
                        { backgroundColor: chipColor },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.templateChipTitle,
                          { color: colors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {template.name}
                      </Text>
                      <Text
                        style={[
                          styles.templateChipSub,
                          { color: colors.muted },
                        ]}
                        numberOfLines={1}
                      >
                        {typeMeta?.label || "Task"} ~
                        {Math.max(1, Number(template.dueOffsetHours) || 24)}h
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {!template.builtin && (
                    <TouchableOpacity
                      style={styles.templateDeleteBtn}
                      onPress={() =>
                        Alert.alert(
                          "Delete Template",
                          `Delete "${template.name}"?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => removeTemplate(template.id),
                            },
                          ]
                        )
                      }
                    >
                      <Ionicons
                        name="trash-outline"
                        size={14}
                        color={colors.danger}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>
          Task Title *
        </Text>
        <TextInput
          placeholder="e.g. Chapter 5 Essay"
          placeholderTextColor={colors.muted}
          value={title}
          onChangeText={setTitle}
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              color: colors.text,
              borderColor: title
                ? selectedType?.color || colors.primary
                : colors.border,
            },
          ]}
        />

        {/* Subject */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>
          Subject *
        </Text>
        <TextInput
          placeholder="e.g. Mathematics"
          placeholderTextColor={colors.muted}
          value={subject}
          onChangeText={setSubject}
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              color: colors.text,
              borderColor: subject
                ? selectedType?.color || colors.primary
                : colors.border,
            },
          ]}
        />

        {/* Task Type */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>
          Category
        </Text>
        <View style={styles.typeGrid}>
          {TYPES.map((t) => {
            const isActive = type === t.value;
            return (
              <TouchableOpacity
                key={t.value}
                onPress={() => setType(t.value)}
                style={[
                  styles.typeCard,
                  {
                    backgroundColor: isActive ? t.color : colors.card,
                    borderColor: isActive ? t.color : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={t.icon}
                  size={22}
                  color={isActive ? "#fff" : t.color}
                />
                <Text
                  style={[
                    styles.typeLabel,
                    { color: isActive ? "#fff" : colors.text },
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Priority */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>
          Priority
        </Text>
        <View style={styles.priorityRow}>
          {PRIORITIES.map((p) => {
            const isActive = priority === p.value;
            return (
              <TouchableOpacity
                key={p.value}
                onPress={() => setPriority(p.value)}
                style={[
                  styles.priorityBtn,
                  {
                    backgroundColor: isActive ? p.color : colors.card,
                    borderColor: isActive ? p.color : colors.border,
                    flex: 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.priorityDot,
                    { backgroundColor: isActive ? "#fff" : p.color },
                  ]}
                />
                <Text
                  style={[
                    styles.priorityLabel,
                    { color: isActive ? "#fff" : colors.text },
                  ]}
                >
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Due Date */}
        <Text style={[styles.inputLabel, { color: colors.muted }]}>
          Due Date & Time
        </Text>
        <TouchableOpacity
          onPress={openDateTimePicker}
          style={[
            styles.dateBtn,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons
            name="calendar-outline"
            size={18}
            color={selectedType?.color || colors.primary}
          />
          <Text style={[styles.dateBtnText, { color: colors.text }]}>
            {dueDate.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.muted}
            style={{ marginLeft: "auto" }}
          />
        </TouchableOpacity>

        {/* Preview card */}
        <View
          style={[
            styles.previewCard,
            {
              backgroundColor: colors.card,
              borderLeftColor: selectedType?.color || colors.primary,
            },
          ]}
        >
          <Text style={[styles.previewLabel, { color: colors.muted }]}>
            Preview
          </Text>
          <Text style={[styles.previewTitle, { color: colors.text }]}>
            {title || "Task title..."}
          </Text>
          <Text style={[styles.previewSub, { color: colors.muted }]}>
            {subject || "Subject..."} | {selectedType?.label}
          </Text>
          <View style={styles.previewBadgeRow}>
            <View
              style={[
                styles.previewBadge,
                {
                  backgroundColor:
                    (PRIORITIES.find((p) => p.value === priority)?.color ||
                      colors.primary) + "22",
                },
              ]}
            >
              <Text
                style={[
                  styles.previewBadgeText,
                  {
                    color:
                      PRIORITIES.find((p) => p.value === priority)?.color ||
                      colors.primary,
                  },
                ]}
              >
                {priority.toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.previewDate, { color: colors.muted }]}>
              Due{" "}
              {dueDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </Text>
            {!isOnline && (
              <View
                style={[
                  styles.previewBadge,
                  { backgroundColor: "#f59e0b22", marginLeft: "auto" },
                ]}
              >
                <Text style={[styles.previewBadgeText, { color: "#f59e0b" }]}>
                  OFFLINE
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[
            styles.saveBtn,
            {
              backgroundColor: saving
                ? colors.muted
                : selectedType?.color || colors.primary,
            },
          ]}
          onPress={save}
          disabled={saving}
        >
          <Ionicons
            name={
              saving
                ? "hourglass-outline"
                : isOnline
                  ? "checkmark-circle-outline"
                  : "cloud-offline-outline"
            }
            size={20}
            color="#fff"
          />
          <Text style={styles.saveBtnText}>
            {saving ? "Saving..." : isOnline ? "Save Task" : "Save Offline"}
          </Text>
        </TouchableOpacity>

        {!isOnline && (
          <View
            style={[
              styles.tipBox,
              { backgroundColor: isDark ? "#1e293b" : "#fefce8" },
            ]}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color="#f59e0b"
            />
            <Text
              style={[
                styles.tipText,
                { color: isDark ? "#fbbf24" : "#92400e" },
              ]}
            >
              You are offline. Tasks saved here are stored on your device and
              will automatically upload to the server the next time you open the
              app with internet.
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </Animated.ScrollView>

      <Modal visible={showTemplateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Save Task Template
            </Text>
            <Text style={[styles.modalSub, { color: colors.muted }]}>
              Save this task setup so you can add similar tasks in one tap.
            </Text>
            <TextInput
              placeholder="Template name"
              placeholderTextColor={colors.muted}
              value={templateNameInput}
              onChangeText={setTemplateNameInput}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />
            <TouchableOpacity
              style={[
                styles.modalPrimaryBtn,
                { backgroundColor: selectedType?.color || colors.primary },
              ]}
              onPress={saveAsTemplate}
            >
              <Text style={styles.modalPrimaryText}>Save Template</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSecondaryBtn, { borderColor: colors.border }]}
              onPress={() => setShowTemplateModal(false)}
            >
              <Text
                style={[styles.modalSecondaryText, { color: colors.muted }]}
              >
                Cancel
              </Text>
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
    paddingTop: 52,
    paddingBottom: 20,
    paddingHorizontal: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },
  headerCircle: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -40,
    right: -30,
  },
  headerCircle2: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  headerSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
  },
  offlinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(239,68,68,0.3)",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 6,
  },
  offlinePillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  syncPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  form: { padding: 18 },
  queueSection: { marginBottom: 20 },
  queueTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  queueCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  queueCardTitle: { fontSize: 13, fontWeight: "700" },
  queueCardSub: { fontSize: 11, marginTop: 2 },
  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingBadgeText: { fontSize: 10, fontWeight: "700", color: "#f59e0b" },
  templateSection: { marginBottom: 4 },
  templateHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  templateSaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  templateSaveBtnText: { fontSize: 11, fontWeight: "700" },
  templateGrid: { gap: 8 },
  templateChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  templateChipMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  templateTypeDot: { width: 8, height: 8, borderRadius: 4 },
  templateChipTitle: { fontSize: 12, fontWeight: "700" },
  templateChipSub: { fontSize: 10, marginTop: 1 },
  templateDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 13, fontSize: 15 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: {
    width: "47%",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    gap: 6,
  },
  typeLabel: { fontSize: 13, fontWeight: "600" },
  priorityRow: { flexDirection: "row", gap: 8 },
  priorityBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priorityLabel: { fontSize: 13, fontWeight: "600" },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  dateBtnText: { fontSize: 14, fontWeight: "500" },
  previewCard: {
    marginTop: 20,
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 4,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  previewTitle: { fontSize: 16, fontWeight: "700", marginBottom: 3 },
  previewSub: { fontSize: 13, marginBottom: 10 },
  previewBadgeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  previewBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  previewDate: { fontSize: 12 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 14,
    marginTop: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  tipBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
  },
  tipText: { flex: 1, fontSize: 12, lineHeight: 18 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", marginBottom: 6 },
  modalSub: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  modalPrimaryBtn: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  modalPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  modalSecondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 8,
  },
  modalSecondaryText: { fontSize: 12, fontWeight: "600" },
});
