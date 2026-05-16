/**
 * components/DeadlineAlarmModal.jsx  (v6 - auto-play sound)
 *
 * CHANGES IN THIS VERSION:
 * - [NEW] Sound plays automatically when modal becomes visible (visible=true)
 *   - soundCancelRef guards against race conditions during load
 *   - No user interaction required to start alarm
 * - [NEW] When nativeHandoff=true (native alarm already playing), modal
 *   opens without starting a duplicate sound
 * - [NEW] Sound continues/resumes when modal opens from notification tap
 * - [FIX] shouldUseLocalAlarmLoop prevents double-playing when native
 *   alarm activity is already ringing
 */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Animated,
    Modal,
    Platform,
    StyleSheet,
    Text,
    ToastAndroid,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    cancelDeadlineAlarms,
    scheduleNextOverdueAlarm,
} from "../utils/deadlineAlarmBackground";
import { OVERDUE_CHAIN } from "../utils/deadlineConstants";
import {
    cancelDeadlineNotifications,
} from "../utils/deadlineNotifications";
import { getUrgencyMeta } from "../utils/deadlineTime";
import { warnIfDev } from "../utils/logger";
import {
    forceStopNativeAlarm,
    stopActiveNativeAlarm,
} from "../utils/nativeAlarm";
import {
    advanceCheckpoint,
    clearCheckpoint,
    getCheckpoint,
} from "../utils/taskOverdueState";
import {
    formatDeadlineCountdown,
    playAlarmSound,
    PRIORITY_COLOR,
    resolveTaskDueDate,
    startVibration,
    stopAlarmSound,
    stopVibration,
    TYPE_META,
} from "./DeadlineAlarmModal.helpers";
import { useDeadlineAlarmScheduler } from "./useDeadlineAlarmScheduler";

// Cancel ALL candidate notifee notification IDs for the current alarm so
// "Mark Done" / "Not Done" reliably dismiss the shade notification regardless
// of which ID builder was used when the alarm was posted.
async function cancelAllNotifeeIdsForTask(
  taskId,
  thresholdKey,
  rawAlarmId = null
) {
  if (!taskId) return;
  await cancelDeadlineNotifications(taskId, {
    thresholdKey: thresholdKey || null,
    extraIds: [rawAlarmId, taskId].filter(Boolean),
  });
}

const AUTO_MISS_TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_MISS_STAGE_KEYS = new Set(["due", "+15m", "+1h", "+3h", "daily"]);

function IOSMissedAlarmBanner({ message, onHide }) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-16)).current;

  useEffect(() => {
    if (!message) return undefined;

    opacity.setValue(0);
    translateY.setValue(-16);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    const timeoutId = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -16,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => onHide?.());
    }, 3000);

    return () => clearTimeout(timeoutId);
  }, [message, onHide, opacity, translateY]);

  if (!message) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.missedBannerContainer, { top: insets.top + 12 }]}
    >
      <Animated.View
        style={[styles.missedBanner, { opacity, transform: [{ translateY }] }]}
      >
        <Text style={styles.missedBannerText}>{message}</Text>
      </Animated.View>
    </View>
  );
}

