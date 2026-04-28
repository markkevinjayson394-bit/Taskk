import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../config/firebase";
import { useTheme } from "../context/ThemeContext";
import {
  getPostOnboardingRoute,
  markOnboardingCompleted,
} from "../utils/onboarding";

const STUDENT_SLIDES = [
  {
    icon: "home-outline",
    eyebrow: "Start Here",
    title: "Home shows your next academic move",
    message:
      "Open Home first after login. It summarizes your next class, urgent tasks, and today's plan so you do not have to guess where to begin.",
    findIt: "Home tab",
    bestFor: "Seeing what needs attention in the next few hours",
    tip: "If you only check one screen before class, check Home.",
    tags: ["Next class", "Urgent tasks", "Today's plan"],
    bullets: [
      "Use the top card to decide what to do now",
      "Return here after finishing a task to see the next priority",
      "Use quick actions when you need to jump into Planner or Task Manager",
    ],
  },
  {
    icon: "calendar-outline",
    eyebrow: "Your Foundation",
    title: "Schedule keeps your classes fixed and visible",
    message:
      "Your class timetable is the base of the app. It helps you plan around real class hours instead of guessing when you are free.",
    findIt: "Schedule screen",
    bestFor: "Checking today's classes and finding free study gaps",
    tip: "Review your schedule first before adding study sessions.",
    tags: ["Class hours", "Subjects", "Free time"],
    bullets: [
      "Check what subject comes next and when it starts",
      "Use your schedule as the source of truth for study planning",
      "Keep your course, year, and section accurate so the timetable stays correct",
    ],
  },
  {
    icon: "checkmark-done-circle-outline",
    eyebrow: "Daily Execution",
    title: "Task Manager is where deadlines get handled",
    message:
      "Use Task Manager for assignments, quizzes, projects, and exams. It is built for quick capture, fast due-date choices, and finishing work without extra taps.",
    findIt: "Task Manager tab",
    bestFor: "Adding school work quickly and clearing due items",
    tip: "Add the task the moment a teacher gives it. Do not wait until later.",
    tags: ["Quick add", "Due presets", "Snooze", "Complete"],
    bullets: [
      "Create tasks with title, subject, priority, and due date",
      "Use presets when you need today, tomorrow, or this week fast",
      "Mark tasks done or snooze them when the schedule changes",
    ],
  },
  {
    icon: "today-outline",
    eyebrow: "Plan The Work",
    title: "Planner turns free time into a real study plan",
    message:
      "Planner is for deciding when you will work, not just what is due. It helps you place study blocks and daily plans around your actual class schedule.",
    findIt: "Planner tab",
    bestFor: "Building a day plan that matches your available time",
    tip: "Use Planner at the start of the day or the night before.",
    tags: ["Day plan", "Study blocks", "Calendar"],
    bullets: [
      "Create focused study blocks for specific tasks or subjects",
      "Use the selected day view to plan around classes and free time",
      "Planner items can sync into Task Manager so work stays connected",
    ],
  },
{
    icon: "school-outline",
    eyebrow: "Study Deeper",
    title: "Exam Prep spreads review across multiple sessions",
    message:
      "Create exams directly in Exam Prep Planner and auto-generate spaced study sessions. Track progress with visual completion bars and daily session checkoffs.",
    findIt: "Exam Prep Planner tab",
    bestFor: "Preparing for exams, long quizzes, and major requirements",
    tip: "Create exam → Generate plan → Follow daily sessions. Pull to refresh upcoming exams.",
    tags: ["Inline exam create", "Auto-sessions", "Progress tracking"],
    bullets: [
      "Create exams with title/subject/date directly (syncs to Tasks)",
      "Generate optimal study sessions spread before exam day",
      "Track session completion with progress bars and daily highlights",
    ],
  },
  {
    icon: "notifications-outline",
    eyebrow: "Stay On Track",
    title: "Reminders help you miss fewer classes and deadlines",
    message:
      "The app can remind you before classes, task deadlines, and planned study sessions. Use reminders to reduce late work and forgotten activities.",
    findIt: "Notification settings and task/planner items",
    bestFor: "Students who manage many deadlines in one week",
    tip: "Turn on only the reminders you will actually act on.",
    tags: ["Class alerts", "Task alerts", "Planner alerts"],
    bullets: [
      "Keep deadline reminders enabled for high-priority tasks",
      "Use class reminders if you often lose track of time between subjects",
      "Review notification settings so the app stays useful instead of noisy",
    ],
  },
{
    icon: "person-circle-outline",
    eyebrow: "Keep It Accurate",
    title: "Announcements, progress, and profile keep the system useful",
    message:
      "Announcements show unread indicators and target your year/section. Combined with progress tracking and profile accuracy, these keep you informed and data aligned.",
    findIt: "Announcements tab, Home announcements, profile",
    bestFor: "Staying updated and keeping the app accurate over time",
    tip: "Check unread dots in Announcements. Update profile if section/subjects change.",
    tags: ["Unread indicators", "Audience targeting", "Progress"],
    bullets: [
      "See unread announcements with colored dots and 'New' badges",
      "Targeted delivery: All, your year, or your exact section/course",
      "Watch completion progress + update profile for accurate schedules",
    ],
  },
]; 

