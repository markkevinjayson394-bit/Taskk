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
    Alert,
    Linking,
    Modal,
    NativeModules,
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
import {
    DEFAULT_TIMES,
    useNotifications,
} from "../../context/NotificationContext";
import { formatSyncTime, useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";

//  Notification items with editable time keys
const NOTIFICATION_ITEMS = [
  {
    key: "classReminder",
    icon: "school",
    color: "#007bff",
    title: "Class Reminder",
    description: "Reminder before each class starts",
    timeKey: "classReminder",
    timeType: "minutesBefore",
  },
  {
    key: "deadlineWarning",
    icon: "warning",
    color: "#ef4444",
    title: "Deadline Warnings",
    description: "Warns you at 7d, 3d, 1d, and exact due time",
    timeKey: null, // not editable  fires based on task due date
  },
  {
    key: "announcementAlert",
    icon: "megaphone",
    color: "#f59e0b",
    title: "Announcement Alerts",
    description: "Notify me when admin posts a new announcement",
    timeKey: null,
  },
  {
    key: "morningBriefing",
    icon: "sunny",
    color: "#f59e0b",
    title: "Morning Briefing",
    description: "Daily summary of classes, tasks, and deadlines",
    timeKey: "morningBriefing",
    timeType: "clock",
  },
  {
    key: "dailyAudit",
    icon: "moon",
    color: "#6366f1",
    title: "Daily Time Audit",
    description: "Daily reflection and quick next-day plan",
    timeKey: "dailyAudit",
    timeType: "clock",
  },
  {
    key: "sundayPlanning",
    icon: "calendar",
    color: "#10b981",
    title: "Sunday Planning",
    description: "Weekly planning session every Sunday",
    timeKey: "sundayPlanning",
    timeType: "clock",
  },
  {
    key: "breakReminder",
    icon: "cafe",
    color: "#0ea5e9",
    title: "Break Reminder",
    description: "After 90 minutes of device app usage",
    timeKey: null,
  },
  {
    key: "appUsageCheck",
    icon: "phone-portrait",
    color: "#8b5cf6",
    title: "App Usage Check",
    description: "After 30 minutes - study relevance check",
    timeKey: null,
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
  "deadlineWarning",
  "announcementAlert",
  "morningBriefing",
  "dailyAudit",
  "sundayPlanning",
  "breakReminder",
  "appUsageCheck",
];
const PRESET_OPTIONS = [
  {
    key: "light",
    label: "Light",
    sub: "Core class + deadlines",
    settings: {
      classReminder: true,
      deadlineWarning: true,
      announcementAlert: true,
      morningBriefing: false,
      dailyAudit: false,
      sundayPlanning: false,
      breakReminder: false,
      appUsageCheck: false,
    },
  },
  {
    key: "balanced",
    label: "Balanced",
    sub: "Planning + reminders",
    settings: {
      classReminder: true,
      deadlineWarning: true,
      announcementAlert: true,
      morningBriefing: true,
      dailyAudit: true,
      sundayPlanning: true,
      breakReminder: false,
      appUsageCheck: false,
    },
  },
  {
    key: "full",
    label: "All",
    sub: "Everything enabled",
    settings: {
      classReminder: true,
      deadlineWarning: true,
      announcementAlert: true,
      morningBriefing: true,
      dailyAudit: true,
      sundayPlanning: true,
      breakReminder: true,
      appUsageCheck: true,
    },
  },
];

//  Format time helper
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

function formatMinutes(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
  if (hours > 0) return `${hours}h`;
  return `${rem}m`;
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
    notificationsAvailable,
    isExpoGo,
    appUsageMin,
    weekUsageMin,
    usageGuard,
    updateUsageGuard,
    usageLimitLocked,
    usageUnlockUntil,
    extendUsageUnlock,
    sendTestNotification,
  } = useNotifications();
  const { isOnline, lastSync, pendingSyncSummary, checkConnectivity } =
    useOffline();

  const [saving, setSaving] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [showMinutesModal, setShowMinutesModal] = useState(false);
  const [minutesInput, setMinutesInput] = useState(
    String(times.classReminder?.minutesBefore ?? 15)
  );
  const [healthRefreshing, setHealthRefreshing] = useState(false);
  const AppUsageModule = NativeModules.AppUsageModule;
  const canOpenUsageSettings =
    Platform.OS === "android" &&
    typeof AppUsageModule?.openUsageAccessSettings === "function";
  const openUsageAccess = async () => {
    if (canOpenUsageSettings) {
      try {
        await AppUsageModule.openUsageAccessSettings();
        return;
      } catch (err) {
        console.warn("Failed to open usage access settings:", err);
      }
    }
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn("Failed to open device settings:", err);
      Alert.alert(
        "Settings Unavailable",
        "Please open your device settings manually."
      );
    }
  };

  //  New custom notif form state
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newHour, setNewHour] = useState(8);
  const [newMinute, setNewMinute] = useState(0);
  const [newRepeat, setNewRepeat] = useState("daily");
  const [newWeekday, setNewWeekday] = useState(1); // Monday
  const [newDate, setNewDate] = useState(new Date());

  //  Toggle notification on/off
  const handleToggle = async (key, value) => {
    setSaving(true);
    await updateSettings({ [key]: value });
    setSaving(false);
  };

  //  Open time picker for editable notifications
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
            hour: selected.getHours(),
            minute: selected.getMinutes(),
          },
        });
      },
    });
  };

  //  Open minutes-before picker for class reminder
  const editMinutesBefore = () => {
    const current = times.classReminder?.minutesBefore ?? 15;
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Class Reminder",
        "How many minutes before class should we remind you?",
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
              await updateTimes({ classReminder: { minutesBefore: mins } });
            },
          },
        ],
        "plain-text",
        String(current),
        "numeric"
      );
      return;
    }

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
    await updateTimes({ classReminder: { minutesBefore: mins } });
    setShowMinutesModal(false);
  };

  //  Open time picker for NEW custom notif
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

  //  Open date picker for NEW custom notif (one-time only)
  const openNewDatePicker = () => {
    DateTimePickerAndroid.open({
      value: newDate,
      mode: "date",
      onChange: (event, selected) => {
        if (event.type !== "set" || !selected) return;
        setNewDate(selected);
      },
    });
  };

  //  Save new custom notification
  const saveCustomNotif = async () => {
    if (!newTitle.trim()) {
      Alert.alert(
        "Missing Title",
        "Please enter a title for your notification."
      );
      return;
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
    // Reset form
    setNewTitle("");
    setNewBody("");
    setNewHour(8);
    setNewMinute(0);
    setNewRepeat("daily");
    setNewWeekday(1);
    setShowCustom(false);
    Alert.alert("Reminder Added", `"${newTitle}" has been scheduled.`);
  };

  const handlePermission = async () => {
    const granted = await requestPermission();
    if (granted) {
      Alert.alert("Enabled", "You will now receive reminders.");
      await rescheduleAll();
    } else {
      Alert.alert(
        "Permission Denied",
        "Enable notifications in your phone Settings > Apps > CTU Danao."
      );
    }
  };
  const openAppSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn("Failed to open device settings:", err);
      Alert.alert(
        "Settings Unavailable",
        "Please open your device settings manually."
      );
    }
  };

  const adjustUsageGuardMinutes = async (key, delta, min, max) => {
    const current = Number(usageGuard?.[key] || 0);
    const next = Math.max(min, Math.min(max, current + delta));
    await updateUsageGuard({ [key]: next });
  };

  const unlockLabel =
    usageUnlockUntil > Date.now()
      ? new Date(usageUnlockUntil).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : "Not active";

  const enabledCount = NOTIFICATION_ITEMS.filter((i) => settings[i.key]).length;
  const pendingTotal = Number(pendingSyncSummary?.total || 0);
  const activePresetKey =
    PRESET_OPTIONS.find((preset) =>
      PRESET_KEYS.every(
        (key) => Boolean(settings[key]) === Boolean(preset.settings[key])
      )
    )?.key || "custom";

  const applyPreset = async (key) => {
    const preset = PRESET_OPTIONS.find((option) => option.key === key);
    if (!preset) return;
    setSaving(true);
    await updateSettings(preset.settings);
    setSaving(false);
  };

  const refreshHealth = async () => {
    setHealthRefreshing(true);
    await checkConnectivity();
    if (permission && notificationsAvailable) {
      await rescheduleAll();
    }
    setHealthRefreshing(false);
  };

  const handleTestNotification = async () => {
    const result = await sendTestNotification();
    if (result?.ok) {
      Alert.alert("Test Sent", "Check your notification shade.");
      return;
    }
    Alert.alert(
      "Test Failed",
      result?.reason || "Unable to send a test notification."
    );
  };

  const healthRows = [
    {
      key: "permission",
      label: "Notification Permission",
      value: permission ? "Enabled" : "Disabled",
      tone: permission ? "ok" : "warn",
      hint: permission
        ? "System permission granted"
        : "Tap Enable to receive reminders",
    },
    {
      key: "engine",
      label: "Notification Engine",
      value: notificationsAvailable ? "Ready" : "Unavailable",
      tone: notificationsAvailable ? "ok" : "warn",
      hint:
        isExpoGo && !notificationsAvailable
          ? "Expo Go has notification limits"
          : "Scheduling service status",
    },
    {
      key: "sync",
      label: "Network & Sync",
      value: isOnline ? "Online" : "Offline",
      tone: isOnline ? "ok" : "warn",
      hint: `Last sync ${formatSyncTime(lastSync)}${pendingTotal > 0 ? ` | ${pendingTotal} pending updates` : ""}`,
    },
    {
      key: "coverage",
      label: "Reminder Coverage",
      value: `${enabledCount}/${NOTIFICATION_ITEMS.length} active`,
      tone: enabledCount >= 5 ? "ok" : "warn",
      hint: `${customNotifs.length} custom reminder${customNotifs.length === 1 ? "" : "s"}`,
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#007bff" />

      {/*  Header  */}
      <View
        style={[
          styles.header,
          { backgroundColor: "#007bff", paddingTop: insets.top + 16 },
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
                { backgroundColor: "rgba(239,68,68,0.4)" },
              ]}
            >
              <Ionicons name="warning" size={12} color="#fff" />
              <Text style={styles.statPillText}>Permission needed</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/*  Permission warning  */}
        {!permission && (
          <TouchableOpacity
            style={[
              styles.permissionBox,
              { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
            ]}
            onPress={handlePermission}
          >
            <View style={styles.permissionLeft}>
              <Ionicons name="notifications-off" size={22} color="#ef4444" />
              <View>
                <Text style={styles.permissionTitle}>
                  Notifications are disabled
                </Text>
                <Text style={styles.permissionSub}>
                  Tap here to enable them
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#ef4444" />
          </TouchableOpacity>
        )}

        {/*  Section: Built-in Notifications  */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Notification Health
        </Text>
        <View
          style={[
            styles.healthCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {healthRows.map((row) => {
            const isWarn = row.tone === "warn";
            const iconColor = isWarn ? "#f59e0b" : "#22c55e";
            return (
              <View
                key={row.key}
                style={[styles.healthRow, { borderBottomColor: colors.border }]}
              >
                <View
                  style={[
                    styles.healthIconBox,
                    { backgroundColor: `${iconColor}22` },
                  ]}
                >
                  <Ionicons
                    name={
                      isWarn ? "warning-outline" : "checkmark-circle-outline"
                    }
                    size={14}
                    color={iconColor}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.healthLabel, { color: colors.text }]}>
                    {row.label}
                  </Text>
                  <Text style={[styles.healthHint, { color: colors.muted }]}>
                    {row.hint}
                  </Text>
                </View>
                <Text style={[styles.healthValue, { color: iconColor }]}>
                  {row.value}
                </Text>
              </View>
            );
          })}
          <View style={styles.healthActionRow}>
            {!permission ? (
              <TouchableOpacity
                style={styles.healthActionBtn}
                onPress={handlePermission}
              >
                <Ionicons name="notifications-outline" size={14} color="#fff" />
                <Text style={styles.healthActionText}>
                  Enable Notifications
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.healthActionBtn}
                onPress={refreshHealth}
              >
                <Ionicons
                  name={healthRefreshing ? "sync" : "refresh-outline"}
                  size={14}
                  color="#fff"
                />
                <Text style={styles.healthActionText}>
                  {healthRefreshing ? "Refreshing..." : "Refresh Health Check"}
                </Text>
              </TouchableOpacity>
            )}
            {permission && notificationsAvailable && (
              <TouchableOpacity
                style={[
                  styles.healthActionBtn,
                  styles.healthActionBtnSecondary,
                ]}
                onPress={handleTestNotification}
              >
                <Ionicons name="paper-plane-outline" size={14} color="#fff" />
                <Text style={styles.healthActionText}>
                  Send Test Notification
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

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
                  disabled={saving}
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

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Quick Settings
        </Text>
        <View
          style={[
            styles.settingsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {canOpenUsageSettings && (
            <View style={[styles.settingsRow, styles.settingsRowFirst]}>
              <Ionicons
                name="phone-portrait-outline"
                size={18}
                color="#0ea5e9"
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Open Usage Access
                </Text>
                <Text style={[styles.cardDesc, { color: colors.muted }]}>
                  Turn on Usage Access so app usage tracking works.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.settingsBtn, { backgroundColor: "#0ea5e9" }]}
                onPress={openUsageAccess}
              >
                <Text style={styles.settingsBtnText}>Open</Text>
              </TouchableOpacity>
            </View>
          )}
          <View
            style={[
              styles.settingsRow,
              canOpenUsageSettings
                ? styles.settingsRowBorder
                : styles.settingsRowFirst,
              canOpenUsageSettings ? { borderTopColor: colors.border } : null,
            ]}
          >
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
                Use this for notifications. Usage Access is above.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={openAppSettings}
            >
              <Text style={styles.settingsBtnText}>Open</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Study Time Guard
        </Text>
        <View
          style={[
            styles.usageGuardCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.usageGuardTop}>
            <View
              style={[styles.usageIconBox, { backgroundColor: "#0ea5e915" }]}
            >
              <Ionicons name="hourglass-outline" size={18} color="#0ea5e9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Daily App Usage
              </Text>
              <Text style={[styles.cardDesc, { color: colors.muted }]}>
                Today: {formatMinutes(appUsageMin)} - Last 7 days:{" "}
                {formatMinutes(weekUsageMin)}
              </Text>
            </View>
          </View>

          <View
            style={[styles.usageControlRow, { borderTopColor: colors.border }]}
          >
            <Text style={[styles.usageControlLabel, { color: colors.text }]}>
              Warning
            </Text>
            <View style={styles.usageStepper}>
              <TouchableOpacity
                style={[styles.stepBtn, { borderColor: colors.border }]}
                onPress={() =>
                  adjustUsageGuardMinutes("warnMinutes", -15, 15, 720)
                }
              >
                <Ionicons name="remove" size={14} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.stepValue, { color: colors.text }]}>
                {formatLeadTime(usageGuard.warnMinutes)}
              </Text>
              <TouchableOpacity
                style={[styles.stepBtn, { borderColor: colors.border }]}
                onPress={() =>
                  adjustUsageGuardMinutes("warnMinutes", 15, 15, 720)
                }
              >
                <Ionicons name="add" size={14} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.usageLimitHead}>
            <Text style={[styles.usageControlLabel, { color: colors.text }]}>
              Daily Limit Lock
            </Text>
            <Switch
              value={usageGuard.limitEnabled}
              onValueChange={(value) =>
                updateUsageGuard({ limitEnabled: value })
              }
              trackColor={{ false: colors.border, true: "#0ea5e955" }}
              thumbColor={
                usageGuard.limitEnabled
                  ? "#0ea5e9"
                  : isDark
                    ? "#475569"
                    : "#cbd5e1"
              }
            />
          </View>

          <View
            style={[
              styles.usageControlRow,
              { opacity: usageGuard.limitEnabled ? 1 : 0.45 },
            ]}
          >
            <Text style={[styles.usageControlLabel, { color: colors.text }]}>
              Lock at
            </Text>
            <View style={styles.usageStepper}>
              <TouchableOpacity
                style={[styles.stepBtn, { borderColor: colors.border }]}
                onPress={() =>
                  adjustUsageGuardMinutes(
                    "limitMinutes",
                    -15,
                    usageGuard.warnMinutes,
                    960
                  )
                }
                disabled={!usageGuard.limitEnabled}
              >
                <Ionicons name="remove" size={14} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.stepValue, { color: colors.text }]}>
                {formatLeadTime(usageGuard.limitMinutes)}
              </Text>
              <TouchableOpacity
                style={[styles.stepBtn, { borderColor: colors.border }]}
                onPress={() =>
                  adjustUsageGuardMinutes(
                    "limitMinutes",
                    15,
                    usageGuard.warnMinutes,
                    960
                  )
                }
                disabled={!usageGuard.limitEnabled}
              >
                <Ionicons name="add" size={14} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {usageGuard.limitEnabled ? (
            <View
              style={[
                styles.usageStatusPill,
                {
                  backgroundColor: usageLimitLocked ? "#fee2e2" : "#dcfce7",
                  borderColor: usageLimitLocked ? "#fecaca" : "#bbf7d0",
                },
              ]}
            >
              <Ionicons
                name={usageLimitLocked ? "lock-closed" : "lock-open-outline"}
                size={12}
                color={usageLimitLocked ? "#ef4444" : "#16a34a"}
              />
              <Text
                style={[
                  styles.usageStatusText,
                  { color: usageLimitLocked ? "#b91c1c" : "#166534" },
                ]}
              >
                {usageLimitLocked
                  ? "Limit is active now"
                  : `Temporary unlock: ${unlockLabel}`}
              </Text>
              {usageLimitLocked ? (
                <TouchableOpacity
                  style={[
                    styles.quickUnlockBtn,
                    { backgroundColor: "#ef4444" },
                  ]}
                  onPress={() => extendUsageUnlock(15)}
                >
                  <Text style={styles.quickUnlockText}>Unlock 15m</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          Built-in Reminders
        </Text>
        {NOTIFICATION_ITEMS.map((item) => {
          const isEnabled = settings[item.key] ?? true;
          const t = times[item.timeKey] || DEFAULT_TIMES[item.timeKey];

          return (
            <View
              key={item.key}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: isEnabled ? item.color + "30" : colors.border,
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
                        ? item.color + "18"
                        : isDark
                          ? "#1e293b"
                          : "#f1f5f9",
                    },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={isEnabled ? item.color : colors.muted}
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
                  trackColor={{ false: colors.border, true: item.color + "66" }}
                  thumbColor={
                    isEnabled ? item.color : isDark ? "#475569" : "#cbd5e1"
                  }
                  disabled={!permission || saving}
                />
              </View>

              {/*  Editable time row  */}
              {isEnabled && item.timeKey && (
                <TouchableOpacity
                  style={[styles.timeRow, { borderTopColor: colors.border }]}
                  onPress={() => {
                    if (item.timeType === "minutesBefore") {
                      editMinutesBefore();
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
                  <Ionicons name="time-outline" size={14} color={item.color} />
                  <Text style={[styles.timeLabel, { color: colors.muted }]}>
                    {item.timeType === "minutesBefore"
                      ? `${formatLeadTime(t?.minutesBefore ?? 15)} before class`
                      : `Every day at ${formatClock(t?.hour ?? 7, t?.minute ?? 0)}`}
                    {item.key === "sundayPlanning" ? " (Sundays)" : ""}
                  </Text>
                  <View
                    style={[
                      styles.editChip,
                      { backgroundColor: item.color + "18" },
                    ]}
                  >
                    <Ionicons name="pencil" size={11} color={item.color} />
                    <Text style={[styles.editChipText, { color: item.color }]}>
                      Edit time
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/*  Section: Custom Notifications  */}
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
            onPress={() => setShowCustom(true)}
          >
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={styles.addBtnText}>Add New</Text>
          </TouchableOpacity>
        </View>

        {customNotifs.length === 0 ? (
          <EmptyStateCard
            title="No custom reminders yet"
            message="Tap Add New to create your own reminder - study sessions, medicine, anything."
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
                    trackColor={{ false: colors.border, true: "#007bff66" }}
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

      {/*  Add Custom Notification Modal  */}
      <Modal visible={showCustom} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />

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

            {/* Date (one-time reminders only) */}
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
                  <Text style={[styles.timePickerText, { color: colors.text }]}>
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
                      { color: newRepeat === r.value ? "#fff" : colors.muted },
                    ]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Weekday picker (only for weekly) */}
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
                          { color: newWeekday === i ? "#fff" : colors.muted },
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
              onPress={() => setShowCustom(false)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.muted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showMinutesModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Class Reminder
            </Text>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              Lead Time Before Class (minutes)
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
              Example: 90 minutes = 1h 30m before class
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

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 6,
  },
  healthCard: {
    borderWidth: 1.5,
    borderRadius: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  healthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  healthIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  healthLabel: { fontSize: 12, fontWeight: "700", marginBottom: 1 },
  healthHint: { fontSize: 11, lineHeight: 16 },
  healthValue: { fontSize: 11, fontWeight: "800" },
  healthActionRow: { padding: 12, gap: 8 },
  healthActionBtn: {
    backgroundColor: "#007bff",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  healthActionBtnSecondary: {
    backgroundColor: "#0f172a",
  },
  healthActionText: { color: "#fff", fontSize: 12, fontWeight: "700" },

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
  settingsRowFirst: {
    borderTopWidth: 0,
  },
  settingsRowBorder: {
    borderTopWidth: 1,
  },
  settingsBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  settingsBtnText: { color: "#fff", fontSize: 11, fontWeight: "800" },

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
  usageGuardCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  usageGuardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  usageIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  usageControlRow: {
    marginTop: 8,
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  usageControlLabel: { fontSize: 13, fontWeight: "700" },
  usageStepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  stepValue: {
    minWidth: 60,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "800",
  },
  usageLimitHead: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  usageStatusPill: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  usageStatusText: { flex: 1, fontSize: 11, fontWeight: "700" },
  quickUnlockBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  quickUnlockText: { color: "#fff", fontSize: 11, fontWeight: "800" },

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

  emptyCustom: {
    alignItems: "center",
    padding: 28,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    marginBottom: 10,
  },
  emptyCustomTitle: { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  emptyCustomSub: { fontSize: 12, textAlign: "center", lineHeight: 18 },

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
  customCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
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

  //  Modal
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
});
