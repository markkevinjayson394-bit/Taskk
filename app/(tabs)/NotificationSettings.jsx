import { Ionicons } from "@expo/vector-icons";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyStateCard from "../../components/EmptyStateCard";
import { auth } from "../../config/firebase";
import {
  DEFAULT_TIMES,
  useNotifications,
} from "../../context/NotificationContext";
import { useTheme } from "../../context/ThemeContext";
import { getDaysSinceLastSync } from "../../utils/classScheduleCache";
// Notification items with editable time keys
const NOTIFICATION_ITEMS = [
  {
    key: "classReminder",
    icon: "school",
    colorKey: "primary",
    title: "Class Reminder",
    description: "Reminder before each class starts",
    timeKey: "classReminder",
    timeType: "minutesBefore",
  },
  {
    key: "studySessionReminder",
    icon: "book",
    colorKey: "success",
    title: "Study Session Reminder",
    description: "Reminder before planned study blocks from your planner",
    timeKey: "studySessionReminder",
    timeType: "minutesBefore",
  },
  {
    key: "deadlineWarning",
    icon: "warning",
    colorKey: "danger",
    title: "Deadline Warnings",
    description:
      "Warns at 1d, 2h, 30m, and 1 minute before due time, plus due-time, follow-ups, and daily overdue reminders.",
    timeKey: null,
  },
  {
    key: "announcementAlert",
    icon: "megaphone",
    colorKey: "warning",
    title: "Announcement Alerts",
    description: "Notify me when admin posts a new announcement",
    timeKey: null,
  },
  {
    key: "morningBriefing",
    icon: "sunny",
    colorKey: "warning",
    title: "Morning Briefing",
    description: "Daily summary of classes, tasks, and deadlines",
    timeKey: "morningBriefing",
    timeType: "clock",
  },
  {
    key: "dailyAudit",
    icon: "moon",
    colorKey: "primary",
    title: "Daily Time Audit",
    description: "Daily reflection and quick next-day plan",
    timeKey: "dailyAudit",
    timeType: "clock",
  },
  {
    key: "sundayPlanning",
    icon: "calendar",
    colorKey: "success",
    title: "Sunday Planning",
    description: "Weekly planning session every Sunday",
    timeKey: "sundayPlanning",
    timeType: "clock",
  },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REPEAT_OPTIONS = [
  { value: "daily", label: "Every Day" },
  { value: "weekly", label: "Every Week" },
  { value: "once", label: "One Time" },
];
const PRESET_KEYS = [
  "classReminder",
  "studySessionReminder",
  "deadlineWarning",
  "announcementAlert",
  "morningBriefing",
  "dailyAudit",
  "sundayPlanning",
];
const PRESET_OPTIONS = [
  {
    key: "light",
    label: "Light",
    sub: "Core class + deadlines",
    settings: {
      classReminder: true,
      studySessionReminder: false,
      deadlineWarning: true,
      announcementAlert: true,
      morningBriefing: false,
      dailyAudit: false,
      sundayPlanning: false,
    },
  },
  {
    key: "balanced",
    label: "Balanced",
    sub: "Planning + reminders",
    settings: {
      classReminder: true,
      studySessionReminder: true,
      deadlineWarning: true,
      announcementAlert: true,
      morningBriefing: true,
      dailyAudit: false,
      sundayPlanning: false,
    },
  },
  {
    key: "full",
    label: "All",
    sub: "Everything enabled",
    settings: {
      classReminder: true,
      studySessionReminder: true,
      deadlineWarning: true,
      announcementAlert: true,
      morningBriefing: true,
      dailyAudit: true,
      sundayPlanning: true,
    },
  },
];
// Format time helpers
function formatClock(hour, minute) {
  const h = hour % 12 || 12;
  const m = String(minute).padStart(2, "0");
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
}
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatLeadTime(totalMinutes) {
  const mins = Math.max(1, Number(totalMinutes) || 1);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
  if (hours > 0) return `${hours}h`;
  return `${rem}m`;
}
function getMinutesEditorMeta(timeKey = "classReminder") {
  if (timeKey === "studySessionReminder") {
    return {
      title: "Study Session Reminder",
      prompt:
        "How many minutes before a planned study session should we remind you?",
      fieldLabel: "Lead Time Before Study Session (minutes)",
      displaySuffix: "before study session",
      example: "Example: 30 minutes = reminder before the study block starts",
    };
  }
  return {
    title: "Class Reminder",
    prompt: "How many minutes before class should we remind you?",
    fieldLabel: "Lead Time Before Class (minutes)",
    displaySuffix: "before class",
    example: "Example: 90 minutes = 1h 30m before class",
  };
}
function useSavingSet() {
  const [savingKeys, setSavingKeys] = useState(new Set());
  const isSaving = (key) => savingKeys.has(key);
  const startSaving = (key) => setSavingKeys((prev) => new Set([...prev, key]));
  const stopSaving = (key) =>
    setSavingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  return { isSaving, startSaving, stopSaving };
}
export default function NotificationSettings() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    settings,
    updateSettings,
    times,
    updateTimes,
    customNotifs,
    addCustomNotif,
    updateCustomNotif,
    deleteCustomNotif,
    permission,
    requestPermission,
    rescheduleAll,
    isExpoGo,
    nativeAlarmSupported,
    isIgnoringBatteryOptimizations,
    requestIgnoreBatteryOptimizations,
    canScheduleExactAlarms,
    openExactAlarmSettings,
    sendTestNotification,
    scheduleManagedDateNotification,
    getAlarmStyleContentOptions,
    taskAlarmTonePickerAvailable,
    taskAlarmAudioPickerAvailable,
    pickTaskAlarmTone,
    pickTaskAlarmAudioFile,
    showBatteryOptimizationPrompt,
    dismissBatteryPrompt,
  } = useNotifications();
  const [batteryOptimizationStatus, setBatteryOptimizationStatus] =
    useState(null);
  const [exactAlarmStatus, setExactAlarmStatus] = useState(null);
  const [scheduleLastSynced, setScheduleLastSynced] = useState(null);
  const checkBatteryOptimizationStatus = useCallback(async () => {
    if (Platform.OS !== "android" || !nativeAlarmSupported) {
      setBatteryOptimizationStatus(true);
      return;
    }
    try {
      const result = await isIgnoringBatteryOptimizations();
      const allowed = result?.status === "success" ? result.value : false;
      setBatteryOptimizationStatus(allowed);
    } catch (err) {
      console.warn("Battery optimization check failed:", err);
      setBatteryOptimizationStatus(false);
    }
  }, [nativeAlarmSupported, isIgnoringBatteryOptimizations]);

  const checkExactAlarmStatus = useCallback(async () => {
    if (Platform.OS !== "android" || !nativeAlarmSupported) {
      setExactAlarmStatus(true);
      return;
    }
    try {
      const result = await canScheduleExactAlarms();
      setExactAlarmStatus(result?.status === "success" ? result.value : false);
    } catch (err) {
      console.warn("Exact alarm permission check failed:", err);
      setExactAlarmStatus(false);
    }
  }, [nativeAlarmSupported, canScheduleExactAlarms]);

  useEffect(() => {
    checkBatteryOptimizationStatus();
    checkExactAlarmStatus();
  }, [checkBatteryOptimizationStatus, checkExactAlarmStatus]);

  useFocusEffect(
    useCallback(() => {
      checkBatteryOptimizationStatus();
      checkExactAlarmStatus();
    }, [checkBatteryOptimizationStatus, checkExactAlarmStatus])
  );
  const refreshScheduleSyncState = useCallback(() => {
    let active = true;
    const uid = auth.currentUser?.uid;

    if (!uid) {
      setScheduleLastSynced(null);
      return () => {
        active = false;
      };
    }

    getDaysSinceLastSync(uid).then((days) => {
      if (active) setScheduleLastSynced(days);
    });

    return () => {
      active = false;
    };
  }, []);
  useEffect(() => refreshScheduleSyncState(), [refreshScheduleSyncState]);
  useFocusEffect(
    useCallback(() => refreshScheduleSyncState(), [refreshScheduleSyncState])
  );
  const handleBatteryOptimization = async () => {
    const result = requestIgnoreBatteryOptimizations();
    const success = result?.status === "success";
    if (success) {
      setTimeout(() => checkBatteryOptimizationStatus(), 1000);
      Alert.alert(
        "Opened Settings",
        "Select 'Unrestricted' or 'Don't optimize' then return here."
      );
    } else {
      Alert.alert(
        "Not Available",
        "Battery optimization setting is not available on this device."
      );
    }
  };

  const handleExactAlarmPermission = async () => {
    openExactAlarmSettings();
    setTimeout(() => checkExactAlarmStatus(), 1000);
  };
  const { isSaving, startSaving, stopSaving } = useSavingSet();
  const [globalSaving, setGlobalSaving] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [showMinutesModal, setShowMinutesModal] = useState(false);
  const [minutesInput, setMinutesInput] = useState("");
  const [minutesTimeKey, setMinutesTimeKey] = useState("classReminder");
  // New custom notif form state
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newHour, setNewHour] = useState(8);
  const [newMinute, setNewMinute] = useState(0);
  const [newRepeat, setNewRepeat] = useState("daily");
  const [newWeekday, setNewWeekday] = useState(1);
  const [newDate, setNewDate] = useState(new Date());
  const resetCustomForm = () => {
    setNewTitle("");
    setNewBody("");
    setNewHour(8);
    setNewMinute(0);
    setNewRepeat("daily");
    setNewWeekday(1);
    setNewDate(new Date());
  };
  const handleToggle = async (key, value) => {
    if (isSaving(key)) return;
    startSaving(key);
    try {
      await updateSettings({ [key]: value });
    } finally {
      stopSaving(key);
    }
  };
  const openTimePicker = (timeKey, currentHour, currentMinute) => {
    const now = new Date();
    now.setHours(currentHour, currentMinute, 0, 0);
    try {
      DateTimePickerAndroid.open({
        value: now,
        mode: "time",
        is24Hour: false,
        onChange: async (event, selected) => {
          if (event.type !== "set" || !selected) return;
          try {
            await updateTimes({
              [timeKey]: {
                hour: selected.getHours(),
                minute: selected.getMinutes(),
              },
            });
          } catch (_err) {
            Alert.alert("Error", "Could not save the selected time.");
          }
        },
      });
    } catch (_err) {
      Alert.alert(
        "Picker Unavailable",
        "Could not open the time picker on this device."
      );
    }
  };
  const editMinutesBefore = (timeKey = "classReminder") => {
    const current =
      times?.[timeKey]?.minutesBefore ??
      DEFAULT_TIMES?.[timeKey]?.minutesBefore ??
      15;
    const meta = getMinutesEditorMeta(timeKey);
    if (Platform.OS === "ios") {
      Alert.prompt(
        meta.title,
        meta.prompt,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: async (val) => {
              const mins = parseInt(val, 10);
              if (isNaN(mins) || mins < 1 || mins > 1440) {
                Alert.alert(
                  "Invalid",
                  "Please enter a number between 1 and 1440 minutes."
                );
                return;
              }
              await updateTimes({ [timeKey]: { minutesBefore: mins } });
            },
          },
        ],
        "plain-text",
        String(current),
        "numeric"
      );
      return;
    }
    setMinutesTimeKey(timeKey);
    setMinutesInput(String(current));
    setShowMinutesModal(true);
  };
  const saveMinutesBefore = async () => {
    const mins = parseInt(minutesInput, 10);
    if (isNaN(mins) || mins < 1 || mins > 1440) {
      Alert.alert(
        "Invalid",
        "Please enter a number between 1 and 1440 minutes."
      );
      return;
    }
    await updateTimes({ [minutesTimeKey]: { minutesBefore: mins } });
    setShowMinutesModal(false);
  };
  const openNewTimePicker = () => {
    const now = new Date();
    now.setHours(newHour, newMinute, 0, 0);
    try {
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
    } catch (_err) {
      Alert.alert(
        "Picker Unavailable",
        "Could not open the time picker on this device."
      );
    }
  };
  const openNewDatePicker = () => {
    try {
      DateTimePickerAndroid.open({
        value: newDate,
        mode: "date",
        minimumDate: new Date(),
        onChange: (event, selected) => {
          if (event.type !== "set" || !selected) return;
          setNewDate(selected);
        },
      });
    } catch (_err) {
      Alert.alert(
        "Picker Unavailable",
        "Could not open the date picker on this device."
      );
    }
  };
  const saveCustomNotif = async () => {
    if (!newTitle.trim()) {
      Alert.alert(
        "Missing Title",
        "Please enter a title for your notification."
      );
      return;
    }
    if (newRepeat === "once") {
      const scheduledDate = new Date(newDate);
      scheduledDate.setHours(newHour, newMinute, 0, 0);
      if (scheduledDate <= new Date()) {
        Alert.alert(
          "Invalid Date & Time",
          "Please choose a future date and time for a one-time reminder."
        );
        return;
      }
    }
    await addCustomNotif({
      title: newTitle.trim(),
      body: newBody.trim() || "Quick reminder to stay on your plan.",
      hour: newHour,
      minute: newMinute,
      repeat: newRepeat,
      weekday: newWeekday,
      date: newRepeat === "once" ? newDate.toISOString() : undefined,
    });
    const savedTitle = newTitle.trim();
    resetCustomForm();
    setShowCustom(false);
    Alert.alert("Reminder Saved", `"${savedTitle}" has been scheduled.`);
  };
  const handlePermission = async () => {
    const granted = await requestPermission();
    if (granted) {
      Alert.alert("Enabled", "You will now receive reminders.");
      await rescheduleAll();
    } else {
      Alert.alert(
        "Permission Denied",
        "Enable notifications in your phone Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: openAppSettings },
        ]
      );
    }
  };
  const openAppSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (_err) {
      console.warn("Failed to open device settings:", _err);
      Alert.alert(
        "Settings Unavailable",
        "Please open your device settings manually."
      );
    }
  };
  const enabledCount = NOTIFICATION_ITEMS.filter((i) => settings[i.key]).length;
  const alarmModeEnabled = Boolean(settings.forceAcknowledgeAll);
  const currentTaskAlarmLabel =
    typeof settings.taskAlarmSoundLabel === "string" &&
    settings.taskAlarmSoundLabel.trim()
      ? settings.taskAlarmSoundLabel.trim()
      : "App Alarm";
  const canUseTonePicker =
    Platform.OS === "android" && Boolean(taskAlarmTonePickerAvailable);
  const canUseAudioPicker =
    Platform.OS === "android" && Boolean(taskAlarmAudioPickerAvailable);
  const canCustomizeAlarmSound = canUseTonePicker || canUseAudioPicker;
  const canResetCustomAlarmSound = Boolean(settings.taskAlarmSoundUri);
  const minutesEditorMeta = getMinutesEditorMeta(minutesTimeKey);
  const activePresetKey =
    PRESET_OPTIONS.find((preset) =>
      PRESET_KEYS.every(
        (key) => Boolean(settings[key]) === Boolean(preset.settings[key])
      )
    )?.key || "custom";
  const applyPreset = async (key) => {
    const preset = PRESET_OPTIONS.find((option) => option.key === key);
    if (!preset) return;
    setGlobalSaving(true);
    try {
      await updateSettings(preset.settings);
    } finally {
      setGlobalSaving(false);
    }
  };
  const handlePickTaskAlarmTone = async () => {
    if (!canUseTonePicker) {
      Alert.alert(
        "Sound Picker Unavailable",
        isExpoGo
          ? "Alarm sound changes require the installed Android build, not Expo Go."
          : "This build does not include the phone ringtone picker."
      );
      return;
    }
    setGlobalSaving(true);
    try {
      const selection = await pickTaskAlarmTone(settings.taskAlarmSoundUri);
      if (!selection?.uri) return;
      await updateSettings({
        taskAlarmSoundUri: selection.uri,
        taskAlarmSoundLabel: selection.label || "Phone tone",
      });
      Alert.alert(
        "Alarm Sound Updated",
        `Task and one-time planner alarms will use '${selection.label || "Phone tone"}' on this device.`
      );
    } catch (_err) {
      Alert.alert(
        "Sound Picker Unavailable",
        _err?.message || "Could not open the phone tone picker."
      );
    } finally {
      setGlobalSaving(false);
    }
  };
  const handlePickTaskAlarmAudio = async () => {
    if (!canUseAudioPicker) {
      Alert.alert(
        "Audio Picker Unavailable",
        isExpoGo
          ? "Alarm sound changes require the installed Android build, not Expo Go."
          : "This build does not include the local audio picker."
      );
      return;
    }
    setGlobalSaving(true);
    try {
      const selection = await pickTaskAlarmAudioFile();
      if (!selection?.uri) return;
      await updateSettings({
        taskAlarmSoundUri: selection.uri,
        taskAlarmSoundLabel: selection.label || "Selected audio",
      });
      Alert.alert(
        "Alarm Audio Updated",
        `Task and one-time planner alarms will use '${selection.label || "Selected audio"}' on this device.`
      );
    } catch (_err) {
      Alert.alert(
        "Audio Picker Unavailable",
        _err?.message || "Could not open the audio picker."
      );
    } finally {
      setGlobalSaving(false);
    }
  };
  const handleResetTaskAlarmSound = async () => {
    setGlobalSaving(true);
    try {
      await updateSettings({
        taskAlarmSoundUri: "",
        taskAlarmSoundLabel: "App Alarm",
      });
      Alert.alert(
        "Alarm Sound Reset",
        "Task and one-time planner alarms will use the built-in app alarm sound on this device."
      );
    } finally {
      setGlobalSaving(false);
    }
  };
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.primary}
      />
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.primary, paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.headerCircle} />
        <View style={styles.headerCircle2} />
        <Text style={styles.headerSub}>Stay on track</Text>
        <Text style={styles.headerTitle}>Notifications</Text>
        <Text style={styles.headerMeta}>
          Clean reminders for classes, tasks, and study flow
        </Text>
        <View style={styles.headerStats}>
          <View
            style={[
              styles.statPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="notifications" size={12} color="#fff" />
            <Text style={styles.statPillText}>
              {enabledCount} of {NOTIFICATION_ITEMS.length} active
            </Text>
          </View>
          <View
            style={[
              styles.statPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="add-circle" size={12} color="#fff" />
            <Text style={styles.statPillText}>
              {customNotifs.length} custom
            </Text>
          </View>
          {!permission && (
            <View
              style={[
                styles.statPill,
                { backgroundColor: `${colors.danger}40` },
              ]}
            >
              <Ionicons name="warning" size={12} color="#fff" />
              <Text style={styles.statPillText}>Permission needed</Text>
            </View>
          )}
          {Platform.OS === "android" &&
            nativeAlarmSupported &&
            batteryOptimizationStatus === false && (
              <View
                style={[
                  styles.statPill,
                  { backgroundColor: `${colors.warning}40` },
                ]}
              >
                <Ionicons
                  name="battery-charging-outline"
                  size={12}
                  color="#fff"
                />
                <Text style={styles.statPillText}>Battery restricted</Text>
              </View>
            )}
          {Platform.OS === "android" &&
            nativeAlarmSupported &&
            exactAlarmStatus === false && (
              <View
                style={[
                  styles.statPill,
                  { backgroundColor: `${colors.danger}40` },
                ]}
              >
                <Ionicons name="warning" size={12} color="#fff" />
                <Text style={styles.statPillText}>Exact alarm off</Text>
              </View>
            )}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Permission warning */}
        {!permission && (
          <TouchableOpacity
            style={[
              styles.permissionBox,
              { backgroundColor: colors.dangerBg, borderColor: colors.danger },
            ]}
            onPress={handlePermission}
          >
            <View style={styles.permissionLeft}>
              <Ionicons
                name="notifications-off"
                size={22}
                color={colors.danger}
              />
              <View>
                <Text style={styles.permissionTitle}>
                  Notifications are disabled
                </Text>
                <Text style={styles.permissionSub}>
                  Tap here to enable them
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.danger} />
          </TouchableOpacity>
        )}
        {/* Battery optimization one-time explanation prompt */}
        {Platform.OS === "android" &&
          nativeAlarmSupported &&
          showBatteryOptimizationPrompt && (
            <View
              style={[
                styles.permissionBox,
                {
                  backgroundColor: `${colors.warning}10`,
                  borderColor: colors.warning,
                  flexDirection: "column",
                },
              ]}
            >
              <View style={styles.permissionLeft}>
                <Ionicons
                  name="battery-charging-outline"
                  size={22}
                  color={colors.warning}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.permissionTitle, { color: colors.warning }]}
                  >
                    Background alarms need battery exemption
                  </Text>
                  <Text
                    style={[
                      styles.permissionSub,
                      { color: `${colors.warning}cc`, marginTop: 2 },
                    ]}
                  >
                    On MIUI, OneUI, and ColorOS, battery optimization can kill
                    alarms in the background. Add this app to &quot;Don&apos;t
                    optimize&quot; so alarms fire reliably.
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", marginTop: 10, gap: 10 }}>
                <TouchableOpacity
                  style={[
                    styles.halfBtn,
                    {
                      backgroundColor: `${colors.warning}20`,
                      borderColor: colors.warning,
                    },
                  ]}
                  onPress={handleBatteryOptimization}
                >
                  <Text style={[styles.halfBtnText, { color: colors.warning }]}>
                    Open Settings
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.halfBtn, { backgroundColor: colors.card }]}
                  onPress={dismissBatteryPrompt}
                >
                  <Text style={[styles.halfBtnText, { color: colors.muted }]}>
                    Dismiss
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        {/* Exact Alarm Permission (Android 12+) */}
        {Platform.OS === "android" &&
          nativeAlarmSupported &&
          exactAlarmStatus === false && (
            <TouchableOpacity
              style={[
                styles.permissionBox,
                {
                  backgroundColor: `${colors.danger}10`,
                  borderColor: colors.danger,
                },
              ]}
              onPress={handleExactAlarmPermission}
            >
              <View style={styles.permissionLeft}>
                <Ionicons name="alarm" size={22} color={colors.danger} />
                <View>
                  <Text
                    style={[styles.permissionTitle, { color: colors.danger }]}
                  >
                    Exact alarm permission needed
                  </Text>
                  <Text
                    style={[
                      styles.permissionSub,
                      { color: `${colors.danger}cc` },
                    ]}
                  >
                    After app updates, this permission resets. Enable it for
                    full-screen alarm popups.
                  </Text>
                </View>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.danger}
              />
            </TouchableOpacity>
          )}
        {/* Battery Optimization Permission (Android) */}
        {Platform.OS === "android" &&
          nativeAlarmSupported &&
          batteryOptimizationStatus === false && (
            <TouchableOpacity
              style={[
                styles.permissionBox,
                {
                  backgroundColor: `${colors.warning}10`,
                  borderColor: colors.warning,
                },
              ]}
              onPress={handleBatteryOptimization}
            >
              <View style={styles.permissionLeft}>
                <Ionicons
                  name="battery-charging-outline"
                  size={22}
                  color={colors.warning}
                />
                <View>
                  <Text
                    style={[styles.permissionTitle, { color: colors.warning }]}
                  >
                    Unrestricted battery needed
                  </Text>
                  <Text
                    style={[
                      styles.permissionSub,
                      { color: `${colors.warning}cc` },
                    ]}
                  >
                    Enable for reliable background notifications via
                    &quot;Don&apos;t optimize&quot;
                  </Text>
                </View>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.warning}
              />
            </TouchableOpacity>
          )}
        {/* Reminder Intensity */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Reminder Intensity
        </Text>
        <View
          style={[
            styles.presetCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.presetRow}>
            {PRESET_OPTIONS.map((preset) => {
              const isActive = activePresetKey === preset.key;
              return (
                <TouchableOpacity
                  key={preset.key}
                  style={[
                    styles.presetChip,
                    {
                      borderColor: isActive ? colors.primary : colors.border,
                      backgroundColor: isActive
                        ? colors.primary
                        : "transparent",
                    },
                  ]}
                  onPress={() => applyPreset(preset.key)}
                  disabled={globalSaving}
                >
                  <Text
                    style={[
                      styles.presetTitle,
                      { color: isActive ? "#fff" : colors.text },
                    ]}
                  >
                    {preset.label}
                  </Text>
                  <Text
                    style={[
                      styles.presetSub,
                      {
                        color: isActive
                          ? "rgba(255,255,255,0.85)"
                          : colors.muted,
                      },
                    ]}
                  >
                    {preset.sub}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {activePresetKey === "custom" && (
            <Text style={[styles.presetNote, { color: colors.muted }]}>
              Custom mix active
            </Text>
          )}
        </View>
        {/* Alarm Settings */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Alarm Settings
        </Text>
        <View
          style={[
            styles.settingsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.settingsRow, styles.settingsRowFirst]}>
            <Ionicons name="alarm-outline" size={18} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Force Acknowledge for All
              </Text>
              <Text style={[styles.cardDesc, { color: colors.muted }]}>
                Adds alarm actions (Acknowledge/Snooze), keeps reminders sticky,
                and repeats vibration/sound until acknowledged.
              </Text>
            </View>
            <Switch
              value={alarmModeEnabled}
              onValueChange={(val) => handleToggle("forceAcknowledgeAll", val)}
              trackColor={{ false: colors.border, true: "#ef444466" }}
              thumbColor={
                alarmModeEnabled ? "#ef4444" : isDark ? "#475569" : "#cbd5e1"
              }
              disabled={globalSaving || isSaving("forceAcknowledgeAll")}
            />
          </View>
          {/* Notification sound  Android only */}
          {Platform.OS === "android" && (
            <View
              style={[
                styles.settingsRow,
                styles.settingsRowStacked,
                { borderTopWidth: 1, borderTopColor: colors.border },
              ]}
            >
              <View style={styles.settingsRowHeader}>
                <Ionicons
                  name="musical-notes-outline"
                  size={18}
                  color="#0ea5e9"
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    Notification Sound
                  </Text>
                  <Text style={[styles.cardDesc, { color: colors.muted }]}>
                    Used for task alarms and alarm-style planner reminders on
                    this device. Sound files are device-specific and won&apos;t
                    sync across phones.
                  </Text>
                </View>
              </View>
              <View style={styles.settingsInsetBlock}>
                <View
                  style={[
                    styles.soundPill,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Ionicons name="musical-note" size={13} color="#0ea5e9" />
                  <Text
                    style={[styles.soundPillText, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {currentTaskAlarmLabel}
                  </Text>
                  {settings.taskAlarmSoundUri ? (
                    <View style={styles.soundPillBadge}>
                      <Text style={styles.soundPillBadgeText}>Custom</Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.soundPillBadge,
                        { backgroundColor: "#10b98120" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.soundPillBadgeText,
                          { color: "#10b981" },
                        ]}
                      >
                        Default
                      </Text>
                    </View>
                  )}
                </View>
                {!canCustomizeAlarmSound && (
                  <View
                    style={[
                      styles.soundUnavailableBox,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  >
                    <Ionicons
                      name="information-circle-outline"
                      size={14}
                      color={colors.muted}
                    />
                    <Text
                      style={[
                        styles.soundUnavailableText,
                        { color: colors.muted },
                      ]}
                    >
                      {isExpoGo
                        ? "Expo Go cannot change alarm sounds. Open the installed Android app build instead."
                        : "This build does not expose the native alarm sound picker."}
                    </Text>
                  </View>
                )}
                {(canUseTonePicker ||
                  canUseAudioPicker ||
                  canResetCustomAlarmSound) && (
                  <View style={styles.settingsActionWrap}>
                    {canUseTonePicker ? (
                      <TouchableOpacity
                        style={styles.settingsBtn}
                        onPress={handlePickTaskAlarmTone}
                        disabled={globalSaving}
                      >
                        <Ionicons
                          name="phone-portrait-outline"
                          size={13}
                          color="#fff"
                        />
                        <Text style={styles.settingsBtnText}>Ringtone</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canUseAudioPicker ? (
                      <TouchableOpacity
                        style={styles.settingsBtn}
                        onPress={handlePickTaskAlarmAudio}
                        disabled={globalSaving}
                      >
                        <Ionicons
                          name="folder-open-outline"
                          size={13}
                          color="#fff"
                        />
                        <Text style={styles.settingsBtnText}>My Music</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canResetCustomAlarmSound ? (
                      <TouchableOpacity
                        style={[
                          styles.settingsBtn,
                          styles.settingsBtnSecondary,
                        ]}
                        onPress={handleResetTaskAlarmSound}
                        disabled={globalSaving}
                      >
                        <Ionicons
                          name="refresh-outline"
                          size={13}
                          color="#fff"
                        />
                        <Text style={styles.settingsBtnText}>Reset</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
        {/* Test Full-Screen Popup */}
        <TouchableOpacity
          style={[
            styles.permissionBox,
            {
              backgroundColor: `${colors.danger}10`,
              borderColor: colors.danger,
            },
          ]}
          onPress={async () => {
            const triggerDate = new Date(Date.now() + 30000);
            const result = await scheduleManagedDateNotification({
              identifier: `alarm_popup_test_${Date.now()}`,
              title: "Full-Screen Popup Test",
              body: "This is a test of the full-screen popup alarm. Check your lock screen!",
              triggerDate,
              contentExtra: {
                data: {
                  type: "alarm_popup_test",
                  acknowledgeRequired: true,
                  isPopupTest: true,
                },
                ...getAlarmStyleContentOptions({
                  includeActions: true,
                  dueNow: true,
                  sticky: true,
                }),
              },
              preferExactAlarm: true,
            });
            if (result) {
              Alert.alert(
                "Test Scheduled",
                "A full-screen popup test will fire in 30 seconds. Make sure your lock screen is showing and check for a popup alarm."
              );
            } else {
              Alert.alert("Test Failed", "Could not schedule popup test.");
            }
          }}
        >
          <View style={styles.permissionLeft}>
            <Ionicons
              name="phone-portrait-outline"
              size={22}
              color={colors.danger}
            />
            <View>
              <Text style={[styles.permissionTitle, { color: colors.danger }]}>
                Test Full-Screen Popup
              </Text>
              <Text
                style={[styles.permissionSub, { color: `${colors.danger}cc` }]}
              >
                Fires in 30 seconds — tests lock screen popup
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.danger} />
        </TouchableOpacity>

        {/* Test Notification */}
        <TouchableOpacity
          style={[
            styles.permissionBox,
            {
              backgroundColor: `${colors.primary}10`,
              borderColor: colors.primary,
            },
          ]}
          onPress={async () => {
            const result = await sendTestNotification({ alarmStyle: true });
            if (result.ok) {
              Alert.alert(
                "Test Sent",
                "A test notification is firing now. Check your notification shade."
              );
            } else {
              Alert.alert(
                "Test Failed",
                result.reason || "Could not send test notification."
              );
            }
          }}
        >
          <View style={styles.permissionLeft}>
            <Ionicons
              name="notifications-circle-outline"
              size={22}
              color={colors.primary}
            />
            <View>
              <Text style={[styles.permissionTitle, { color: colors.primary }]}>
                Send Test Notification
              </Text>
              <Text
                style={[styles.permissionSub, { color: `${colors.primary}cc` }]}
              >
                Verify your notification settings are working
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>

        {/* Permissions & Access */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Permissions & Access
        </Text>
        <View
          style={[
            styles.settingsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.settingsRow, styles.settingsRowFirst]}>
            <Ionicons
              name="settings-outline"
              size={18}
              color={colors.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Open App Settings
              </Text>
              <Text style={[styles.cardDesc, { color: colors.muted }]}>
                Manage notification permissions, battery optimization, and
                app-level preferences.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={openAppSettings}
            >
              <Text style={styles.settingsBtnText}>Open</Text>
            </TouchableOpacity>
          </View>
          {/* Battery Optimization Setting - Android only */}
          {Platform.OS === "android" && (
            <View
              style={[
                styles.settingsRow,
                { borderTopWidth: 1, borderTopColor: colors.border },
              ]}
            >
              <Ionicons
                name="battery-charging-outline"
                size={18}
                color={colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Battery Optimization
                </Text>
                <Text style={[styles.cardDesc, { color: colors.muted }]}>
                  {batteryOptimizationStatus === true
                    ? "Unrestricted mode is active — background notifications are reliable."
                    : "Restrictive mode may delay notifications. Tap to enable unrestricted."}
                </Text>
              </View>
              {batteryOptimizationStatus !== true && (
                <TouchableOpacity
                  style={styles.settingsBtn}
                  onPress={handleBatteryOptimization}
                >
                  <Text style={styles.settingsBtnText}>Fix</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {/* Exact Alarm Setting - Android only */}
          {Platform.OS === "android" && nativeAlarmSupported && (
            <View
              style={[
                styles.settingsRow,
                { borderTopWidth: 1, borderTopColor: colors.border },
              ]}
            >
              <Ionicons
                name="alarm"
                size={18}
                color={
                  exactAlarmStatus === false ? colors.danger : colors.success
                }
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Exact Alarms
                </Text>
                <Text style={[styles.cardDesc, { color: colors.muted }]}>
                  {exactAlarmStatus === true
                    ? "Exact alarms are enabled — full-screen popups will appear for deadline alarms."
                    : "Exact alarms are disabled. Tap to open settings and re-enable them after an app update."}
                </Text>
              </View>
              {exactAlarmStatus !== true && (
                <TouchableOpacity
                  style={styles.settingsBtn}
                  onPress={handleExactAlarmPermission}
                >
                  <Text style={styles.settingsBtnText}>Fix</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        {/* Built-in Reminders */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Built-in Reminders
        </Text>
        {NOTIFICATION_ITEMS.map((item) => {
          const isEnabled = settings[item.key] ?? true;
          const t = times[item.timeKey] || DEFAULT_TIMES[item.timeKey];
          const itemSaving = isSaving(item.key);
          const itemColor = colors[item.colorKey];
          return (
            <View
              key={item.key}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: isEnabled ? `${itemColor}30` : colors.border,
                  opacity: !permission ? 0.65 : 1,
                },
              ]}
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.iconBox,
                    {
                      backgroundColor: isEnabled
                        ? `${itemColor}18`
                        : isDark
                          ? colors.surfaceDark
                          : colors.highlight,
                    },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={isEnabled ? itemColor : colors.muted}
                  />
                </View>
                <View style={styles.cardText}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.cardDesc, { color: colors.muted }]}>
                    {item.description}
                  </Text>
                </View>
                <Switch
                  value={isEnabled}
                  onValueChange={(val) => handleToggle(item.key, val)}
                  trackColor={{
                    false: colors.border,
                    true: `${itemColor}66`,
                  }}
                  thumbColor={
                    isEnabled
                      ? itemColor
                      : isDark
                        ? colors.surface
                        : colors.border
                  }
                  disabled={!permission || itemSaving}
                />
              </View>
              {item.key === "classReminder" &&
                scheduleLastSynced !== null &&
                scheduleLastSynced > 7 && (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginTop: 6,
                    }}
                  >
                    <Ionicons
                      name="warning-outline"
                      size={12}
                      color={colors.warning}
                    />
                    <Text
                      style={[
                        styles.cardDesc,
                        {
                          color: colors.warning,
                          fontSize: 11,
                          marginLeft: 6,
                          flex: 1,
                        },
                      ]}
                    >
                      Class schedule last synced{" "}
                      {Math.floor(scheduleLastSynced)} days ago. Connect to
                      internet to refresh.
                    </Text>
                  </View>
                )}
              {/* Editable time row */}
              {isEnabled && item.timeKey && (
                <TouchableOpacity
                  style={[styles.timeRow, { borderTopColor: colors.border }]}
                  onPress={() => {
                    if (item.timeType === "minutesBefore") {
                      editMinutesBefore(item.timeKey);
                    } else {
                      openTimePicker(
                        item.timeKey,
                        t?.hour ?? 7,
                        t?.minute ?? 0
                      );
                    }
                  }}
                  disabled={!permission}
                >
                  <Ionicons name="time-outline" size={14} color={itemColor} />
                  <Text style={[styles.timeLabel, { color: colors.muted }]}>
                    {item.timeType === "minutesBefore"
                      ? `${formatLeadTime(t?.minutesBefore ?? 15)} ${
                          getMinutesEditorMeta(item.timeKey).displaySuffix
                        }`
                      : `Every day at ${formatClock(t?.hour ?? 7, t?.minute ?? 0)}`}
                    {item.key === "sundayPlanning" ? " (Sundays)" : ""}
                  </Text>
                  <View
                    style={[
                      styles.editChip,
                      { backgroundColor: `${itemColor}18` },
                    ]}
                  >
                    <Ionicons name="pencil" size={11} color={itemColor} />
                    <Text style={[styles.editChipText, { color: itemColor }]}>
                      Edit time
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
        {/* Custom Notifications */}
        <View style={styles.customHeader}>
          <Text
            style={[
              styles.sectionLabel,
              { color: colors.muted, marginBottom: 0 },
            ]}
          >
            My Custom Reminders
          </Text>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: "#007bff" }]}
            onPress={() => {
              resetCustomForm();
              setShowCustom(true);
            }}
          >
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={styles.addBtnText}>Add New</Text>
          </TouchableOpacity>
        </View>
        {customNotifs.length === 0 ? (
          <EmptyStateCard
            title="No custom reminders yet"
            message="Tap Add New to create your own reminder — study sessions, medicine, anything."
            icon="notifications-outline"
            style={{ borderStyle: "dashed" }}
          />
        ) : (
          customNotifs.map((cn) => (
            <View
              key={cn.id}
              style={[
                styles.customCard,
                {
                  backgroundColor: colors.card,
                  borderColor: cn.enabled ? "#007bff30" : colors.border,
                },
              ]}
            >
              <View style={styles.customCardTop}>
                <View
                  style={[
                    styles.customIconBox,
                    {
                      backgroundColor: cn.enabled
                        ? "#007bff18"
                        : isDark
                          ? "#1e293b"
                          : "#f1f5f9",
                    },
                  ]}
                >
                  <Ionicons
                    name="notifications"
                    size={18}
                    color={cn.enabled ? "#007bff" : colors.muted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.customTitle, { color: colors.text }]}>
                    {cn.title}
                  </Text>
                  <Text
                    style={[styles.customSub, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {cn.body}
                  </Text>
                  <View style={styles.customMeta}>
                    <View
                      style={[
                        styles.metaChip,
                        { backgroundColor: "#007bff15" },
                      ]}
                    >
                      <Ionicons name="time-outline" size={10} color="#007bff" />
                      <Text style={[styles.metaChipText, { color: "#007bff" }]}>
                        {formatClock(cn.hour, cn.minute)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.metaChip,
                        { backgroundColor: "#10b98115" },
                      ]}
                    >
                      <Ionicons name="repeat" size={10} color="#10b981" />
                      <Text style={[styles.metaChipText, { color: "#10b981" }]}>
                        {cn.repeat === "daily"
                          ? "Every day"
                          : cn.repeat === "weekly"
                            ? `Every ${DAYS[cn.weekday ?? 1]}`
                            : cn.date
                              ? `On ${formatDate(cn.date)}`
                              : "One time"}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.customActions}>
                  <Switch
                    value={cn.enabled}
                    onValueChange={(val) =>
                      updateCustomNotif(cn.id, { enabled: val })
                    }
                    trackColor={{
                      false: colors.border,
                      true: "#007bff66",
                    }}
                    thumbColor={
                      cn.enabled ? "#007bff" : isDark ? "#475569" : "#cbd5e1"
                    }
                    disabled={!permission}
                  />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() =>
                      Alert.alert("Delete Reminder", `Delete "${cn.title}"?`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deleteCustomNotif(cn.id),
                        },
                      ])
                    }
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
      {/* Add Custom Notification Modal */}
      <Modal visible={showCustom} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                New Reminder
              </Text>
              {/* Title */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Title *
              </Text>
              <TextInput
                placeholder="e.g. Study for Finals"
                placeholderTextColor={colors.muted}
                value={newTitle}
                onChangeText={setNewTitle}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: newTitle ? "#007bff" : colors.border,
                  },
                ]}
              />
              {/* Message */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Message (optional)
              </Text>
              <TextInput
                placeholder="e.g. Don't forget to review your notes!"
                placeholderTextColor={colors.muted}
                value={newBody}
                onChangeText={setNewBody}
                multiline
                numberOfLines={2}
                style={[
                  styles.input,
                  styles.inputMulti,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />
              {/* Time */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Time
              </Text>
              <TouchableOpacity
                style={[
                  styles.timePickerBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={openNewTimePicker}
              >
                <Ionicons name="time-outline" size={18} color="#007bff" />
                <Text style={[styles.timePickerText, { color: colors.text }]}>
                  {formatClock(newHour, newMinute)}
                </Text>
                <View
                  style={[
                    styles.editChip,
                    { backgroundColor: "#007bff18", marginLeft: "auto" },
                  ]}
                >
                  <Ionicons name="pencil" size={11} color="#007bff" />
                  <Text style={[styles.editChipText, { color: "#007bff" }]}>
                    Change
                  </Text>
                </View>
              </TouchableOpacity>
              {/* Repeat */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Repeat
              </Text>
              <View style={styles.repeatRow}>
                {REPEAT_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    onPress={() => setNewRepeat(r.value)}
                    style={[
                      styles.repeatChip,
                      {
                        backgroundColor:
                          newRepeat === r.value ? "#007bff" : colors.background,
                        borderColor:
                          newRepeat === r.value ? "#007bff" : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.repeatChipText,
                        {
                          color: newRepeat === r.value ? "#fff" : colors.muted,
                        },
                      ]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Date (one-time only) */}
              {newRepeat === "once" && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                    Date
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.timePickerBtn,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={openNewDatePicker}
                  >
                    <Ionicons name="calendar" size={18} color="#007bff" />
                    <Text
                      style={[styles.timePickerText, { color: colors.text }]}
                    >
                      {formatDate(newDate)}
                    </Text>
                    <View
                      style={[
                        styles.editChip,
                        { backgroundColor: "#007bff18", marginLeft: "auto" },
                      ]}
                    >
                      <Ionicons name="pencil" size={11} color="#007bff" />
                      <Text style={[styles.editChipText, { color: "#007bff" }]}>
                        Change
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}
              {/* Weekday picker (weekly only) */}
              {newRepeat === "weekly" && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                    Day of Week
                  </Text>
                  <View style={styles.daysRow}>
                    {DAYS.map((day, i) => (
                      <TouchableOpacity
                        key={day}
                        onPress={() => setNewWeekday(i)}
                        style={[
                          styles.dayChip,
                          {
                            backgroundColor:
                              newWeekday === i ? "#007bff" : colors.background,
                            borderColor:
                              newWeekday === i ? "#007bff" : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayChipText,
                            {
                              color: newWeekday === i ? "#fff" : colors.muted,
                            },
                          ]}
                        >
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
                onPress={() => {
                  resetCustomForm();
                  setShowCustom(false);
                }}
              >
                <Text style={[styles.cancelBtnText, { color: colors.muted }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Minutes-before Modal */}
      <Modal visible={showMinutesModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {minutesEditorMeta.title}
            </Text>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              {minutesEditorMeta.fieldLabel}
            </Text>
            <TextInput
              value={minutesInput}
              onChangeText={setMinutesInput}
              keyboardType="numeric"
              placeholder="Enter 1 to 1440"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text
              style={[styles.cardDesc, { color: colors.muted, marginTop: 8 }]}
            >
              {minutesEditorMeta.example}
            </Text>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: "#007bff" }]}
              onPress={saveMinutesBefore}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowMinutesModal(false)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.muted }]}>
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
    paddingTop: 56,
    paddingBottom: 24,
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
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerCircle2: {
    position: "absolute",
    width: 105,
    height: 105,
    borderRadius: 52.5,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 4,
  },
  headerMeta: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 12,
  },
  headerStats: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  permissionBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  permissionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  permissionTitle: { fontSize: 13, fontWeight: "700", color: "#ef4444" },
  permissionSub: { fontSize: 11, color: "#f87171", marginTop: 2 },
  halfBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  halfBtnText: { fontSize: 12, fontWeight: "600" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 6,
  },
  settingsCard: {
    marginBottom: 18,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  presetCard: {
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  presetChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  presetTitle: { fontSize: 12, fontWeight: "800" },
  presetSub: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
    textAlign: "center",
  },
  presetNote: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  settingsRowStacked: {
    alignItems: "stretch",
  },
  settingsRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  settingsRowFirst: {
    borderTopWidth: 0,
  },
  settingsBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  settingsBtnSecondary: {
    backgroundColor: "#475569",
  },
  settingsBtnDisabled: {
    opacity: 0.5,
  },
  settingsBtnText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  settingsActionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  settingsInsetBlock: {
    marginTop: 10,
    gap: 10,
  },
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  cardDesc: { fontSize: 12, lineHeight: 17 },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  timeLabel: { flex: 1, fontSize: 12, fontWeight: "500" },
  editChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  editChipText: { fontSize: 11, fontWeight: "700" },
  customHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  customCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  customCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  customIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  customTitle: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  customSub: { fontSize: 12, marginBottom: 6 },
  customMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  metaChipText: { fontSize: 10, fontWeight: "700" },
  customActions: { alignItems: "center", gap: 6 },
  deleteBtn: { padding: 4 },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "90%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#cbd5e1",
    alignSelf: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 16,
    textAlign: "center",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 14,
  },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14 },
  inputMulti: { minHeight: 64, textAlignVertical: "top" },
  timePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
  },
  timePickerText: { fontSize: 15, fontWeight: "600" },
  repeatRow: { flexDirection: "row", gap: 8 },
  repeatChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  repeatChipText: { fontSize: 12, fontWeight: "700" },
  daysRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  dayChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  dayChipText: { fontSize: 11, fontWeight: "700" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    marginTop: 20,
  },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  cancelBtn: {
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600" },
  // Sound pill
  soundPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  soundPillText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "600",
  },
  soundPillBadge: {
    backgroundColor: "#0ea5e920",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  soundPillBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0ea5e9",
  },
  soundUnavailableBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  soundUnavailableText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
});