const ADMIN_SLIDES = [
  {
    icon: "speedometer-outline",
    eyebrow: "Admin Overview",
    title: "Admin Home is your control point",
    message:
      "Use the admin dashboard to monitor what needs maintenance across schedules, announcements, and student-facing academic data.",
    findIt: "Admin home screen",
    bestFor: "Deciding which academic data needs action first",
    tip: "Treat the dashboard as a daily review screen, not just a landing page.",
    tags: ["Overview", "Maintenance", "Priority"],
    bullets: [
      "Check for records or updates that affect many students",
      "Use the dashboard to decide what to update first",
      "Keep high-impact changes visible and timely",
    ],
  },
  {
    icon: "calendar-number-outline",
    eyebrow: "Core Data",
    title: "Schedule management drives the student experience",
    message:
      "Student planning only works when schedules are accurate. Maintain class times carefully so students see the right timetable and can plan around it.",
    findIt: "Admin schedule management",
    bestFor: "Publishing or correcting class schedules by group",
    tip: "Verify course, year, and section before saving timetable changes.",
    tags: ["Timetable", "Sections", "Accuracy"],
    bullets: [
      "Create and update weekly class schedules per group",
      "Correct schedule changes quickly so students can trust the system",
      "Remember that planner quality depends on schedule accuracy",
    ],
  },
  {
    icon: "megaphone-outline",
    eyebrow: "Communication",
    title: "Announcements should be clear and targeted",
    message:
      "Use announcements for information students must act on, such as deadline reminders, room changes, and academic notices.",
    findIt: "Admin announcements",
    bestFor: "Delivering time-sensitive information to the right students",
    tip: "Post short, specific announcements with a clear action or deadline.",
    tags: ["Notices", "Targeting", "Deadlines"],
    bullets: [
      "Send important updates to all students or selected groups",
      "Keep message wording short so students understand the action quickly",
      "Use announcements for changes that affect schedules or deadlines",
    ],
  },
  {
    icon: "people-outline",
    eyebrow: "Data Quality",
    title: "Student records must stay complete and correct",
    message:
      "Incorrect academic records create wrong schedules and weak planning data. Review student information regularly so the student app stays reliable.",
    findIt: "Admin student management",
    bestFor: "Maintaining accurate academic records across the system",
    tip: "Fix record issues before they create schedule or notification problems.",
    tags: ["Student data", "Validation", "Reliability"],
    bullets: [
      "Review student course, year, and section assignments",
      "Correct incomplete or mismatched records early",
      "Keep the system dependable so students can plan with confidence",
    ],
  },
];

