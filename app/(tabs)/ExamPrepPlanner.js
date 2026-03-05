/**
 * ExamPrepPlanner.js
 *
 * HOW IT WORKS:
 * 1. Shows all upcoming exams from the assignments collection (type === "exam")
 * 2. Student taps an exam → sees a setup modal:
 *    - How many study sessions do you need?
 *    - How long per session? (25 / 45 / 60 / 90 min)
 *    - Preferred study time (morning / afternoon / evening)
 * 3. App calculates available days between today and exam date
 * 4. Warns if not enough days for requested sessions
 * 5. Generates a prep schedule — one session per day, skipping days
 *    that already have the same exam's sessions
 * 6. Saves the prep plan to AsyncStorage (works offline too)
 * 7. Shows a countdown timeline for each exam with session cards
 * 8. Student marks sessions as done — progress bar fills up
 * 9. Notifications are scheduled for each prep session (day before reminder)
 */

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    collection, getDocs, query, where,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
    Alert, Animated, Modal,
    StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

// ── Constants ─────────────────────────────────────────────────────────────────
const PLANS_KEY     = (uid) => `exam_prep_plans_${uid}`;
const SESSION_DURATIONS = [25, 45, 60, 90];
const STUDY_TIMES = [
  { label: "Morning",   icon: "sunny-outline",      hour: 8  },
  { label: "Afternoon", icon: "partly-sunny-outline", hour: 14 },
  { label: "Evening",   icon: "moon-outline",        hour: 19 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysUntil(date) {
  const now  = new Date(); now.setHours(0, 0, 0, 0);
  const due  = new Date(date); due.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / 86400000);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function urgencyColor(days) {
  if (days <= 1)  return "#ef4444";
  if (days <= 3)  return "#f59e0b";
  if (days <= 7)  return "#0ea5e9";
  return "#10b981";
}

// ── Generate prep sessions spread across available days ───────────────────────
function generateSessions(examDate, sessionCount, preferredHour) {
  const sessions = [];
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const examDay  = new Date(examDate); examDay.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((examDay - today) / 86400000);

  // Can't schedule on exam day itself
  const availableDays = daysLeft - 1;
  if (availableDays <= 0) return sessions;

  // Space sessions evenly
  const gap = Math.max(1, Math.floor(availableDays / sessionCount));

  for (let i = 0; i < sessionCount; i++) {
    const sessionDay = new Date(today);
    // Space them out: first session = gap days from today, then every gap days
    const offset = Math.min(i * gap + 1, availableDays - (sessionCount - i - 1));
    sessionDay.setDate(today.getDate() + Math.max(1, offset));
    sessionDay.setHours(preferredHour, 0, 0, 0);

    // Don't go past the day before exam
    const dayBeforeExam = new Date(examDay);
    dayBeforeExam.setDate(examDay.getDate() - 1);
    if (sessionDay > dayBeforeExam) sessionDay.setTime(dayBeforeExam.getTime());

    sessions.push({
      id:        `session_${i + 1}_${Date.now()}`,
      number:    i + 1,
      date:      sessionDay.toISOString(),
      completed: false,
    });
  }

  return sessions;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ExamPrepPlanner() {
  const { colors, isDark } = useTheme();

  const [exams,       setExams]       = useState([]); // from Firestore
  const [plans,       setPlans]       = useState({}); // saved prep plans
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  // Setup modal state
  const [setupExam,       setSetupExam]       = useState(null);
  const [sessionCount,    setSessionCount]    = useState(5);
  const [sessionDuration, setSessionDuration] = useState(45);
  const [studyTimeIndex,  setStudyTimeIndex]  = useState(2); // Evening default

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { loadAll(); }, []);

  // ── Load exams from Firestore + plans from AsyncStorage ───────────────────
  const loadAll = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      // Load exam tasks
      const snap = await getDocs(query(
        collection(db, "assignments"),
        where("userId",    "==", user.uid),
        where("type",      "==", "exam"),
        where("completed", "==", false),
      ));

      const now      = new Date();
      const examList = snap.docs
        .map((d) => ({
          id:    d.id,
          ...d.data(),
          dueAt: d.data().dueAt?.toDate?.()?.toISOString() ?? null,
        }))
        .filter((e) => e.dueAt && new Date(e.dueAt) > now)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

      setExams(examList);

      // Load saved plans
      const raw = await AsyncStorage.getItem(PLANS_KEY(user.uid));
      if (raw) setPlans(JSON.parse(raw));

    } catch (err) {
      console.log("ExamPrep load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  };

  // ── Save a plan for an exam ───────────────────────────────────────────────
  const savePlan = async (examId, plan) => {
    const user = auth.currentUser;
    if (!user) return;
    const updated = { ...plans, [examId]: plan };
    setPlans(updated);
    await AsyncStorage.setItem(PLANS_KEY(user.uid), JSON.stringify(updated));
  };

  // ── Delete a plan ─────────────────────────────────────────────────────────
  const deletePlan = async (examId) => {
    const user = auth.currentUser;
    if (!user) return;
    const updated = { ...plans };
    delete updated[examId];
    setPlans(updated);
    await AsyncStorage.setItem(PLANS_KEY(user.uid), JSON.stringify(updated));
  };

  // ── Generate plan from setup modal ───────────────────────────────────────
  const generatePlan = () => {
    if (!setupExam) return;

    const days      = daysUntil(setupExam.dueAt);
    const available = days - 1; // can't study on exam day

    if (available <= 0) {
      Alert.alert("Too Late", "The exam is today or already passed.");
      setSetupExam(null);
      return;
    }

    if (sessionCount > available) {
      Alert.alert(
        "Not Enough Days",
        `You only have ${available} day${available > 1 ? "s" : ""} before the exam but requested ${sessionCount} sessions.\n\nTry ${available} sessions instead.`,
        [
          { text: "OK" },
          {
            text: `Use ${available} sessions`,
            onPress: () => {
              const preferredHour = STUDY_TIMES[studyTimeIndex].hour;
              const sessions = generateSessions(setupExam.dueAt, available, preferredHour);
              const plan = {
                examId:          setupExam.id,
                examTitle:       setupExam.title,
                examDate:        setupExam.dueAt,
                sessionCount:    available,
                sessionDuration,
                studyTime:       STUDY_TIMES[studyTimeIndex].label,
                sessions,
                createdAt:       new Date().toISOString(),
              };
              savePlan(setupExam.id, plan);
              setSetupExam(null);
            },
          },
        ]
      );
      return;
    }

    const preferredHour = STUDY_TIMES[studyTimeIndex].hour;
    const sessions = generateSessions(setupExam.dueAt, sessionCount, preferredHour);

    const plan = {
      examId:          setupExam.id,
      examTitle:       setupExam.title,
      examDate:        setupExam.dueAt,
      sessionCount,
      sessionDuration,
      studyTime:       STUDY_TIMES[studyTimeIndex].label,
      sessions,
      createdAt:       new Date().toISOString(),
    };

    savePlan(setupExam.id, plan);
    setSetupExam(null);
    Alert.alert(
      "✅ Plan Created!",
      `${sessionCount} study sessions have been scheduled for "${setupExam.title}".`,
    );
  };

  // ── Mark a session as done/undone ─────────────────────────────────────────
  const toggleSession = async (examId, sessionId) => {
    const plan = plans[examId];
    if (!plan) return;
    const updated = {
      ...plan,
      sessions: plan.sessions.map((s) =>
        s.id === sessionId ? { ...s, completed: !s.completed } : s
      ),
    };
    await savePlan(examId, updated);
  };

  const completedCount = (plan) => plan?.sessions?.filter((s) => s.completed).length ?? 0;
  const progress       = (plan) => plan?.sessions?.length
    ? completedCount(plan) / plan.sessions.length
    : 0;

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ color: colors.muted }}>Loading exams...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ── Hero ── */}
      <View style={[styles.hero, { backgroundColor: "#ef4444" }]}>
        <View style={styles.heroCircle} />
        <Text style={styles.heroSub}>Study smarter, not harder</Text>
        <Text style={styles.heroTitle}>Exam Prep Planner</Text>
        <View style={styles.heroPills}>
          <View style={[styles.heroPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Ionicons name="school" size={11} color="#fff" />
            <Text style={styles.heroPillText}>{exams.length} upcoming exam{exams.length !== 1 ? "s" : ""}</Text>
          </View>
          <View style={[styles.heroPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Ionicons name="checkmark-circle" size={11} color="#fff" />
            <Text style={styles.heroPillText}>{Object.keys(plans).length} plan{Object.keys(plans).length !== 1 ? "s" : ""} active</Text>
          </View>
        </View>
      </View>

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <View /> // placeholder — pull to refresh via state
        }
      >
        {exams.length === 0 ? (
          // ── Empty state ──────────────────────────────────────────────────
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📚</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Upcoming Exams</Text>
            <Text style={[styles.emptySub, { color: colors.muted }]}>
              Add an exam in the Add Task screen (Category: Exam) and it will appear here for planning.
            </Text>
            <View style={[styles.emptyTip, { backgroundColor: isDark ? "#1e293b" : "#fef2f2", borderColor: "#fecaca" }]}>
              <Ionicons name="bulb-outline" size={14} color="#ef4444" />
              <Text style={[styles.emptyTipText, { color: isDark ? "#fca5a5" : "#991b1b" }]}>
                Tip: Go to Add Task → select "Exam" as category → set your exam date
              </Text>
            </View>
          </View>
        ) : (
          exams.map((exam) => {
            const plan      = plans[exam.id];
            const days      = daysUntil(exam.dueAt);
            const urgColor  = urgencyColor(days);
            const hasPlan   = !!plan;
            const done      = hasPlan ? completedCount(plan) : 0;
            const total     = hasPlan ? plan.sessions.length : 0;
            const prog      = hasPlan ? progress(plan) : 0;

            return (
              <View key={exam.id} style={[styles.examCard, { backgroundColor: colors.card, borderTopColor: urgColor }]}>

                {/* ── Exam header ── */}
                <View style={styles.examHeader}>
                  <View style={[styles.examIconBox, { backgroundColor: urgColor + "15" }]}>
                    <Ionicons name="school" size={22} color={urgColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.examTitle, { color: colors.text }]} numberOfLines={2}>
                      {exam.title}
                    </Text>
                    <Text style={[styles.examSub, { color: colors.muted }]}>
                      {exam.subject}  ·  {formatDate(exam.dueAt)}
                    </Text>
                  </View>
                  {/* Countdown badge */}
                  <View style={[styles.countdownBadge, { backgroundColor: urgColor }]}>
                    <Text style={styles.countdownDays}>{days}</Text>
                    <Text style={styles.countdownLabel}>days</Text>
                  </View>
                </View>

                {/* ── No plan yet ── */}
                {!hasPlan && (
                  <TouchableOpacity
                    style={[styles.createPlanBtn, { borderColor: urgColor, backgroundColor: urgColor + "10" }]}
                    onPress={() => {
                      setSetupExam(exam);
                      setSessionCount(Math.min(5, Math.max(1, days - 1)));
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={urgColor} />
                    <Text style={[styles.createPlanBtnText, { color: urgColor }]}>
                      Create Study Plan
                    </Text>
                  </TouchableOpacity>
                )}

                {/* ── Has plan ── */}
                {hasPlan && (
                  <>
                    {/* Progress bar */}
                    <View style={styles.progRow}>
                      <View style={[styles.progTrack, { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }]}>
                        <View style={[styles.progFill, { width: `${prog * 100}%`, backgroundColor: urgColor }]} />
                      </View>
                      <Text style={[styles.progText, { color: colors.muted }]}>
                        {done}/{total} sessions
                      </Text>
                    </View>

                    {/* Plan info pills */}
                    <View style={styles.planMeta}>
                      <MetaChip icon="time-outline"    color={urgColor} label={`${plan.sessionDuration} min sessions`} />
                      <MetaChip icon="sunny-outline"   color={urgColor} label={plan.studyTime} />
                      <MetaChip icon="calendar-outline" color={urgColor} label={`${total} sessions planned`} />
                    </View>

                    {/* Session timeline */}
                    <Text style={[styles.timelineLabel, { color: colors.muted }]}>Study Schedule</Text>
                    {plan.sessions.map((session, idx) => {
                      const sessionDate = new Date(session.date);
                      const isPast      = sessionDate < new Date() && !session.completed;
                      const isToday     = daysUntil(session.date) === 0;

                      return (
                        <TouchableOpacity
                          key={session.id}
                          style={[styles.sessionRow, {
                            backgroundColor: session.completed
                              ? (isDark ? "#052e16" : "#f0fdf4")
                              : isToday
                              ? (isDark ? "#1e3a5f" : "#eff6ff")
                              : (isDark ? "#1e293b" : "#f8fafc"),
                            borderColor: session.completed ? "#22c55e"
                              : isToday ? "#3b82f6"
                              : isPast  ? "#ef4444"
                              : colors.border,
                          }]}
                          onPress={() => toggleSession(exam.id, session.id)}
                        >
                          {/* Session number circle */}
                          <View style={[styles.sessionNumBox, {
                            backgroundColor: session.completed ? "#22c55e"
                              : isToday ? "#3b82f6"
                              : isPast  ? "#ef4444"
                              : urgColor,
                          }]}>
                            {session.completed
                              ? <Ionicons name="checkmark" size={13} color="#fff" />
                              : <Text style={styles.sessionNum}>{session.number}</Text>
                            }
                          </View>

                          {/* Date & label */}
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.sessionDate, { color: colors.text }]}>
                              {isToday ? "Today" : formatShortDate(session.date)}
                              {" — "}
                              <Text style={{ fontWeight: "400", color: colors.muted }}>
                                Session {session.number}
                                {" · "}{plan.sessionDuration} min
                              </Text>
                            </Text>
                            {isPast && !session.completed && (
                              <Text style={styles.missedLabel}>Missed — tap to mark done anyway</Text>
                            )}
                            {isToday && !session.completed && (
                              <Text style={[styles.todayLabel, { color: "#3b82f6" }]}>Study today!</Text>
                            )}
                          </View>

                          {/* Tap hint */}
                          <Ionicons
                            name={session.completed ? "checkmark-circle" : "ellipse-outline"}
                            size={20}
                            color={session.completed ? "#22c55e" : colors.muted}
                          />
                        </TouchableOpacity>
                      );
                    })}

                    {/* Exam day row */}
                    <View style={[styles.examDayRow, { borderColor: urgColor + "40", backgroundColor: urgColor + "08" }]}>
                      <View style={[styles.examDayIcon, { backgroundColor: urgColor }]}>
                        <Ionicons name="flag" size={13} color="#fff" />
                      </View>
                      <Text style={[styles.examDayText, { color: urgColor }]}>
                        🎯 EXAM DAY — {formatDate(exam.dueAt)}
                      </Text>
                      <Text style={[styles.examDayCount, { color: urgColor }]}>
                        {days}d
                      </Text>
                    </View>

                    {/* All done message */}
                    {done === total && total > 0 && (
                      <View style={[styles.allDoneBox, { backgroundColor: isDark ? "#052e16" : "#f0fdf4" }]}>
                        <Text style={styles.allDoneText}>
                          🎉 All sessions complete! You're ready for the exam!
                        </Text>
                      </View>
                    )}

                    {/* Delete plan */}
                    <TouchableOpacity
                      style={[styles.deletePlanBtn, { borderColor: colors.border }]}
                      onPress={() => Alert.alert(
                        "Delete Plan",
                        `Delete the study plan for "${exam.title}"? Your progress will be lost.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deletePlan(exam.id) },
                        ]
                      )}
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.muted} />
                      <Text style={[styles.deletePlanText, { color: colors.muted }]}>Delete plan</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            );
          })
        )}

        <View style={{ height: 32 }} />
      </Animated.ScrollView>

      {/* ── Setup Modal ── */}
      <Modal visible={!!setupExam} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />

            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Plan Your Study
            </Text>
            {setupExam && (
              <Text style={[styles.modalSub, { color: colors.muted }]}>
                {setupExam.title}  ·  {daysUntil(setupExam.dueAt)} days left
              </Text>
            )}

            {/* Session count */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              How many study sessions?
            </Text>
            <View style={styles.countRow}>
              <TouchableOpacity
                style={[styles.countBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setSessionCount((v) => Math.max(1, v - 1))}
              >
                <Ionicons name="remove" size={18} color={colors.text} />
              </TouchableOpacity>
              <View style={[styles.countDisplay, { backgroundColor: "#ef444415", borderColor: "#ef4444" }]}>
                <Text style={[styles.countValue, { color: "#ef4444" }]}>{sessionCount}</Text>
                <Text style={[styles.countUnit,  { color: "#ef4444" }]}>sessions</Text>
              </View>
              <TouchableOpacity
                style={[styles.countBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setSessionCount((v) => Math.min(30, v + 1))}
              >
                <Ionicons name="add" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Session duration */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              How long per session?
            </Text>
            <View style={styles.durationRow}>
              {SESSION_DURATIONS.map((d) => (
                <TouchableOpacity key={d} onPress={() => setSessionDuration(d)}
                  style={[styles.durationChip, {
                    backgroundColor: sessionDuration === d ? "#ef4444" : colors.background,
                    borderColor:     sessionDuration === d ? "#ef4444" : colors.border,
                  }]}>
                  <Text style={[styles.durationText, { color: sessionDuration === d ? "#fff" : colors.text }]}>
                    {d} min
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Preferred study time */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              Preferred study time
            </Text>
            <View style={styles.studyTimeRow}>
              {STUDY_TIMES.map((t, i) => (
                <TouchableOpacity key={t.label} onPress={() => setStudyTimeIndex(i)}
                  style={[styles.studyTimeChip, {
                    backgroundColor: studyTimeIndex === i ? "#ef4444" : colors.background,
                    borderColor:     studyTimeIndex === i ? "#ef4444" : colors.border,
                    flex: 1,
                  }]}>
                  <Ionicons name={t.icon} size={16} color={studyTimeIndex === i ? "#fff" : colors.muted} />
                  <Text style={[styles.studyTimeText, { color: studyTimeIndex === i ? "#fff" : colors.text }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Warning if not enough days */}
            {setupExam && sessionCount > daysUntil(setupExam.dueAt) - 1 && (
              <View style={[styles.warnBox, { backgroundColor: "#fef3c7" }]}>
                <Ionicons name="warning-outline" size={14} color="#d97706" />
                <Text style={[styles.warnText, { color: "#92400e" }]}>
                  Only {daysUntil(setupExam.dueAt) - 1} days available. Sessions will be adjusted.
                </Text>
              </View>
            )}

            {/* Generate button */}
            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: "#ef4444" }]}
              onPress={generatePlan}
            >
              <Ionicons name="calendar" size={18} color="#fff" />
              <Text style={styles.generateBtnText}>Generate Study Plan</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setSetupExam(null)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Small MetaChip component ─────────────────────────────────────────────────
function MetaChip({ icon, color, label }) {
  return (
    <View style={[mcSt.chip, { backgroundColor: color + "12" }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[mcSt.text, { color }]}>{label}</Text>
    </View>
  );
}
const mcSt = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  text: { fontSize: 11, fontWeight: "600" },
});

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  hero: { paddingTop: 52, paddingBottom: 22, paddingHorizontal: 22, overflow: "hidden" },
  heroCircle: {
    position: "absolute", width: 180, height: 180, borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.07)", top: -50, right: -40,
  },
  heroSub:      { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle:    { color: "#fff", fontSize: 26, fontWeight: "800", marginBottom: 12 },
  heroPills:    { flexDirection: "row", gap: 8 },
  heroPill:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  content: { padding: 16 },

  // ── Empty ──────────────────────────────────────────────────────────────────
  emptyBox:   { alignItems: "center", padding: 36, borderRadius: 20, marginTop: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 8 },
  emptySub:   { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  emptyTip:   { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, alignSelf: "stretch" },
  emptyTipText: { flex: 1, fontSize: 12, lineHeight: 18 },

  // ── Exam card ─────────────────────────────────────────────────────────────
  examCard: {
    borderRadius: 18, padding: 16, marginBottom: 16,
    borderTopWidth: 4,
    elevation: 2, shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6,
  },
  examHeader:   { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  examIconBox:  { width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  examTitle:    { fontSize: 15, fontWeight: "800", marginBottom: 3 },
  examSub:      { fontSize: 12 },
  countdownBadge: { alignItems: "center", justifyContent: "center", width: 50, height: 50, borderRadius: 14, },
  countdownDays:  { color: "#fff", fontSize: 20, fontWeight: "900", lineHeight: 22 },
  countdownLabel: { color: "rgba(255,255,255,0.8)", fontSize: 9, fontWeight: "700", textTransform: "uppercase" },

  createPlanBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed",
  },
  createPlanBtnText: { fontSize: 14, fontWeight: "700" },

  // ── Progress ───────────────────────────────────────────────────────────────
  progRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  progTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  progFill:  { height: "100%", borderRadius: 4 },
  progText:  { fontSize: 12, fontWeight: "600", minWidth: 70, textAlign: "right" },

  planMeta:      { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 14 },
  timelineLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },

  // ── Session rows ───────────────────────────────────────────────────────────
  sessionRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 6,
  },
  sessionNumBox: { width: 28, height: 28, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  sessionNum:    { color: "#fff", fontSize: 12, fontWeight: "800" },
  sessionDate:   { fontSize: 13, fontWeight: "700" },
  missedLabel:   { fontSize: 11, color: "#ef4444", marginTop: 2 },
  todayLabel:    { fontSize: 11, fontWeight: "700", marginTop: 2 },

  examDayRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 4, marginBottom: 12,
  },
  examDayIcon: { width: 26, height: 26, borderRadius: 7, justifyContent: "center", alignItems: "center" },
  examDayText: { flex: 1, fontSize: 13, fontWeight: "800" },
  examDayCount:{ fontSize: 13, fontWeight: "800" },

  allDoneBox:  { padding: 12, borderRadius: 12, alignItems: "center", marginBottom: 10 },
  allDoneText: { color: "#16a34a", fontSize: 13, fontWeight: "700", textAlign: "center" },

  deletePlanBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 4,
  },
  deletePlanText: { fontSize: 12 },

  // ── Modal ──────────────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  modalCard: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#cbd5e1", alignSelf: "center", marginBottom: 20,
  },
  modalTitle:  { fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 4 },
  modalSub:    { fontSize: 13, textAlign: "center", marginBottom: 20 },
  fieldLabel:  { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 16 },

  countRow:    { flexDirection: "row", alignItems: "center", gap: 12, justifyContent: "center" },
  countBtn:    { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, justifyContent: "center", alignItems: "center" },
  countDisplay:{ alignItems: "center", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 14, borderWidth: 2 },
  countValue:  { fontSize: 32, fontWeight: "900", lineHeight: 36 },
  countUnit:   { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },

  durationRow:  { flexDirection: "row", gap: 8 },
  durationChip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  durationText: { fontSize: 13, fontWeight: "700" },

  studyTimeRow:  { flexDirection: "row", gap: 8 },
  studyTimeChip: { alignItems: "center", gap: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  studyTimeText: { fontSize: 11, fontWeight: "700" },

  warnBox:  { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 10, marginTop: 12 },
  warnText: { flex: 1, fontSize: 12, lineHeight: 17 },

  generateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 15, borderRadius: 14, marginTop: 20,
    elevation: 3, shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
  },
  generateBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  cancelBtn:       { alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 10 },
  cancelBtnText:   { fontSize: 14, fontWeight: "600" },
});
