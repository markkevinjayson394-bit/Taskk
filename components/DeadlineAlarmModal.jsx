/**
 * components/DeadlineAlarmModal.js  (v4  done/not-done)
 *
 * In-app alarm modal that pairs with deadlineAlarmBackground.js.
 * The background file fires OS system notifications when app is closed/background.
 * This modal fires when the app is open, or when user taps the system notification.
 *
 * Button behavior:
 *   "Done"     → stops alarm, cancels all alarms, marks task complete. Chain ends.
 *   "Not Done" → stops alarm/sound/vibration immediately, advances overdue checkpoint
 *                chain (due → +15m → +1h → +3h → daily → repeats daily), schedules
 *                next alarm. Modal closes. Chain continues until "Done" is pressed.
 *
 * WIRING (unchanged from v3 - just these props):
 *
 * TaskManagerScreen.jsx:
 *   <DeadlineAlarmModal
 *     visible={alarmVisible}
 *     task={alarmTask}
 *     onNotDone={notDoneAlarm}    // from useDeadlineAlarmScheduler
 *     onMarkDone={markTaskDone}   // closes the alarm after completion
 *     pendingAction={pendingActionRef.current}
 *   />
 *
 * FIXES APPLIED:
 * - [FIX 1] Replaced Acknowledge + Snooze buttons with "Not Done" and "Done".
 *   "Not Done" stops sound/vibration immediately then advances the checkpoint chain.
 * - [FIX 2] Sound and vibration are stopped with await before any async work so
 *   they fully complete before the next alarm is scheduled.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cancelDeadlineAlarms,
  DEADLINE_CATEGORY_ID,
  DEADLINE_CHANNEL_ID,
  DEADLINE_NOTIF_TYPE,
} from "../utils/deadlineAlarmBackground";
import { THRESHOLDS } from "../utils/deadlineConstants";
import { getUrgencyMeta } from "../utils/deadlineTime";
import {
  isNativeAlarmSupported,
  scheduleNativeAlarm,
  stopActiveNativeAlarm,
} from "../utils/nativeAlarm";
import {
  buildDeadlineNotificationId,
  buildManagedNotificationData,
  buildNotificationId,
} from "../utils/notificationIds";
import {
  formatDeadlineCountdown,
  parseDueDate,
  playAlarmSound,
  PRIORITY_COLOR,
  startVibration,
  stopAlarmSound,
  stopVibration,
  TYPE_META,
} from "./DeadlineAlarmModal.helpers";
import { useDeadlineAlarmScheduler } from "./useDeadlineAlarmScheduler";

const NOT_DONE_FOLLOWUP_MS = 60 * 60 * 1000;
const OVERDUE_RESCHEDULE_LIMIT_MS = 24 * 60 * 60 * 1000;
const ANDROID_ALARM_CONTENT = {
  channelId: DEADLINE_CHANNEL_ID,
  priority: "max",
  sticky: true,
  autoDismiss: false,
  sound: "ctu_alarm.wav",
  vibrationPattern: [0, 400, 200, 400, 200, 800],
};

function formatDeadlineDueMoment(date) {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildRescheduledDeadlineContent(
  task,
  dueDate,
  thresholdKey,
  isFollowup
) {
  const titleText =
    typeof task?.title === "string" && task.title.trim()
      ? task.title.trim()
      : "Task";
  const subject = task?.subject || task?.subjectName || "General";
  const priority = (task?.priority || "medium").toUpperCase();
  const dueLabel = formatDeadlineDueMoment(dueDate);

  if (isFollowup) {
    return {
      title: "Deadline follow-up reminder",
      body: `"${titleText}" (${subject}) is still pending. Due ${dueLabel} [${priority}]`,
    };
  }

  switch (thresholdKey) {
    case "1d":
      return {
        title: "Task due tomorrow",
        body: `"${titleText}" (${subject}) is due tomorrow. Due ${dueLabel} [${priority}]`,
      };
    case "2h":
      return {
        title: "2 hours until deadline",
        body: `"${titleText}" (${subject}) is due in 2 hours. Due ${dueLabel} [${priority}]`,
      };
    case "30m":
      return {
        title: "30 min until deadline",
        body: `"${titleText}" (${subject}) is due in 30 minutes. Due ${dueLabel} [${priority}]`,
      };
    case "due":
    default:
      return {
        title: `${titleText} is due NOW!`,
        body: `"${titleText}" (${subject}) is due now. Due ${dueLabel} [${priority}]`,
      };
  }
}

async function scheduleNextDeadlineCheckpoint({
  task,
  dueDate,
  thresholdKey,
  triggerAt,
  isFollowup = false,
}) {
  if (
    !task?.id ||
    !(dueDate instanceof Date) ||
    Number.isNaN(dueDate.getTime())
  ) {
    return;
  }

  const subject = task.subject || task.subjectName || "General";
  const { title, body } = buildRescheduledDeadlineContent(
    task,
    dueDate,
    thresholdKey,
    isFollowup
  );
  const minutesAfterDue = Math.max(
    0,
    Math.round((triggerAt - dueDate.getTime()) / 60000)
  );
  const notificationId = isFollowup
    ? buildNotificationId("deadline-followup", task.id, `${minutesAfterDue}m`)
    : buildDeadlineNotificationId(task.id, thresholdKey);
  const data = buildManagedNotificationData(notificationId, {
    type: DEADLINE_NOTIF_TYPE,
    notificationType: DEADLINE_NOTIF_TYPE,
    taskId: task.id,
    taskTitle:
      typeof task.title === "string" && task.title.trim()
        ? task.title.trim()
        : "",
    subject,
    dueAt: dueDate.toISOString(),
    dueAtMs: dueDate.getTime(),
    acknowledgeRequired: true,
    threshold: thresholdKey,
    ...(isFollowup ? { minutesAfterDue } : {}),
  });
  const shouldPreferNative =
    Platform.OS === "android" &&
    isNativeAlarmSupported &&
    (thresholdKey === "due" || isFollowup);

  if (shouldPreferNative) {
    try {
      const nativeScheduledId = await scheduleNativeAlarm({
        alarmId: notificationId,
        triggerAt,
        title,
        body,
        payload: data,
      });
      if (nativeScheduledId) return;
    } catch (err) {
      console.warn(
        "DeadlineAlarmModal: failed to schedule native checkpoint:",
        err
      );
    }
  }

  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(
    () => {}
  );
  await Notifications.scheduleNotificationAsync({
    identifier: notificationId,
    content: {
      title,
      body,
      data,
      categoryIdentifier: DEADLINE_CATEGORY_ID,
      ...(Platform.OS === "android" ? ANDROID_ALARM_CONTENT : {}),
    },
    trigger:
      Platform.OS === "android"
        ? {
            type: "date",
            date: new Date(triggerAt),
            channelId: DEADLINE_CHANNEL_ID,
          }
        : { type: "date", date: new Date(triggerAt) },
  });
}

function DeadlineAlarmModal({
  visible,
  task,
  onNotDone,
  onMarkDone,
  pendingAction,
}) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [notDonePressed, setNotDonePressed] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  // Local self-close flag so modal disappears immediately after button press
  // without waiting for the parent to propagate visible=false back down.
  const [selfClosed, setSelfClosed] = useState(false);
  const soundRef = useRef(null);
  const vibRef = useRef(null);
  const tickRef = useRef(null);
  const soundIntervalRef = useRef(null);
  const vibrationIntervalRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef(null);
  const userDismissedRef = useRef(false);

  const due = parseDueDate(task?.dueAt);
  const urgencyColor = getUrgencyMeta(due?.getTime(), now.getTime()).color;
  const countdown = formatDeadlineCountdown(due, now, { style: "short" });
  const pColor = PRIORITY_COLOR[task?.priority] ?? "#0ea5e9";
  const meta = TYPE_META[task?.type] ?? TYPE_META.custom;
  const notDoneSelected = pendingAction === "notdone";
  const doneSelected = pendingAction === "markdone";

  // Reset state when modal becomes invisible
  useEffect(() => {
    if (!visible) {
      setNotDonePressed(false);
      setMarkingDone(false);
      // Reset selfClosed so the modal is ready for the next alarm
      setSelfClosed(false);
      userDismissedRef.current = false;
      slideAnim.setValue(-80);
      shakeAnim.setValue(0);
      pulseAnim.setValue(1);
      loopRef.current?.stop();
      return;
    }
    // Slide down from top
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 55,
      friction: 9,
      useNativeDriver: true,
    }).start();
    // Pulse alarm icon continuously
    loopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.22,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 420,
          useNativeDriver: true,
        }),
      ])
    );
    loopRef.current.start();
    // Per-second countdown
    tickRef.current = setInterval(() => setNow(new Date()), 1000);
    // Initial vibration
    startVibration(vibRef);
    // Initial alarm sound
    playAlarmSound(soundRef);
    // Repeat vibration every 5 seconds
    vibrationIntervalRef.current = setInterval(() => {
      startVibration(vibRef);
    }, 5000);
    // Repeat alarm sound every 10 seconds
    soundIntervalRef.current = setInterval(() => {
      stopAlarmSound(soundRef);
      playAlarmSound(soundRef);
    }, 10000);
    return () => {
      loopRef.current?.stop();
      clearInterval(tickRef.current);
      clearInterval(vibrationIntervalRef.current);
      clearInterval(soundIntervalRef.current);
      // Always stop sound/vibration on unmount — stopAlarmSound is idempotent
      stopVibration(vibRef);
      stopAlarmSound(soundRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // "Not Done" — stop sound/vibration immediately, advance checkpoint chain,
  // schedule next alarm, close modal. Task remains incomplete.
  const handleNotDone = async () => {
    if (notDonePressed || markingDone) return;
    setNotDonePressed(true);
    setSelfClosed(true);
    userDismissedRef.current = true;

    // Stop all sound and vibration first — must complete before scheduling next alarm
    // Stop all sound and vibration immediately (synchronously) before any async work
    clearInterval(vibrationIntervalRef.current);
    clearInterval(soundIntervalRef.current);
    stopVibration(vibRef);
    await Promise.allSettled([
      stopAlarmSound(soundRef),
      stopActiveNativeAlarm(),
    ]);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {}
    );

    // Advance the overdue checkpoint chain and schedule the next alarm.
    // Skip checkpoint scheduling for lead-time warnings (task not yet due) —
    // "Not Done" on a 2h/30m warning just dismisses the modal without chaining.
    const dueDate = parseDueDate(task?.dueAt);
    const isLeadTime =
      !dueDate || dueDate.getTime() - Date.now() > 0;
    if (!isLeadTime) {
      await onNotDone?.();
      if (task?.id && dueDate) {
        try {
          const nowMs = Date.now();
          const timeLeftMs = dueDate.getTime() - nowMs;
          const nextThreshold = THRESHOLDS.find(
            (threshold) => threshold.ms < timeLeftMs
          );

          if (nextThreshold) {
            await scheduleNextDeadlineCheckpoint({
              task,
              dueDate,
              thresholdKey: nextThreshold.key,
              triggerAt: dueDate.getTime() - nextThreshold.ms,
            });
          } else {
            const overdueMs = nowMs - dueDate.getTime();
            if (overdueMs <= OVERDUE_RESCHEDULE_LIMIT_MS) {
              await scheduleNextDeadlineCheckpoint({
                task,
                dueDate,
                thresholdKey: "due",
                triggerAt: nowMs + NOT_DONE_FOLLOWUP_MS,
                isFollowup: true,
              });
            }
          }
        } catch (err) {
          console.warn(
            "DeadlineAlarmModal: failed to schedule next checkpoint after Not Done:",
            err
          );
        }
      }
    } else {
      await onNotDone?.();
    }
  };

  // "Done" — stop everything, cancel all alarms, mark task complete. Chain ends.
  const handleDone = async () => {
    if (notDonePressed || markingDone || !task?.id) return;
    setMarkingDone(true);
    setSelfClosed(true);
    userDismissedRef.current = true;

    // Stop all sound and vibration immediately (synchronously) before any async work
    clearInterval(vibrationIntervalRef.current);
    clearInterval(soundIntervalRef.current);
    stopVibration(vibRef);
    await Promise.allSettled([
      stopAlarmSound(soundRef),
      stopActiveNativeAlarm(),
    ]);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {}
    );

    try {
      await cancelDeadlineAlarms(task);
      await onMarkDone?.();
      setNotDonePressed(true);
    } catch (err) {
      console.warn("DeadlineAlarmModal: failed to mark task done:", err);
      setMarkingDone(false);
      setSelfClosed(false);
    }
  };

  const handleRequestClose = () => {
    if (notDonePressed || markingDone) return;
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 10,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -10,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 60,
        useNativeDriver: true,
      }),
    ]).start();
  };

  if (!task || selfClosed) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleRequestClose}
      accessibilityViewIsModal={true}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.card,
            { marginTop: insets.top + 12, borderColor: urgencyColor },
            {
              transform: [{ translateY: slideAnim }, { translateX: shakeAnim }],
            },
          ]}
        >
          {/* Left priority stripe */}
          <View style={[styles.stripe, { backgroundColor: pColor }]} />
          {/* Pulsing alarm icon */}
          <Animated.View
            style={[
              styles.iconWrap,
              {
                backgroundColor: urgencyColor + "22",
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <Ionicons name="alarm" size={48} color={urgencyColor} />
          </Animated.View>
          {/* Header label */}
          <Text style={[styles.alarmBadge, { color: urgencyColor }]}>
            DEADLINE ALARM
          </Text>
          {/* Type + priority chip */}
          <View style={[styles.typeChip, { borderColor: pColor + "70" }]}>
            <Ionicons name={meta.icon} size={12} color={pColor} />
            <Text style={[styles.chipText, { color: pColor }]}>
              {meta.label}
            </Text>
            <View style={[styles.dot, { backgroundColor: pColor }]} />
            <Text style={[styles.chipText, { color: pColor }]}>
              {(task.priority || "medium").toUpperCase()}
            </Text>
          </View>
          {/* Task title */}
          <Text style={styles.title} numberOfLines={3}>
            {task.title}
          </Text>
          {/* Subject */}
          <Text style={styles.subject}>
            {task.subject || task.subjectName || "General"}
          </Text>
          {/* Live countdown */}
          <View
            style={[
              styles.countdownBox,
              {
                borderColor: urgencyColor + "55",
                backgroundColor: urgencyColor + "14",
              },
            ]}
          >
            <Ionicons name="time" size={16} color={urgencyColor} />
            <Text style={[styles.countdownText, { color: urgencyColor }]}>
              {countdown}
            </Text>
          </View>
          {/* Exact due date */}
          {due && (
            <Text style={styles.dueDate}>
              {"Due: "}
              {due.toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          )}
          {/* Info row */}
          <View style={styles.infoRow}>
            <Ionicons
              name="information-circle-outline"
              size={13}
              color="#475569"
            />
            <Text style={styles.infoText}>
              {
                'Tap "Done" when finished. Tap "Not Done" to silence this alarm and be reminded again later.'
              }
            </Text>
          </View>
          {/* Done button */}
          <TouchableOpacity
            style={[
              styles.doneBtn,
              doneSelected && styles.pendingActionBtn,
              {
                opacity: notDonePressed || markingDone ? 0.65 : 1,
              },
            ]}
            onPress={handleDone}
            disabled={notDonePressed || markingDone}
            activeOpacity={0.8}
            accessibilityLabel="Mark task as done"
            accessibilityRole="button"
          >
            <Ionicons
              name={markingDone ? "checkmark-circle" : "checkmark-outline"}
              size={20}
              color="#052e16"
            />
            <Text style={styles.doneBtnText}>
              {markingDone ? "Marking Done..." : "Done"}
            </Text>
          </TouchableOpacity>
          {/* Not Done button */}
          <TouchableOpacity
            style={[
              styles.notDoneBtn,
              notDoneSelected && styles.pendingActionBtn,
              {
                opacity: notDonePressed || markingDone ? 0.65 : 1,
              },
            ]}
            onPress={handleNotDone}
            disabled={notDonePressed || markingDone}
            activeOpacity={0.8}
            accessibilityLabel="Not done — silence alarm and remind me later"
            accessibilityRole="button"
          >
            <Ionicons
              name={notDonePressed ? "checkmark-circle" : "time-outline"}
              size={20}
              color="#e2e8f0"
            />
            <Text style={styles.notDoneBtnText}>
              {notDonePressed ? "Noted" : "Not Done"}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.76)",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  card: {
    width: "92%",
    maxWidth: 400,
    backgroundColor: "#0b1220",
    borderRadius: 22,
    borderWidth: 2,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 28,
    alignItems: "center",
    overflow: "hidden",
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
  },
  stripe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
  iconWrap: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  alarmBadge: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2.2,
    marginBottom: 14,
  },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1.2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 14,
  },
  chipText: { fontSize: 11, fontWeight: "800" },
  dot: { width: 4, height: 4, borderRadius: 2 },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#f8fafc",
    textAlign: "center",
    lineHeight: 28,
    marginBottom: 6,
  },
  subject: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94a3b8",
    marginBottom: 18,
  },
  countdownBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
    marginBottom: 10,
    width: "100%",
    justifyContent: "center",
  },
  countdownText: { fontSize: 21, fontWeight: "900", letterSpacing: 0.4 },
  dueDate: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginBottom: 22,
    paddingHorizontal: 2,
  },
  infoText: {
    fontSize: 11,
    color: "#475569",
    fontWeight: "500",
    lineHeight: 17,
    flex: 1,
  },
  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: "#22c55e",
  },
  doneBtnText: {
    color: "#052e16",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  notDoneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#0f172a",
    borderColor: "#334155",
  },
  notDoneBtnText: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  pendingActionBtn: {
    borderWidth: 2,
    borderColor: "#f8fafc",
    shadowColor: "#f8fafc",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
});

export { useDeadlineAlarmScheduler };
export default DeadlineAlarmModal;