function InfoCard({ colors, icon, label, value }) {
  return (
    <View
      style={[
        styles.infoCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.infoIconWrap,
          {
            backgroundColor: `${colors.primary}14`,
          },
        ]}
      >
        <Ionicons name={icon} size={16} color={colors.primary} />
      </View>
      <View style={styles.infoTextWrap}>
        <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function TutorialScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const params = useLocalSearchParams();

  const roleParam = Array.isArray(params?.role) ? params.role[0] : params?.role;
  const role = roleParam === "admin" ? "admin" : "student";
  const slides = useMemo(
    () => (role === "admin" ? ADMIN_SLIDES : STUDENT_SLIDES),
    [role]
  );

  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const activeSlide = slides[index] || slides[0];
  const isLast = index >= slides.length - 1;

  const finishTutorial = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace("/(auth)/login");
      return;
    }
    await markOnboardingCompleted(uid);
    router.replace(getPostOnboardingRoute(role));
  }, [role, router, saving]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Feature Tour
          </Text>
          <Text style={[styles.headerMeta, { color: colors.muted }]}>
            {role === "admin" ? "Admin flow" : "Student flow"} • {index + 1}/
            {slides.length}
          </Text>
        </View>
        <TouchableOpacity onPress={finishTutorial} disabled={saving}>
          <Text style={[styles.skipText, { color: colors.primary }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingBottom: Math.max(20, insets.bottom + 12) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: isDark ? "#1e293b" : "#eaf2ff" },
          ]}
        >
          <Ionicons name={activeSlide.icon} size={34} color={colors.primary} />
        </View>

        <Text style={[styles.eyebrow, { color: colors.primary }]}>
          {activeSlide.eyebrow}
        </Text>
        <Text style={[styles.title, { color: colors.text }]}>
          {activeSlide.title}
        </Text>
        <Text style={[styles.message, { color: colors.muted }]}>
          {activeSlide.message}
        </Text>

        <View style={styles.infoList}>
          <InfoCard
            colors={colors}
            icon="navigate-outline"
            label="Find it"
            value={activeSlide.findIt}
          />
          <InfoCard
            colors={colors}
            icon="flash-outline"
            label="Best for"
            value={activeSlide.bestFor}
          />
        </View>

        <View style={styles.tagRow}>
          {activeSlide.tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.tagChip,
                {
                  backgroundColor: isDark ? "#1e293b" : "#eef4ff",
                  borderColor: isDark ? "#334155" : "#d7e5ff",
                },
              ]}
            >
              <Text style={[styles.tagText, { color: colors.text }]}>{tag}</Text>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            What to do here
          </Text>
          <View style={styles.bulletList}>
            {activeSlide.bullets.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.primary}
                  style={styles.bulletIcon}
                />
                <Text style={[styles.bulletText, { color: colors.text }]}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View
          style={[
            styles.tipCard,
            {
              backgroundColor: isDark ? "#172033" : "#f7fbff",
              borderColor: isDark ? "#334155" : "#d6e6ff",
            },
          ]}
        >
          <View
            style={[
              styles.tipIconWrap,
              {
                backgroundColor: `${colors.primary}18`,
              },
            ]}
          >
            <Ionicons name="bulb-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.tipTextWrap}>
            <Text style={[styles.tipLabel, { color: colors.text }]}>
              Quick tip
            </Text>
            <Text style={[styles.tipText, { color: colors.muted }]}>
              {activeSlide.tip}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: Math.max(18, insets.bottom + 8),
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={styles.dotsRow}>
          {slides.map((slide, slideIndex) => (
            <View
              key={slide.title}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    slideIndex === index
                      ? colors.primary
                      : isDark
                        ? "#334155"
                        : "#cbd5e1",
                  width: slideIndex === index ? 18 : 8,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                opacity: index === 0 || saving ? 0.5 : 1,
              },
            ]}
            onPress={() => setIndex((prev) => Math.max(0, prev - 1))}
            disabled={index === 0 || saving}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.muted }]}>
              Back
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: colors.primary,
                opacity: saving ? 0.75 : 1,
              },
            ]}
            onPress={() => {
              if (isLast) {
                finishTutorial();
                return;
              }
              setIndex((prev) => Math.min(slides.length - 1, prev + 1));
            }}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {isLast ? "Open App" : "Next"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  headerMeta: { fontSize: 12, fontWeight: "600", marginTop: 3 },
  skipText: { fontSize: 13, fontWeight: "700" },
  content: { flex: 1 },
  contentContainer: {
    paddingHorizontal: 18,
    paddingTop: 24,
    gap: 16,
  },
  iconWrap: {
    width: 70,
    height: 70,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  infoList: { gap: 10 },
  infoCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTextWrap: { flex: 1, gap: 2 },
  infoLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  infoValue: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  tagText: { fontSize: 12, fontWeight: "700" },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  bulletList: { gap: 12 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bulletIcon: { marginTop: 1 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  tipCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  tipIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tipTextWrap: { flex: 1, gap: 4 },
  tipLabel: { fontSize: 14, fontWeight: "800" },
  tipText: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  footer: {
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 12,
  },
  dot: { height: 8, borderRadius: 999 },
  actions: { flexDirection: "row", gap: 8 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 13, fontWeight: "700" },
  primaryBtn: {
    flex: 1.3,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
