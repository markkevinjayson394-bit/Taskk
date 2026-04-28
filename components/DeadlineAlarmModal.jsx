/**
 * components/DeadlineAlarmModal.js  (v3  action-aware)
 *
 * In-app alarm modal that pairs with deadlineAlarmBackground.js.
 * The background file fires OS system notifications when app is closed/background.
 * This modal fires when the app is open, or when user taps the system notification.
 *
 * WIRING (unchanged from v2 - just these props):
 *
 * TaskManagerScreen.jsx - add these props:
 *   <DeadlineAlarmModal
 *     visible={alarmVisible}
 *     task={alarmTask}
 *     onAcknowledge={acknowledgeAlarm}   // from useDeadlineAlarmScheduler
 *     onMarkDone={markTaskDone}           // closes the alarm after completion
 *     pendingAction={pendingActionRef.current} // informational only: highlights Acknowledge or Mark Done
 *   />
 *
 * _layout.jsx - add pendingAction param when navigating:
 *   Notifications.addNotificationResponseReceivedListener(response => {
 *     const data = response.notification.request.content.data ?? {};
 *     const action = response?.actionIdentifier;
 *     if (data.type === DEADLINE_NOTIF_TYPE || data.type === "deadline") {
 *       const pendingAction =
 *         action === "acknowledge_deadline_alarm" ? "acknowledge"
 *         : action === "mark_done_deadline_alarm" ? "markdone"
 *         : undefined;
 *       router.push({
 *         pathname: "/(tabs)/TaskManagerScreen",
 *         params: { focusTaskId: data.taskId, showAlarm: "1", ...(pendingAction ? { pendingAction } : {}) },
 *       });
 *     }
 *   });
 *
 * FIXES APPLIED:
 * - [FIX] handleSnooze: now awaits stopVibration and stopAlarmSound so they
 *   complete before the snooze notification fires. Previously they were called
 *   without await, meaning the alarm could re-trigger before the sound/vibration
 *   had actually stopped.
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

const ACK_FOLLOWUP_MS = 60 * 60 * 1000;
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
        "DeadlineAlarmModal: failed to schedule native ack checkpoint:",
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
  onAcknowledge,
  onMarkDone,
  onSnooze,
  pendingAction,
}) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [acked, setAcked] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  // [FIX] Local self-close flag so modal disappears immediately after button press
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
  const acknowledgeSelected = pendingAction === "acknowledge";
  const markDoneSelected = pendingAction === "markdone";

  // Reset state when modal becomes invisible
  useEffect(() => {
    if (!visible) {
      setAcked(false);
      setMarkingDone(false);
      // [FIX] Reset selfClosed so the modal is ready for the next alarm
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
      if (!userDismissedRef.current) {
        stopVibration(vibRef);
        stopAlarmSound(soundRef);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleAck = async () => {
    if (acked || markingDone) return;
    setAcked(true);
    setSelfClosed(true);
    userDismissedRef.current = true;

    stopVibration(vibRef);
    const stopSoundPromise = stopAlarmSound(soundRef);
    const stopNativeAlarmPromise = stopActiveNativeAlarm();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {}
    );
    await Promise.allSettled([stopSoundPromise, stopNativeAlarmPromise]);

    await onAcknowledge?.();

    if (task?.id) {
      try {
        await cancelDeadlineAlarms(task);
      } catch (err) {
        console.warn(
          "DeadlineAlarmModal: failed to cancel deadline alarms:",
          err
        );
      }
    }

    const dueDate = parseDueDate(task?.dueAt);
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
              triggerAt: nowMs + ACK_FOLLOWUP_MS,
              isFollowup: true,
            });
          }
        }
      } catch (err) {
        console.warn(
          "DeadlineAlarmModal: failed to schedule next acknowledged checkpoint:",
          err
        );
      }
    }
  };

  const handleMarkDone = async () => {
    if (acked || markingDone || !task?.id) return;
    setMarkingDone(true);
    setSelfClosed(true);
    userDismissedRef.current = true;

    stopVibration(vibRef);
    const stopSoundPromise = stopAlarmSound(soundRef);
    const stopNativeAlarmPromise = stopActiveNativeAlarm();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {}
    );
    await Promise.allSettled([stopSoundPromise, stopNativeAlarmPromise]);
    try {
      await cancelDeadlineAlarms(task);
      await onMarkDone?.();
      setAcked(true);
    } catch (err) {
      console.warn("DeadlineAlarmModal: failed to mark task done:", err);
      setMarkingDone(false);
      setSelfClosed(false);
    }
  };

  const handleRequestClose = () => {
    if (acked || markingDone) return;
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

  // [FIX] handleSnooze: await both stopVibration and stopAlarmSound so they
  // fully complete before the snooze notification fires. Previously these were
  // called without await, allowing the alarm to re-fire before stopping.
  const handleSnooze = async () => {
    if (acked || markingDone) return;
    clearInterval(vibrationIntervalRef.current);
    clearInterval(soundIntervalRef.current);
    await Promise.allSettled([stopVibration(vibRef), stopAlarmSound(soundRef)]);
    await onSnooze?.();
  };

  // [FIX] selfClosed lets the modal vanish instantly after Acknowledge/Mark Done,
  // without waiting for the parent's visible prop to update asynchronously.
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
                "This alarm also notifies you when the app is closed or you're using another app. Tap below to dismiss."
              }
            </Text>
          </View>
          {/* Mark Done button */}
          <TouchableOpacity
            style={[
              styles.markDoneBtn,
              markDoneSelected && styles.pendingActionBtn,
              {
                opacity: acked || markingDone ? 0.65 : 1,
              },
            ]}
            onPress={handleMarkDone}
            disabled={acked || markingDone}
            activeOpacity={0.8}
            accessibilityLabel="Mark task as done"
            accessibilityRole="button"
          >
            <Ionicons
              name={markingDone ? "checkmark-circle" : "checkmark-outline"}
              size={20}
              color="#052e16"
            />
            <Text style={styles.markDoneBtnText}>
              {markingDone ? "Marking Done..." : "Mark Done"}
            </Text>
          </TouchableOpacity>
          {/* Snooze button */}
          <TouchableOpacity
            style={[
              styles.snoozeBtn,
              { opacity: acked || markingDone ? 0.65 : 1 },
            ]}
            onPress={handleSnooze}
            disabled={acked || markingDone}
            activeOpacity={0.8}
            accessibilityLabel="Snooze alarm for 10 minutes"
            accessibilityRole="button"
          >
            <Ionicons name="alarm-outline" size={20} color="#6366f1" />
            <Text style={styles.snoozeBtnText}>Snooze 10 min</Text>
          </TouchableOpacity>
          {/* Acknowledge button */}
          <TouchableOpacity
            style={[
              styles.ackBtn,
              acknowledgeSelected && styles.pendingActionBtn,
              {
                backgroundColor: acked ? "#334155" : "#0f172a",
                borderColor: acked ? "#22c55e" : "#334155",
                opacity: acked || markingDone ? 0.65 : 1,
              },
            ]}
            onPress={handleAck}
            disabled={acked || markingDone}
            activeOpacity={0.8}
            accessibilityLabel="Acknowledge alarm"
            accessibilityRole="button"
          >
            <Ionicons
              name={acked ? "checkmark-circle" : "checkmark-done-circle"}
              size={22}
              color="#e2e8f0"
            />
            <Text style={styles.ackBtnText}>
              {acked ? "Acknowledged" : "Acknowledge"}
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
  markDoneBtn: {
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
  markDoneBtnText: {
    color: "#052e16",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  snoozeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    paddingVertical: 13,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: "#1e1b4b",
    borderWidth: 1,
    borderColor: "#6366f1",
  },
  snoozeBtnText: {
    color: "#a5b4fc",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  ackBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
  },
  ackBtnText: {
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