function DeadlineAlarmModal({
  visible,
  task,
  onNotDone,
  onMarkDone,
  pendingAction,
  nativeHandoff = false,
  thresholdKey = null,
}) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [notDonePressed, setNotDonePressed] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  // Local self-close flag so modal disappears immediately after button press
  // without waiting for the parent to propagate visible=false back down.
  const [selfClosed, setSelfClosed] = useState(false);
  const [missedAlarmBannerMessage, setMissedAlarmBannerMessage] = useState("");
  const soundRef = useRef(null);
  const soundCancelRef = useRef(false);
  const vibRef = useRef(null);
  const tickRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef(null);
  const userDismissedRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const handleNotDoneRef = useRef(null);

  const due = resolveTaskDueDate(task);
  const urgencyColor = getUrgencyMeta(due?.getTime(), now.getTime()).color;
  const countdown = formatDeadlineCountdown(due, now, { style: "short" });
  const pColor = PRIORITY_COLOR[task?.priority] ?? "#0ea5e9";
  const meta = TYPE_META[task?.type] ?? TYPE_META.custom;
  const notDoneSelected = pendingAction === "notdone";
  const doneSelected = pendingAction === "markdone";
  const isSilentConfirmMode = pendingAction === "markdone";
  // [NEW] Determine if we should play sound locally:
  // - Don't play if nativeHandoff=true (native alarm already ringing)
  // - Don't play if markdone mode (silent confirmation)
  // - Otherwise, play sound when modal becomes visible
  const shouldUseLocalAlarmLoop = !isSilentConfirmMode && !nativeHandoff;

  console.log("[DeadlineAlarmModal] Audio/Vibration Debug:", {
    visible,
    nativeHandoff,
    pendingAction,
    isSilentConfirmMode,
    shouldUseLocalAlarmLoop,
  });

  const isOverdue = due && due.getTime() < now.getTime();
  const effectiveThresholdKey = thresholdKey || (isOverdue ? "due" : null);
  const requiresExplicitAction = AUTO_MISS_STAGE_KEYS.has(
    effectiveThresholdKey
  );

  const getOverdueDuration = () => {
    if (!due || !isOverdue) return null;
    const overdueMs = now.getTime() - due.getTime();
    const totalMinutes = Math.floor(overdueMs / (60 * 1000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.slice(0, 2).join(" ");
  };
  const overdueDuration = getOverdueDuration();

  // Cleanup on unmount only — preserve sound/vibration during background
  useEffect(() => {
    return () => {
      loopRef.current?.stop();
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      stopVibration(vibRef);
      void stopAlarmSound(soundRef, soundCancelRef);
    };
  }, []);

  // Reset state and manage sound when modal becomes visible or invisible
  useEffect(() => {
    if (!visible) {
      setNotDonePressed(false);
      setMarkingDone(false);
      setSelfClosed(false);
      userDismissedRef.current = false;
      actionInFlightRef.current = false;
      slideAnim.setValue(-80);
      shakeAnim.setValue(0);
      pulseAnim.setValue(1);
      loopRef.current?.stop();
      return;
    }
    // Becoming visible — reset all transient state so a stale selfClosed
    // from a previous session doesn't hide the modal before it renders.
    setNotDonePressed(false);
    setMarkingDone(false);
    setSelfClosed(false);
    userDismissedRef.current = false;

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

    // AUTO-PLAY SOUND: Start sound and vibration when modal becomes visible
    // (only if not using native alarm and not in silent confirm mode)
    if (shouldUseLocalAlarmLoop) {
      soundCancelRef.current = false;
      startVibration(vibRef);
      void playAlarmSound(soundRef, soundCancelRef);
      console.log(
        "[DeadlineAlarmModal] Sound & vibration started automatically"
      );
    }

    return () => {
      loopRef.current?.stop();
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [visible, pulseAnim, shakeAnim, slideAnim, shouldUseLocalAlarmLoop]);

  // "Not Done" — stop sound/vibration immediately, advance checkpoint chain,
  // schedule next alarm, close modal. Task remains incomplete.
  useEffect(() => {
    if (!selfClosed) return undefined;

    actionInFlightRef.current = false;
    loopRef.current?.stop();
    clearInterval(tickRef.current);
    tickRef.current = null;
    stopVibration(vibRef);
    void stopAlarmSound(soundRef);
    return undefined;
  }, [selfClosed]);

  const stopCurrentAlarmPresentation = useCallback(async () => {
    loopRef.current?.stop();
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    stopVibration(vibRef);
    await stopAlarmSound(soundRef, soundCancelRef).catch(() => {});

    try {
      if (typeof stopActiveNativeAlarm === "function") {
        const STOP_TIMEOUT_MS = 6000;
        // Use Promise.race with timeout to prevent waiting indefinitely
        const stopped = await Promise.race([
          stopActiveNativeAlarm(),
          new Promise((resolve) =>
            setTimeout(() => resolve(false), STOP_TIMEOUT_MS)
          ),
        ]).catch(() => false);

        if (!stopped && typeof forceStopNativeAlarm === "function") {
          await Promise.race([
            forceStopNativeAlarm(),
            new Promise((resolve) =>
              setTimeout(() => resolve(false), STOP_TIMEOUT_MS)
            ),
          ]).catch(() => {});
        }
      }
    } catch (_e) {}

    // Extract rawAlarmId from notification data if available
    const rawAlarmId = task?.data?.alarmId ?? null;
    await cancelAllNotifeeIdsForTask(
      task?.id,
      effectiveThresholdKey,
      rawAlarmId
    );
  }, [effectiveThresholdKey, task?.id, task?.data?.alarmId]);

  const handleNotDone = useCallback(
    async ({ skipHaptic = false } = {}) => {
      if (notDonePressed || markingDone || actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      setNotDonePressed(true);
      userDismissedRef.current = true;
      let nextCheckpoint = null;

      await stopCurrentAlarmPresentation();

      if (!skipHaptic) {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning
        ).catch(() => {});
      }

      // Advance the overdue checkpoint chain and schedule the next alarm.
      // Skip checkpoint scheduling for lead-time warnings (task not yet due) —
      // "Not Done" on a 2h/30m warning just dismisses the modal without chaining.
      const dueDate = resolveTaskDueDate(task);
      const isLeadTime = !dueDate || dueDate.getTime() - Date.now() > 0;
      if (!isLeadTime) {
        await onNotDone?.();
        if (task?.id && dueDate) {
          try {
            const stageKey = effectiveThresholdKey || "due";
            // Guard against double-advance: if shade action button AND modal button
            // both fire, the checkpoint may have already been advanced by the shade
            // handler.
            const existingCheckpoint = await getCheckpoint(task.id);
            const checkpointAge = Number.isFinite(
              existingCheckpoint?.scheduledAt
            )
              ? Date.now() - existingCheckpoint.scheduledAt
              : Infinity;

            const alreadyAdvanced =
              existingCheckpoint?.handledByShade === true &&
              checkpointAge < 10_000;

            if (alreadyAdvanced) {
              warnIfDev(
                "[DeadlineAlarmModal] Checkpoint recently advanced by shade handler, skipping duplicate"
              );
              nextCheckpoint =
                existingCheckpoint?.key && existingCheckpoint.key !== stageKey
                  ? existingCheckpoint
                  : null;
            } else {
              nextCheckpoint = await advanceCheckpoint(
                task.id,
                stageKey,
                dueDate.getTime()
              );
            }

            if (nextCheckpoint?.key) {
              await scheduleNextOverdueAlarm({
                task,
                checkpoint: {
                  key: nextCheckpoint.key,
                  delayMs:
                    nextCheckpoint.delayMs ??
                    OVERDUE_CHAIN.find(
                      (entry) => entry.key === nextCheckpoint.key
                    )?.delayMs ??
                    null,
                },
                triggerAt: nextCheckpoint.triggerAtMs ?? null,
                intendedTriggerAtMs: nextCheckpoint.triggerAtMs ?? null,
                deliveryPathHint: "modal_not_done",
              });
            }
          } catch (err) {
            warnIfDev(
              "DeadlineAlarmModal: failed to schedule next overdue checkpoint:",
              err
            );
          }
        }
      } else {
        await onNotDone?.();
      }
      // Mark modal as self-closing after callbacks complete so state updates commit first
      setSelfClosed(true);
      if (skipHaptic) {
        const nextTriggerAtMs = Number(nextCheckpoint?.triggerAtMs);
        const message = Number.isFinite(nextTriggerAtMs)
          ? `Alarm missed — next reminder at ${new Date(
              nextTriggerAtMs
            ).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}`
          : "Alarm missed — you'll be reminded again later";

        if (Platform.OS === "android") {
          ToastAndroid.show(message, ToastAndroid.LONG);
        } else if (Platform.OS === "ios") {
          setMissedAlarmBannerMessage(message);
        }
      }
    },
    [
      effectiveThresholdKey,
      markingDone,
      notDonePressed,
      onNotDone,
      stopCurrentAlarmPresentation,
      task,
    ]
  );

  useEffect(() => {
    handleNotDoneRef.current = handleNotDone;
  }, [handleNotDone]);

  // "Done" — stop everything, cancel all alarms, mark task complete. Chain ends.
  const handleDone = useCallback(async () => {
    if (notDonePressed || markingDone || !task?.id || actionInFlightRef.current)
      return;
    actionInFlightRef.current = true;
    setMarkingDone(true);
    userDismissedRef.current = true;

    await stopCurrentAlarmPresentation();

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {}
    );

    try {
      await Promise.race([
        (async () => {
          if (task?.id) {
            await cancelDeadlineAlarms(task).catch(() => {});
            await clearCheckpoint(task.id).catch(() => {});
          }
          await onMarkDone?.();
          setNotDonePressed(true);
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("markDone timeout")), 10000)
        ),
      ]);
    } catch (err) {
      warnIfDev("DeadlineAlarmModal: failed to mark task done:", err);
      // Still close the modal after 10s so the user isn't stuck on "Marking Done..."
    }
    // Mark modal as self-closing after callbacks complete so state updates commit first
    setSelfClosed(true);
  }, [
    markingDone,
    notDonePressed,
    onMarkDone,
    stopCurrentAlarmPresentation,
    task,
  ]);

  const handleRequestClose = () => {
    if (notDonePressed || markingDone) return;
    // Urgent due/overdue alarms are never dismissible without an explicit
    // action or the auto-miss timeout.
    if (requiresExplicitAction) {
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
      return;
    }
    // Non-urgent warnings may still be dismissed.
    setSelfClosed(true);
  };

  useEffect(() => {
    if (
      !visible ||
      selfClosed ||
      notDonePressed ||
      markingDone ||
      !AUTO_MISS_STAGE_KEYS.has(effectiveThresholdKey)
    ) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void handleNotDoneRef.current?.({ skipHaptic: true });
    }, AUTO_MISS_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [effectiveThresholdKey, markingDone, notDonePressed, selfClosed, visible]);

  if (!task) {
    return null;
  }

  const missedAlarmBanner =
    Platform.OS === "ios" ? (
      <IOSMissedAlarmBanner
        message={missedAlarmBannerMessage}
        onHide={() => setMissedAlarmBannerMessage("")}
      />
    ) : null;

  if (selfClosed) {
    return missedAlarmBanner;
  }

  return (
    <>
      {missedAlarmBanner}
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
                transform: [
                  { translateY: slideAnim },
                  { translateX: shakeAnim },
                ],
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
            {/* Live countdown or overdue duration */}
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
                {isOverdue && overdueDuration
                  ? `⏰ +${overdueDuration} overdue`
                  : countdown}
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
    </>
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
  missedBannerContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: "center",
  },
  missedBanner: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  missedBannerText: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
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
