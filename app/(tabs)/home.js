import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  collection, doc, getDoc, getDocs,
  orderBy, query, updateDoc, where,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  Animated, RefreshControl, ScrollView,
  StatusBar, StyleSheet, Text,
  TouchableOpacity, View,
} from "react-native";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

const PRIORITY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const PLANS_KEY      = (uid) => `exam_prep_plans_${uid}`;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning",   icon: "☀️" };
  if (h < 18) return { text: "Good afternoon", icon: "🌤️" };
  return       { text: "Good evening",   icon: "🌙" };
}

function getTodayString() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

function daysUntil(isoDate) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(isoDate); due.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / 86400000);
}

function urgencyColor(days) {
  if (days <= 1) return "#ef4444";
  if (days <= 3) return "#f59e0b";
  if (days <= 7) return "#0ea5e9";
  return "#10b981";
}

export default function HomeDashboard() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const [fullName,             setFullName]             = useState("");
  const [todayClasses,         setTodayClasses]         = useState([]);
  const [nextClass,            setNextClass]            = useState(null);
  const [upcomingAssignments,  setUpcomingAssignments]  = useState([]);
  const [announcements,        setAnnouncements]        = useState([]);
  const [upcomingExams,        setUpcomingExams]        = useState([]); // ← NEW
  const [examPlans,            setExamPlans]            = useState({}); // ← NEW
  const [loading,              setLoading]              = useState(true);
  const [refreshing,           setRefreshing]           = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => { fetchDashboardData(); }, []);

  const animateIn = () => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 480, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 480, useNativeDriver: true }),
    ]).start();
  };

  const fetchDashboardData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) return;
      const userData = userSnap.data();
      setFullName(userData.fullName || "");
      if (!userData.studentInfo) return;
      const { course, year, section, scheduleType } = userData.studentInfo;

      // ── Schedule ──────────────────────────────────────────────────────────
      const qSched = query(
        collection(db, "schedules"),
        where("course",        "==", course),
        where("year",          "==", year),
        where("section",       "==", section),
        where("scheduleType",  "==", scheduleType)
      );
      const schedSnap = await getDocs(qSched);
      if (!schedSnap.empty) {
        const weekSchedule = schedSnap.docs[0].data().weekSchedule || {};
        const todayName    = new Date().toLocaleString("en-US", { weekday: "long" });
        const classesToday = weekSchedule[todayName] || [];
        setTodayClasses(classesToday);
        const now  = new Date();
        const next = classesToday.find((cls) => {
          if (!cls.start) return false;
          const d = new Date(cls.start);
          if (!isNaN(d.getTime())) {
            const t = new Date(); t.setHours(d.getHours(), d.getMinutes(), 0, 0); return t > now;
          }
          const [h, m] = cls.start.split(":").map(Number);
          const t = new Date(); t.setHours(h, m, 0, 0); return t > now;
        });
        setNextClass(next || null);
      }

      // ── Assignments ───────────────────────────────────────────────────────
      const qA    = query(collection(db, "assignments"), where("userId", "==", user.uid), where("completed", "==", false), orderBy("dueAt"));
      const aSnap = await getDocs(qA);
      const allTasks = aSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUpcomingAssignments(allTasks);

      // ── Upcoming exams with prep plans ────────────────────────────────────
      const now     = new Date();
      const exams   = allTasks
        .filter((t) => t.type === "exam" && t.dueAt?.toDate() > now)
        .sort((a, b) => a.dueAt.toDate() - b.dueAt.toDate())
        .slice(0, 3); // show top 3 soonest exams
      setUpcomingExams(exams);

      const rawPlans = await AsyncStorage.getItem(PLANS_KEY(user.uid));
      if (rawPlans) setExamPlans(JSON.parse(rawPlans));

      // ── Announcements ─────────────────────────────────────────────────────
      const qAnn   = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
      const annSnap = await getDocs(qAnn);
      const filtered = annSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          if (a.audience === "all") return true;
          if (a.audience === "year"   && a.year === year) return true;
          if (a.audience === "course" && a.course === course && a.year === year && a.section === section) return true;
          return false;
        });
      setAnnouncements(filtered);

    } catch (err) {
      console.log("Home error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      animateIn();
    }
  };

  const onRefresh = () => { setRefreshing(true); fetchDashboardData(); };

  const markDone = async (id) => {
    await updateDoc(doc(db, "assignments", id), { completed: true });
    fetchDashboardData();
  };

  const greeting     = getGreeting();
  const now          = new Date();
  const overdueCount = upcomingAssignments.filter((a) => a.dueAt?.toDate() < now).length;

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.background} />
        <View style={styles.loadingCenter}>
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading your dashboard...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {/* ── HERO HEADER ── */}
        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <View style={styles.heroInner}>
            <Text style={styles.heroDate}>{getTodayString()}</Text>
            <Text style={styles.heroGreeting}>{greeting.icon} {greeting.text},</Text>
            <Text style={styles.heroName} numberOfLines={1}>
              {fullName ? fullName.split(" ")[0] : "Student"}!
            </Text>
            <View style={styles.pillRow}>
              <View style={[styles.pill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                <Ionicons name="book-outline" size={13} color="#fff" />
                <Text style={styles.pillText}>{upcomingAssignments.length} tasks</Text>
              </View>
              {overdueCount > 0 && (
                <View style={[styles.pill, { backgroundColor: "rgba(239,68,68,0.35)" }]}>
                  <Ionicons name="alert-circle-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>{overdueCount} overdue</Text>
                </View>
              )}
              {upcomingExams.length > 0 && (
                <View style={[styles.pill, { backgroundColor: "rgba(239,68,68,0.35)" }]}>
                  <Ionicons name="school-outline" size={13} color="#fff" />
                  <Text style={styles.pillText}>{upcomingExams.length} exam{upcomingExams.length > 1 ? "s" : ""}</Text>
                </View>
              )}
              <View style={[styles.pill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                <Ionicons name="megaphone-outline" size={13} color="#fff" />
                <Text style={styles.pillText}>{announcements.length} news</Text>
              </View>
            </View>
          </View>
          <View style={styles.heroCircle} />
          <View style={styles.heroCircle2} />
        </View>

        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── TODAY'S SCHEDULE ── */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Today's Classes</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/schedule")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>Full schedule →</Text>
            </TouchableOpacity>
          </View>

          {todayClasses.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <Text style={{ fontSize: 28 }}>🎉</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>No classes today!</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.classScroll}>
              {todayClasses.map((cls, i) => {
                const isNext = nextClass && cls.subject === nextClass.subject;
                return (
                  <View key={i} style={[
                    styles.classCard,
                    { backgroundColor: isNext ? colors.primary : colors.card },
                    isNext && styles.classCardActive,
                  ]}>
                    {isNext && (
                      <View style={styles.nextBadge}>
                        <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>NEXT</Text>
                      </View>
                    )}
                    <Text style={[styles.classSubject, { color: isNext ? "#fff" : colors.text }]}
                      numberOfLines={2}>{cls.subject}</Text>
                    <Text style={[styles.classTime, { color: isNext ? "rgba(255,255,255,0.8)" : colors.muted }]}>
                      {cls.timeDisplay || "—"}
                    </Text>
                    {cls.teacher && (
                      <Text style={[styles.classTeacher, { color: isNext ? "rgba(255,255,255,0.7)" : colors.muted }]}
                        numberOfLines={1}>👤 {cls.teacher}</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* ── UPCOMING TASKS ── */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Upcoming Tasks</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/assignments")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all →</Text>
            </TouchableOpacity>
          </View>

          {upcomingAssignments.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <Text style={{ fontSize: 28 }}>✅</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>All tasks completed!</Text>
            </View>
          ) : (
            upcomingAssignments.slice(0, 4).map((item) => {
              const due      = item.dueAt?.toDate();
              const isOverdue = due && due < now;
              const dueStr   = due ? due.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
              const pColor   = PRIORITY_COLOR[item.priority] || colors.primary;
              return (
                <View key={item.id} style={[styles.taskCard, { backgroundColor: colors.card }]}>
                  <View style={[styles.taskAccent, { backgroundColor: pColor }]} />
                  <View style={styles.taskBody}>
                    <View style={styles.taskTop}>
                      <Text style={[styles.taskTitle, { color: colors.text }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <View style={[styles.typeBadge, { backgroundColor: pColor + "22" }]}>
                        <Text style={[styles.typeBadgeText, { color: pColor }]}>
                          {item.type?.toUpperCase() || "TASK"}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.taskSub, { color: colors.muted }]}>{item.subject}</Text>
                    <View style={styles.taskBottom}>
                      <View style={[styles.duePill, {
                        backgroundColor: isOverdue ? "#fef2f2" : (isDark ? "#1e293b" : "#f1f5f9"),
                      }]}>
                        <Ionicons name="time-outline" size={11} color={isOverdue ? "#ef4444" : colors.muted} />
                        <Text style={[styles.dueText, { color: isOverdue ? "#ef4444" : colors.muted }]}>
                          {isOverdue ? "Overdue · " : ""}{dueStr}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.doneBtn, { backgroundColor: colors.success }]}
                        onPress={() => markDone(item.id)}
                      >
                        <Ionicons name="checkmark" size={14} color="#fff" />
                        <Text style={styles.doneBtnText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}

          {/* ── EXAM PREP SECTION ── */}
          {upcomingExams.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Exam Prep</Text>
                <TouchableOpacity onPress={() => router.push("/(tabs)/ExamPrepPlanner")}>
                  <Text style={[styles.seeAll, { color: "#ef4444" }]}>Open planner →</Text>
                </TouchableOpacity>
              </View>

              {upcomingExams.map((exam) => {
                const days     = daysUntil(exam.dueAt.toDate().toISOString());
                const urgColor = urgencyColor(days);
                const plan     = examPlans[exam.id];
                const done     = plan ? plan.sessions.filter((s) => s.completed).length : 0;
                const total    = plan ? plan.sessions.length : 0;
                const prog     = total > 0 ? done / total : 0;

                // Find today's session if any
                const todaySession = plan?.sessions?.find((s) => {
                  const d = new Date(s.date); d.setHours(0,0,0,0);
                  const t = new Date();       t.setHours(0,0,0,0);
                  return d.getTime() === t.getTime() && !s.completed;
                });

                return (
                  <TouchableOpacity
                    key={exam.id}
                    style={[styles.examCard, { backgroundColor: colors.card, borderLeftColor: urgColor }]}
                    onPress={() => router.push("/(tabs)/ExamPrepPlanner")}
                    activeOpacity={0.85}
                  >
                    {/* Top row */}
                    <View style={styles.examCardTop}>
                      <View style={[styles.examIconBox, { backgroundColor: urgColor + "18" }]}>
                        <Ionicons name="school" size={20} color={urgColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.examCardTitle, { color: colors.text }]} numberOfLines={1}>
                          {exam.title}
                        </Text>
                        <Text style={[styles.examCardSub, { color: colors.muted }]}>
                          {exam.subject}
                        </Text>
                      </View>
                      {/* Countdown badge */}
                      <View style={[styles.examCountdown, { backgroundColor: urgColor }]}>
                        <Text style={styles.examCountdownNum}>{days}</Text>
                        <Text style={styles.examCountdownLabel}>days</Text>
                      </View>
                    </View>

                    {/* Plan progress or no-plan prompt */}
                    {plan ? (
                      <>
                        <View style={styles.examProgRow}>
                          <View style={[styles.examProgTrack, { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }]}>
                            <View style={[styles.examProgFill, { width: `${prog * 100}%`, backgroundColor: urgColor }]} />
                          </View>
                          <Text style={[styles.examProgText, { color: colors.muted }]}>
                            {done}/{total} sessions
                          </Text>
                        </View>
                        {todaySession && (
                          <View style={[styles.todaySessionPill, { backgroundColor: "#3b82f615" }]}>
                            <Ionicons name="flash" size={12} color="#3b82f6" />
                            <Text style={styles.todaySessionText}>
                              Study session scheduled for today!
                            </Text>
                          </View>
                        )}
                        {done === total && total > 0 && (
                          <View style={[styles.todaySessionPill, { backgroundColor: "#22c55e15" }]}>
                            <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                            <Text style={[styles.todaySessionText, { color: "#16a34a" }]}>
                              All sessions complete — you're ready! 🎉
                            </Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={[styles.noPlanPill, { borderColor: urgColor + "50", backgroundColor: urgColor + "08" }]}>
                        <Ionicons name="add-circle-outline" size={13} color={urgColor} />
                        <Text style={[styles.noPlanText, { color: urgColor }]}>
                          Tap to create a study plan
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* ── ANNOUNCEMENTS ── */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Announcements</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/AnnouncementsScreen")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all →</Text>
            </TouchableOpacity>
          </View>

          {announcements.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <Text style={{ fontSize: 28 }}>📭</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>No announcements</Text>
            </View>
          ) : (
            announcements.slice(0, 3).map((item) => (
              <View key={item.id} style={[styles.announcementCard, { backgroundColor: colors.card, borderLeftColor: colors.primary }]}>
                <Text style={[styles.annTitle,    { color: colors.text  }]}>{item.title}</Text>
                <Text style={[styles.annBody,     { color: colors.muted }]} numberOfLines={2}>{item.message}</Text>
                <Text style={[styles.annAudience, { color: colors.primary }]}>
                  {item.audience === "all"    ? "📣 All Students"
                   : item.audience === "year" ? `📅 Year ${item.year}`
                   : `🎓 ${item.course} · Y${item.year} · Sec ${item.section}`}
                </Text>
              </View>
            ))
          )}

          <View style={{ height: 20 }} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1 },
  container:    { paddingBottom: 32 },
  loadingCenter:{ flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText:  { fontSize: 15 },

  hero: {
    paddingTop: 56, paddingBottom: 32,
    paddingHorizontal: 22, overflow: "hidden",
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
  },
  heroInner:    { zIndex: 2 },
  heroDate:     { color: "rgba(255,255,255,0.7)", fontSize: 12, letterSpacing: 0.5, marginBottom: 4 },
  heroGreeting: { color: "rgba(255,255,255,0.9)", fontSize: 16 },
  heroName:     { color: "#fff", fontSize: 30, fontWeight: "800", marginBottom: 14 },
  pillRow:      { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  pillText:     { color: "#fff", fontSize: 12, fontWeight: "600" },
  heroCircle:   { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,0.07)", top: -40, right: -40 },
  heroCircle2:  { position: "absolute", width: 100, height: 100, borderRadius: 50,  backgroundColor: "rgba(255,255,255,0.05)", bottom: 10, right: 60 },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, marginTop: 24, marginBottom: 10 },
  sectionLabel:  { fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  seeAll:        { fontSize: 13, fontWeight: "600" },

  emptyCard: { marginHorizontal: 18, borderRadius: 16, padding: 24, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14 },

  classScroll:     { paddingHorizontal: 18, gap: 12 },
  classCard:       { width: 140, padding: 14, borderRadius: 16, elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, position: "relative", overflow: "hidden" },
  classCardActive: { elevation: 6 },
  nextBadge:       { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  classSubject:    { fontSize: 13, fontWeight: "700", marginTop: 4, marginBottom: 6 },
  classTime:       { fontSize: 11, fontWeight: "600" },
  classTeacher:    { fontSize: 11, marginTop: 4 },

  taskCard:      { marginHorizontal: 18, marginBottom: 10, borderRadius: 16, flexDirection: "row", overflow: "hidden", elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  taskAccent:    { width: 4 },
  taskBody:      { flex: 1, padding: 14 },
  taskTop:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  taskTitle:     { fontSize: 14, fontWeight: "700", flex: 1, marginRight: 8 },
  typeBadge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  taskSub:       { fontSize: 12, marginBottom: 10 },
  taskBottom:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  duePill:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  dueText:       { fontSize: 11, fontWeight: "500" },
  doneBtn:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  doneBtnText:   { color: "#fff", fontSize: 12, fontWeight: "700" },

  // ── Exam Prep cards ────────────────────────────────────────────────────────
  examCard: {
    marginHorizontal: 18, marginBottom: 10, borderRadius: 16,
    padding: 14, borderLeftWidth: 4,
    elevation: 2, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 5,
  },
  examCardTop:       { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  examIconBox:       { width: 40, height: 40, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  examCardTitle:     { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  examCardSub:       { fontSize: 12 },
  examCountdown:     { alignItems: "center", justifyContent: "center", width: 46, height: 46, borderRadius: 12 },
  examCountdownNum:  { color: "#fff", fontSize: 18, fontWeight: "900", lineHeight: 20 },
  examCountdownLabel:{ color: "rgba(255,255,255,0.8)", fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  examProgRow:       { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  examProgTrack:     { flex: 1, height: 7, borderRadius: 4, overflow: "hidden" },
  examProgFill:      { height: "100%", borderRadius: 4 },
  examProgText:      { fontSize: 11, fontWeight: "600", minWidth: 60, textAlign: "right" },
  todaySessionPill:  { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 4 },
  todaySessionText:  { fontSize: 12, fontWeight: "600", color: "#2563eb" },
  noPlanPill:        { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderStyle: "dashed" },
  noPlanText:        { fontSize: 12, fontWeight: "600" },

  announcementCard: { marginHorizontal: 18, marginBottom: 10, borderRadius: 16, padding: 14, borderLeftWidth: 3, elevation: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4 },
  annTitle:         { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  annBody:          { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  annAudience:      { fontSize: 11, fontWeight: "600" },
});
