/**
 * ExamPrepPlanner.js
 * FIX: added useFocusEffect (auto-refresh when navigating to this screen)
 * FIX: added proper RefreshControl (pull-to-refresh was broken  had <View /> placeholder)
 */
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router"; // FIX
import {
    Timestamp,
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where,
} from "firebase/firestore";
import { useCallback, useRef, useState } from "react"; // FIX: useCallback
import {
    Alert,
    Animated,
    Modal,
    Platform,
    RefreshControl, // FIX: RefreshControl
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyStateCard from "../../components/EmptyStateCard";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import { useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { getUrgencyMeta } from "../../utils/deadlineTime";
import { daysUntil, formatDateShort, formatDateMedium } from "../../utils/dateHelpers";
import { safeParseExamPlans } from "../../utils/parsing";
import { getTabBarContentBottomPadding } from "../../utils/tabBarLayout";

//  Constants
const PLANS_KEY = (uid) => `exam_prep_plans_${uid}`;
const PLANS_COLLECTION = "exam_plans";
const SESSION_DURATIONS = [25, 45, 60, 90];
const STUDY_TIMES = [
  { label: "Morning", icon: "sunny-outline", hour: 8 },
  { label: "Afternoon", icon: "partly-sunny-outline", hour: 14 },
  { label: "Evening", icon: "moon-outline", hour: 19 },
];

//  Helpers

function generateSessions(examDate, sessionCount, preferredHour) {
  const sessions = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const examDay = new Date(examDate);
  examDay.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((examDay - today) / 86400000);
  const available = daysLeft - 1;
  if (available <= 0) return sessions;
  const gap = Math.max(1, Math.floor(available / sessionCount));
  for (let i = 0; i < sessionCount; i++) {
    const sessionDay = new Date(today);
    const offset = Math.min(i * gap + 1, available - (sessionCount - i - 1));
    sessionDay.setDate(today.getDate() + Math.max(1, offset));
    sessionDay.setHours(preferredHour, 0, 0, 0);
    const dayBeforeExam = new Date(examDay);
    dayBeforeExam.setDate(examDay.getDate() - 1);
    if (sessionDay > dayBeforeExam) sessionDay.setTime(dayBeforeExam.getTime());
    sessions.push({
      id: `session_${i + 1}_${Date.now()}`,
      number: i + 1,
      date: sessionDay.toISOString(),
      completed: false,
    });
  }
  return sessions;
}

function getDefaultExamDueAt() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  return d;
}

//  Main Component
export default function ExamPrepPlanner() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline } = useOffline();
  const { rescheduleDeadlineAlarmsForTask } = useNotifications();

  const [exams, setExams] = useState([]);
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [setupExam, setSetupExam] = useState(null);
  const [sessionCount, setSessionCount] = useState(5);
  const [sessionDuration, setSessionDuration] = useState(45);
  const [studyTimeIndex, setStudyTimeIndex] = useState(2);
  const [showCreateExamModal, setShowCreateExamModal] = useState(false);
  const [newExamTitle, setNewExamTitle] = useState("");
  const [newExamSubject, setNewExamSubject] = useState("");
  const [newExamDueAt, setNewExamDueAt] = useState(() => getDefaultExamDueAt());
  const [showExamDatePicker, setShowExamDatePicker] = useState(false);
  const [creatingExam, setCreatingExam] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasLoaded = useRef(false);

  // FIX: auto-refresh when this screen is focused
  useFocusEffect(
    useCallback(() => {
      if (!hasLoaded.current) {
        loadAll();
        hasLoaded.current = true;
      } else {
        loadAll(true); // silent refresh  picks up new exams added from assignments tab
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const loadAll = async (silent = false) => {
    const user = auth.currentUser;
    if (!user) {
      setRefreshing(false);
      setLoading(false);
      return;
    }
    try {
      const snap = await getDocs(
        query(
          collection(db, "assignments"),
          where("userId", "==", user.uid),
          where("type", "==", "exam"),
          where("completed", "==", false)
        )
      );
      const now = new Date();
      const examList = snap.docs
        .map((d) => ({
          id: d.id,
          ...d.data(),
          dueAt: d.data().dueAt?.toDate?.()?.toISOString() ?? null,
        }))
        .filter((e) => e.dueAt && new Date(e.dueAt) > now)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
      setExams(examList);
      const localRaw = await AsyncStorage.getItem(PLANS_KEY(user.uid));
      const localPlans = safeParseExamPlans(localRaw);

      if (!isOnline) {
        setPlans(localPlans);
      } else {
        try {
          const snap = await getDocs(
            collection(db, "users", user.uid, PLANS_COLLECTION)
          );
          const remotePlans = {};
          snap.forEach((docSnap) => {
            remotePlans[docSnap.id] = docSnap.data();
          });
          const merged = { ...remotePlans, ...localPlans };
          setPlans(merged);
          await AsyncStorage.setItem(
            PLANS_KEY(user.uid),
            JSON.stringify(merged)
          );
          // Push any locally created plans to Firestore
          await Promise.all(
            Object.entries(merged).map(([examId, plan]) =>
              setDoc(
                doc(db, "users", user.uid, PLANS_COLLECTION, examId),
                {
                  ...plan,
                  examId,
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              )
            )
          );
        } catch (_err) {
          console.warn("Failed to load remote exam plans:", _err);
          setPlans(localPlans);
        }
      }
    } catch (err) {
      console.warn("Failed to load exams or plans:", err);
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  const resetCreateExamForm = () => {
    setNewExamTitle("");
    setNewExamSubject("");
    setNewExamDueAt(getDefaultExamDueAt());
    setShowExamDatePicker(false);
  };

  const openCreateExamModal = () => {
    resetCreateExamForm();
    setShowCreateExamModal(true);
  };

  const closeCreateExamModal = () => {
    if (creatingExam) return;
    setShowExamDatePicker(false);
    setShowCreateExamModal(false);
  };

  const handleExamDateChange = (_event, selectedDate) => {
    if (Platform.OS !== "ios") setShowExamDatePicker(false);
    if (!selectedDate) return;
    setNewExamDueAt((prev) => {
      const next = new Date(selectedDate);
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      return next;
    });
  };

  const createExamFromPlanner = async () => {
    if (creatingExam) return;
    if (!isOnline) {
      Alert.alert(
        "Offline",
        "Connect to the internet to create an exam from Planner."
      );
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Sign in required", "Please sign in to create an exam.");
      return;
    }

    const title = String(newExamTitle || "").trim();
    const subject = String(newExamSubject || "").trim();
    if (!title) {
      Alert.alert("Missing title", "Enter an exam title.");
      return;
    }
    if (!subject) {
      Alert.alert("Missing subject", "Enter the subject name.");
      return;
    }
    if (!(newExamDueAt instanceof Date) || Number.isNaN(newExamDueAt.getTime())) {
      Alert.alert("Invalid date", "Pick a valid exam date.");
      return;
    }
    if (newExamDueAt <= new Date()) {
      Alert.alert("Invalid date", "Choose a future exam date.");
      return;
    }

    setCreatingExam(true);
    try {
      const dueAt = new Date(newExamDueAt);
      const payload = {
        userId: user.uid,
        title,
        subject,
        subjectName: subject,
        dueAt: Timestamp.fromDate(dueAt),
        completed: false,
        status: "todo",
        type: "exam",
        priority: "high",
        priorityLevel: 1,
        source: "planner",
        createdAt: serverTimestamp(),
        schemaVersion: 2,
      };

      const examRef = await addDoc(collection(db, "assignments"), payload);
      await rescheduleDeadlineAlarmsForTask(examRef.id);
      const createdExam = {
        id: examRef.id,
        title,
        subject,
        dueAt: dueAt.toISOString(),
      };

      setExams((prev) =>
        [...prev, createdExam].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
      );
      setShowCreateExamModal(false);

      const maxSessions = Math.max(1, daysUntil(createdExam.dueAt) - 1);
      Alert.alert(
        "Exam created",
        "Do you want to create the study plan now?",
        [
          { text: "Later", style: "cancel" },
          {
            text: "Create plan",
            onPress: () => {
              setSessionCount(Math.min(5, maxSessions));
              setSetupExam(createdExam);
            },
          },
        ]
      );
      loadAll(true);
    } catch (err) {
      console.warn("Failed to create exam from planner:", err);
      Alert.alert("Create failed", "Could not create exam. Please try again.");
    } finally {
      setCreatingExam(false);
    }
  };

  const savePlan = async (examId, plan) => {
    const user = auth.currentUser;
    if (!user) return;
    const updated = { ...plans, [examId]: plan };
    setPlans(updated);
    await AsyncStorage.setItem(PLANS_KEY(user.uid), JSON.stringify(updated));
    if (isOnline) {
      try {
        await setDoc(
          doc(db, "users", user.uid, PLANS_COLLECTION, examId),
          {
            ...plan,
            examId,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn("Failed to sync exam plan:", err);
      }
    }
  };

  const deletePlan = async (examId) => {
    const user = auth.currentUser;
    if (!user) return;
    const updated = { ...plans };
    delete updated[examId];
    setPlans(updated);
    await AsyncStorage.setItem(PLANS_KEY(user.uid), JSON.stringify(updated));
    if (isOnline) {
      try {
        await deleteDoc(doc(db, "users", user.uid, PLANS_COLLECTION, examId));
      } catch (err) {
        console.warn("Failed to delete exam plan from server:", err);
      }
    }
  };

  const generatePlan = () => {
    if (!setupExam) return;
    const days = daysUntil(setupExam.dueAt);
    const available = days - 1;
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
              const sessions = generateSessions(
                setupExam.dueAt,
                available,
                preferredHour
              );
              savePlan(setupExam.id, {
                examId: setupExam.id,
                examTitle: setupExam.title,
                examDate: setupExam.dueAt,
                sessionCount: available,
                sessionDuration,
                studyTime: STUDY_TIMES[studyTimeIndex].label,
                sessions,
                createdAt: new Date().toISOString(),
              });
              setSetupExam(null);
            },
          },
        ]
      );
      return;
    }
    const preferredHour = STUDY_TIMES[studyTimeIndex].hour;
    const sessions = generateSessions(
      setupExam.dueAt,
      sessionCount,
      preferredHour
    );
    savePlan(setupExam.id, {
      examId: setupExam.id,
      examTitle: setupExam.title,
      examDate: setupExam.dueAt,
      sessionCount,
      sessionDuration,
      studyTime: STUDY_TIMES[studyTimeIndex].label,
      sessions,
      createdAt: new Date().toISOString(),
    });
    setSetupExam(null);
    Alert.alert(
      "Plan Created",
      `${sessionCount} study sessions scheduled for "${setupExam.title}".`
    );
  };

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

  const completedCount = (plan) =>
    plan?.sessions?.filter((s) => s.completed).length ?? 0;
  const progress = (plan) =>
    plan?.sessions?.length ? completedCount(plan) / plan.sessions.length : 0;

  if (loading) {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: colors.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <Text style={{ color: colors.muted }}>Loading exams...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#ef4444" />
      {/* Hero */}
      <View
        style={[
          styles.hero,
          { backgroundColor: "#ef4444", paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.heroCircle} />
        <View style={styles.heroCircle2} />
        <Text style={styles.heroSub}>Study smarter, not harder</Text>
        <Text style={styles.heroTitle}>Exam Prep Planner</Text>
        <View style={styles.heroPills}>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="school" size={11} color="#fff" />
            <Text style={styles.heroPillText}>
              {exams.length} upcoming exam{exams.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="checkmark-circle" size={11} color="#fff" />
            <Text style={styles.heroPillText}>
              {Object.keys(plans).length} plan
              {Object.keys(plans).length !== 1 ? "s" : ""} active
            </Text>
          </View>
        </View>
      </View>

      {/* FIX: real RefreshControl instead of <View /> placeholder */}
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: getTabBarContentBottomPadding(insets.bottom) },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadAll();
            }}
            colors={["#ef4444"]}
            tintColor="#ef4444"
          />
        }
      >
        <TouchableOpacity
          style={[
            styles.createExamQuickBtn,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={openCreateExamModal}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.createExamQuickIcon,
              { backgroundColor: isDark ? "#3f1d1d" : "#fef2f2" },
            ]}
          >
            <Ionicons name="add-circle-outline" size={18} color="#ef4444" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.createExamQuickTitle, { color: colors.text }]}>
              Create exam in Planner
            </Text>
            <Text style={[styles.createExamQuickSub, { color: colors.muted }]}>
              Add exam title, subject, and date here.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </TouchableOpacity>

        {exams.length === 0 ? (
          <>
            <EmptyStateCard
              title="No upcoming exams"
              message="Create your first exam from this Planner screen to start your study plan."
              icon="school-outline"
              style={{ marginTop: 8 }}
            />
            <View
              style={[
                styles.emptyTip,
                {
                  backgroundColor: isDark ? "#1e293b" : "#fef2f2",
                  borderColor: "#fecaca",
                },
              ]}
            >
              <Ionicons name="bulb-outline" size={14} color="#ef4444" />
              <Text
                style={[
                  styles.emptyTipText,
                  { color: isDark ? "#fca5a5" : "#991b1b" },
                ]}
              >
                Tip: Tap Create exam in Planner above, then generate your
                study sessions right away.
              </Text>
            </View>
          </>
        ) : (
          exams.map((exam) => {
            const plan = plans[exam.id];
            const days = daysUntil(exam.dueAt);
            const urgColor = getUrgencyMeta(new Date(exam.dueAt).getTime()).color;
            const hasPlan = !!plan;
            const done = hasPlan ? completedCount(plan) : 0;
            const total = hasPlan ? plan.sessions.length : 0;
            const prog = hasPlan ? progress(plan) : 0;
            return (
              <View
                key={exam.id}
                style={[
                  styles.examCard,
                  { backgroundColor: colors.card, borderTopColor: urgColor },
                ]}
              >
                <View style={styles.examHeader}>
                  <View
                    style={[
                      styles.examIconBox,
                      { backgroundColor: urgColor + "15" },
                    ]}
                  >
                    <Ionicons name="school" size={22} color={urgColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.examTitle, { color: colors.text }]}
                      numberOfLines={2}
                    >
                      {exam.title}
                    </Text>
                    <Text style={[styles.examSub, { color: colors.muted }]}>
                      {exam.subject} {formatDateShort(exam.dueAt)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.countdownBadge,
                      { backgroundColor: urgColor },
                    ]}
                  >
                    <Text style={styles.countdownDays}>{days}</Text>
                    <Text style={styles.countdownLabel}>days</Text>
                  </View>
                </View>

                {!hasPlan && (
                  <TouchableOpacity
                    style={[
                      styles.createPlanBtn,
                      {
                        borderColor: urgColor,
                        backgroundColor: urgColor + "10",
                      },
                    ]}
                    onPress={() => {
                      setSetupExam(exam);
                      setSessionCount(Math.min(5, Math.max(1, days - 1)));
                    }}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color={urgColor}
                    />
                    <Text
                      style={[styles.createPlanBtnText, { color: urgColor }]}
                    >
                      Create Study Plan
                    </Text>
                  </TouchableOpacity>
                )}

                {hasPlan && (
                  <>
                    <View style={styles.progRow}>
                      <View
                        style={[
                          styles.progTrack,
                          { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                        ]}
                      >
                        <View
                          style={[
                            styles.progFill,
                            {
                              width: `${prog * 100}%`,
                              backgroundColor: urgColor,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.progText, { color: colors.muted }]}>
                        {done}/{total} sessions
                      </Text>
                    </View>
                    <View style={styles.planMeta}>
                      <MetaChip
                        icon="time-outline"
                        color={urgColor}
                        label={`${plan.sessionDuration} min sessions`}
                      />
                      <MetaChip
                        icon="sunny-outline"
                        color={urgColor}
                        label={plan.studyTime}
                      />
                      <MetaChip
                        icon="calendar-outline"
                        color={urgColor}
                        label={`${total} sessions planned`}
                      />
                    </View>
                    <Text
                      style={[styles.timelineLabel, { color: colors.muted }]}
                    >
                      Study Schedule
                    </Text>
                    {plan.sessions.map((session) => {
                      const sessionDate = new Date(session.date);
                      const isPast =
                        sessionDate < new Date() && !session.completed;
                      const isToday = daysUntil(session.date) === 0;
                      return (
                        <TouchableOpacity
                          key={session.id}
                          style={[
                            styles.sessionRow,
                            {
                              backgroundColor: session.completed
                                ? isDark
                                  ? "#052e16"
                                  : "#f0fdf4"
                                : isToday
                                  ? isDark
                                    ? "#1e3a5f"
                                    : "#eff6ff"
                                  : isDark
                                    ? "#1e293b"
                                    : "#f8fafc",
                              borderColor: session.completed
                                ? "#22c55e"
                                : isToday
                                  ? "#3b82f6"
                                  : isPast
                                    ? "#ef4444"
                                    : colors.border,
                            },
                          ]}
                          onPress={() => toggleSession(exam.id, session.id)}
                        >
                          <View
                            style={[
                              styles.sessionNumBox,
                              {
                                backgroundColor: session.completed
                                  ? "#22c55e"
                                  : isToday
                                    ? "#3b82f6"
                                    : isPast
                                      ? "#ef4444"
                                      : urgColor,
                              },
                            ]}
                          >
                            {session.completed ? (
                              <Ionicons
                                name="checkmark"
                                size={13}
                                color="#fff"
                              />
                            ) : (
                              <Text style={styles.sessionNum}>
                                {session.number}
                              </Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.sessionDate,
                                { color: colors.text },
                              ]}
                            >
                              {isToday
                                ? "Today"
                                : formatDateMedium(session.date)}
                              {"  "}
                              <Text
                                style={{
                                  fontWeight: "400",
                                  color: colors.muted,
                                }}
                              >
                                Session {session.number}
                                {"  "}
                                {plan.sessionDuration} min
                              </Text>
                            </Text>
                            {isPast && !session.completed && (
                              <Text style={styles.missedLabel}>
                                Missed tap to mark done anyway
                              </Text>
                            )}
                            {isToday && !session.completed && (
                              <Text
                                style={[
                                  styles.todayLabel,
                                  { color: "#3b82f6" },
                                ]}
                              >
                                Study today!
                              </Text>
                            )}
                          </View>
                          <Ionicons
                            name={
                              session.completed
                                ? "checkmark-circle"
                                : "ellipse-outline"
                            }
                            size={20}
                            color={session.completed ? "#22c55e" : colors.muted}
                          />
                        </TouchableOpacity>
                      );
                    })}
                    <View
                      style={[
                        styles.examDayRow,
                        {
                          borderColor: urgColor + "40",
                          backgroundColor: urgColor + "08",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.examDayIcon,
                          { backgroundColor: urgColor },
                        ]}
                      >
                        <Ionicons name="flag" size={13} color="#fff" />
                      </View>
                      <Text style={[styles.examDayText, { color: urgColor }]}>
                        {" "}
                        EXAM DAY {formatDateShort(exam.dueAt)}
                      </Text>
                      <Text style={[styles.examDayCount, { color: urgColor }]}>
                        {days}d
                      </Text>
                    </View>
                    {done === total && total > 0 && (
                      <View
                        style={[
                          styles.allDoneBox,
                          { backgroundColor: isDark ? "#052e16" : "#f0fdf4" },
                        ]}
                      >
                        <Text style={styles.allDoneText}>
                          All sessions complete! You are ready for the exam!
                        </Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={[
                        styles.deletePlanBtn,
                        { borderColor: colors.border },
                      ]}
                      onPress={() =>
                        Alert.alert(
                          "Delete Plan",
                          `Delete the study plan for "${exam.title}"? Your progress will be lost.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => deletePlan(exam.id),
                            },
                          ]
                        )
                      }
                    >
                      <Ionicons
                        name="trash-outline"
                        size={14}
                        color={colors.muted}
                      />
                      <Text
                        style={[styles.deletePlanText, { color: colors.muted }]}
                      >
                        Delete plan
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            );
          })
        )}
      </Animated.ScrollView>

      <Modal
        visible={showCreateExamModal}
        transparent
        animationType="fade"
        onRequestClose={closeCreateExamModal}
      >
        <View style={styles.createExamOverlay}>
          <View
            style={[
              styles.createExamCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.createExamTitle, { color: colors.text }]}>
              Create Exam
            </Text>
            <Text style={[styles.createExamSub, { color: colors.muted }]}>
              Add the exam here, then generate your study plan.
            </Text>

            <TextInput
              style={[
                styles.createExamInput,
                { borderColor: colors.border, color: colors.text },
              ]}
              placeholder="Exam title"
              placeholderTextColor={colors.muted}
              value={newExamTitle}
              onChangeText={setNewExamTitle}
              editable={!creatingExam}
            />
            <TextInput
              style={[
                styles.createExamInput,
                { borderColor: colors.border, color: colors.text },
              ]}
              placeholder="Subject"
              placeholderTextColor={colors.muted}
              value={newExamSubject}
              onChangeText={setNewExamSubject}
              editable={!creatingExam}
            />

            <TouchableOpacity
              style={[
                styles.createExamDateBtn,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
              onPress={() => setShowExamDatePicker(true)}
              disabled={creatingExam}
            >
              <Ionicons name="calendar-outline" size={16} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.createExamDateLabel, { color: colors.muted }]}>
                  Exam Date
                </Text>
                <Text style={[styles.createExamDateValue, { color: colors.text }]}>
                  {newExamDueAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Text>
              </View>
            </TouchableOpacity>

            {showExamDatePicker && (
              <DateTimePicker
                value={newExamDueAt}
                mode="date"
                minimumDate={new Date()}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={handleExamDateChange}
              />
            )}

            <TouchableOpacity
              style={[
                styles.createExamSubmitBtn,
                { backgroundColor: "#ef4444", opacity: creatingExam ? 0.65 : 1 },
              ]}
              onPress={createExamFromPlanner}
              disabled={creatingExam}
            >
              <Text style={styles.createExamSubmitText}>
                {creatingExam ? "Creating..." : "Create Exam"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.createExamCancelBtn,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
              onPress={closeCreateExamModal}
              disabled={creatingExam}
            >
              <Text style={[styles.createExamCancelText, { color: colors.muted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Setup Modal */}
      <Modal visible={!!setupExam} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Plan Your Study
            </Text>
            {setupExam && (
              <Text style={[styles.modalSub, { color: colors.muted }]}>
                {setupExam.title} {daysUntil(setupExam.dueAt)} days left
              </Text>
            )}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              How many study sessions?
            </Text>
            <View style={styles.countRow}>
              <TouchableOpacity
                style={[
                  styles.countBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setSessionCount((v) => Math.max(1, v - 1))}
              >
                <Ionicons name="remove" size={18} color={colors.text} />
              </TouchableOpacity>
              <View
                style={[
                  styles.countDisplay,
                  { backgroundColor: "#ef444415", borderColor: "#ef4444" },
                ]}
              >
                <Text style={[styles.countValue, { color: "#ef4444" }]}>
                  {sessionCount}
                </Text>
                <Text style={[styles.countUnit, { color: "#ef4444" }]}>
                  sessions
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.countBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setSessionCount((v) => Math.min(30, v + 1))}
              >
                <Ionicons name="add" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              How long per session?
            </Text>
            <View style={styles.durationRow}>
              {SESSION_DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  onPress={() => setSessionDuration(d)}
                  style={[
                    styles.durationChip,
                    {
                      backgroundColor:
                        sessionDuration === d ? "#ef4444" : colors.background,
                      borderColor:
                        sessionDuration === d ? "#ef4444" : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.durationText,
                      { color: sessionDuration === d ? "#fff" : colors.text },
                    ]}
                  >
                    {d} min
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>
              Preferred study time
            </Text>
            <View style={styles.studyTimeRow}>
              {STUDY_TIMES.map((t, i) => (
                <TouchableOpacity
                  key={t.label}
                  onPress={() => setStudyTimeIndex(i)}
                  style={[
                    styles.studyTimeChip,
                    {
                      backgroundColor:
                        studyTimeIndex === i ? "#ef4444" : colors.background,
                      borderColor:
                        studyTimeIndex === i ? "#ef4444" : colors.border,
                      flex: 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={t.icon}
                    size={16}
                    color={studyTimeIndex === i ? "#fff" : colors.muted}
                  />
                  <Text
                    style={[
                      styles.studyTimeText,
                      { color: studyTimeIndex === i ? "#fff" : colors.text },
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {setupExam && sessionCount > daysUntil(setupExam.dueAt) - 1 && (
              <View style={[styles.warnBox, { backgroundColor: "#fef3c7" }]}>
                <Ionicons name="warning-outline" size={14} color="#d97706" />
                <Text style={[styles.warnText, { color: "#92400e" }]}>
                  Only {daysUntil(setupExam.dueAt) - 1} days available. Sessions
                  will be adjusted.
                </Text>
              </View>
            )}
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

function MetaChip({ icon, color, label }) {
  return (
    <View style={[mcSt.chip, { backgroundColor: color + "12" }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[mcSt.text, { color }]}>{label}</Text>
    </View>
  );
}
const mcSt = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  text: { fontSize: 11, fontWeight: "600" },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingTop: 52,
    paddingBottom: 22,
    paddingHorizontal: 22,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroCircle: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -50,
    right: -40,
  },
  heroCircle2: {
    position: "absolute",
    width: 94,
    height: 94,
    borderRadius: 47,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 64,
  },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
  },
  heroPills: { flexDirection: "row", gap: 8 },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  content: { padding: 16 },
  createExamQuickBtn: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  createExamQuickIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  createExamQuickTitle: { fontSize: 13, fontWeight: "800", marginBottom: 1 },
  createExamQuickSub: { fontSize: 11, fontWeight: "500" },
  emptyBox: {
    alignItems: "center",
    padding: 36,
    borderRadius: 20,
    marginTop: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 8 },
  emptySub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  emptyTip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: "stretch",
  },
  emptyTipText: { flex: 1, fontSize: 12, lineHeight: 18 },
  examCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderTopWidth: 4,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
  },
  examHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  examIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  examTitle: { fontSize: 15, fontWeight: "800", marginBottom: 3 },
  examSub: { fontSize: 12 },
  countdownBadge: {
    alignItems: "center",
    justifyContent: "center",
    width: 50,
    height: 50,
    borderRadius: 14,
  },
  countdownDays: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 22,
  },
  countdownLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  createPlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
  createPlanBtnText: { fontSize: 14, fontWeight: "700" },
  progRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  progTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  progFill: { height: "100%", borderRadius: 4 },
  progText: {
    fontSize: 12,
    fontWeight: "600",
    minWidth: 70,
    textAlign: "right",
  },
  planMeta: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  timelineLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
  },
  sessionNumBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  sessionNum: { color: "#fff", fontSize: 12, fontWeight: "800" },
  sessionDate: { fontSize: 13, fontWeight: "700" },
  missedLabel: { fontSize: 11, color: "#ef4444", marginTop: 2 },
  todayLabel: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  examDayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 12,
  },
  examDayIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    justifyContent: "center",
    alignItems: "center",
  },
  examDayText: { flex: 1, fontSize: 13, fontWeight: "800" },
  examDayCount: { fontSize: 13, fontWeight: "800" },
  allDoneBox: {
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  allDoneText: {
    color: "#16a34a",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  deletePlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  deletePlanText: { fontSize: 12 },
  createExamOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 22,
  },
  createExamCard: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
  },
  createExamTitle: { fontSize: 20, fontWeight: "800", marginBottom: 4 },
  createExamSub: { fontSize: 12, fontWeight: "500", marginBottom: 12 },
  createExamInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 10,
  },
  createExamDateBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  createExamDateLabel: { fontSize: 11, fontWeight: "600", marginBottom: 1 },
  createExamDateValue: { fontSize: 14, fontWeight: "700" },
  createExamSubmitBtn: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  createExamSubmitText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  createExamCancelBtn: {
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 8,
  },
  createExamCancelText: { fontSize: 13, fontWeight: "700" },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 44,
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
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  modalSub: { fontSize: 13, textAlign: "center", marginBottom: 20 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 16,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
  },
  countBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
  },
  countDisplay: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 2,
  },
  countValue: { fontSize: 32, fontWeight: "900", lineHeight: 36 },
  countUnit: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  durationRow: { flexDirection: "row", gap: 8 },
  durationChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  durationText: { fontSize: 13, fontWeight: "700" },
  studyTimeRow: { flexDirection: "row", gap: 8 },
  studyTimeChip: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  studyTimeText: { fontSize: 11, fontWeight: "700" },
  warnBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  warnText: { flex: 1, fontSize: 12, lineHeight: 17 },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 15,
    borderRadius: 14,
    marginTop: 20,
    elevation: 3,
  },
  generateBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  cancelBtn: {
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600" },
});
