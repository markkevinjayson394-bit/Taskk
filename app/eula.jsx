import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getAuth, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { app, db } from "../config/firebase";
import { useTheme } from "../context/ThemeContext";
import { warnIfDev } from "../utils/logger";
import { clearLocalClassSchedule } from "../utils/classScheduleCache";
import {
  getPostOnboardingRoute,
  getTutorialRoute,
  hasCompletedOnboarding,
} from "../utils/onboarding";

const EULA_KEY = (uid) => `eula_accepted_v1_1_${uid}`;
const ACTIVE_UID_KEY = "active_uid_v1";
const EULA_VERSION = "1.1";
const EULA_LAST_UPDATED = "March 31, 2026";

const FALLBACK_COLORS = {
  background: "#ffffff",
  card: "#f8fafc",
  text: "#0f172a",
  muted: "#94a3b8",
  primary: "#0057D9",
  border: "#e2e8f0",
  success: "#22c55e",
  danger: "#ef4444",
};

const SECTIONS = [
  {
    title: "1. Acceptance of Terms",
    body: `By downloading, installing, accessing, or using CTU Academic Task Manager (\"App\"), you confirm that you have read, understood, and agreed to be bound by this End User License Agreement (\"EULA\"). If you do not agree, do not use the App.\n\nThis EULA is a legal agreement between you (\"User\") and the CTU Academic Task Manager development team (\"Developer\").`,
  },
  {
    title: "2. License Grant",
    body: `Subject to your compliance with this EULA, the Developer grants you a limited, non-exclusive, non-transferable, and revocable license to use the App for your personal, non-commercial academic use as a student of Cebu Technological University - Danao Campus.\n\nThis license does not permit you to:\n- Modify, reverse engineer, decompile, or create derivative works of the App\n- Distribute, sublicense, lease, sell, or otherwise commercialize the App\n- Use the App for unlawful, harmful, or unauthorized purposes`,
  },
  {
    title: "3. Data Collection and Privacy",
    body: `To provide core functionality, the App collects and stores the following data:

- Full name and student ID number
- Email address
- Course, year level, and section
- Academic tasks, assignments, schedules, planner items, and study plans you create
- Notification preferences and reminder settings you configure

Data is stored using Google Firebase services. The App may also store notification preferences, reminder settings, onboarding progress, and EULA acceptance locally on your device so reminders and account flows can work correctly. The Developer does not sell your personal data and will not disclose it to third parties except when required by law or legitimate legal process.

You may request account and data deletion by contacting the development team through official CTU Danao channels.`,
  },
  {
    title: "4. User Responsibilities",
    body: `You agree to:\n\n- Provide complete and accurate registration information\n- Keep your account credentials confidential and secure\n- Not share your account or allow unauthorized access\n- Use the App only for legitimate academic purposes\n- Not interfere with, disrupt, or attempt to bypass the App's security\n\nYou are responsible for all activity under your account.`,
  },
  {
    title: "5. Academic Integrity",
    body: `CTU Academic Task Manager is intended to support academic planning and time management. The App does not condone or facilitate cheating, plagiarism, falsification, or any violation of Cebu Technological University's academic integrity policies.\n\nAny misuse of the App connected to academic misconduct is solely the responsibility of the User.`,
  },
  {
    title: "6. Notifications",
    body: `The App may send local and/or push notifications, including:

- Regular class and schedule reminders
- Countdown reminders for task deadlines and planner items
- Alarm-style task and planner reminders that may require acknowledgment or snooze before they stop repeating
- Daily and weekly planning reminders

Task and planner reminders may display how many days, hours, or minutes remain before a deadline or planned activity. Where supported by your device and operating system, some reminders may use stronger alarm-style behavior such as persistent notifications, vibration, sound, and acknowledge or snooze actions. Notification timing, delivery, sound, vibration, and interruption behavior may still depend on device permissions, battery optimization, exact-alarm capability, Do Not Disturb or Focus mode, network availability, and operating system restrictions. Class reminders may remain standard notifications. You may manage notifications in the App settings or your device system settings.`,
  },
  {
    title: "7. Disclaimer of Warranties",
    body: `THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY. TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE DEVELOPER DISCLAIMS ALL WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

THE DEVELOPER DOES NOT WARRANT THAT:
- The App will be uninterrupted, secure, or error-free
- Academic schedules, reminders, planner entries, or announcements will always be complete, timely, or accurate
- Notifications, alarms, countdowns, or acknowledgment flows will always appear on time or bypass device restrictions
- The App will meet your specific needs

You use the App at your own risk. Always verify important deadlines, schedules, and announcements using official university sources.`,
  },
  {
    title: "8. Limitation of Liability",
    body: `To the maximum extent permitted by law, the Developer is not liable for any indirect, incidental, special, exemplary, or consequential damages arising out of or related to your use of the App, including but not limited to:

- Missed deadlines, reduced grades, or other academic consequences
- Delayed, suppressed, dismissed, or missed notifications or alarms
- Data loss, corruption, or service interruption
- Unauthorized access resulting from compromised credentials or device misuse

Your sole and exclusive remedy for dissatisfaction with the App is to stop using it.`,
  },
  {
    title: "9. Changes to This Agreement",
    body: `The Developer may update this EULA from time to time. If material changes are made, notice will be provided in the App and you may be required to review and accept the updated terms before further use.\n\nIf you do not agree to revised terms, you must stop using the App.`,
  },
  {
    title: "10. Termination",
    body: `This license remains in effect until terminated. Your rights under this EULA automatically terminate if you violate any provision of this agreement.\n\nThe Developer may suspend or terminate access to the App for violations of this EULA, applicable law, or university policies.`,
  },
  {
    title: "11. Governing Law",
    body: `This EULA is governed by the laws of the Republic of the Philippines, without regard to conflict-of-law principles. Any dispute arising out of or related to this EULA shall be subject to the jurisdiction of the appropriate courts in Cebu, Philippines.`,
  },
  {
    title: "12. Contact",
    body: `If you have questions about this EULA or the App, contact the development team through official CTU Danao channels.

Last updated: ${EULA_LAST_UPDATED}
Version: ${EULA_VERSION}`,
  },
];

export default function EulaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const modeParam = Array.isArray(params?.mode) ? params.mode[0] : params?.mode;
  const viewOnly = modeParam === "view";

  const themeContext = useTheme();
  const colors = themeContext?.colors ?? FALLBACK_COLORS;
  const isDark = themeContext?.isDark ?? false;

  const [hasScrolled, setHasScrolled] = useState(false);
  const [acceptedAlready, setAcceptedAlready] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [checking, setChecking] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const revealContent = useCallback(() => {
    setChecking(false);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const closeReadOnlyView = () => {
    if (typeof router?.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(auth)/login");
  };

  const navigateAfterEula = useCallback(async () => {
    const user = getAuth(app).currentUser;
    if (!user) {
      router.replace("/(auth)/login");
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const role = snap.exists() ? snap.data().role : "student";
      const completedOnboarding = await hasCompletedOnboarding(user.uid);
      if (!completedOnboarding) {
        router.replace(getTutorialRoute(role));
        return;
      }
      router.replace(getPostOnboardingRoute(role));
    } catch (err) {
      warnIfDev("Failed to resolve user role after EULA:", err);
      router.replace("/(tabs)/home");
    }
  }, [router]);

  useEffect(() => {
    let active = true;

    const uid = getAuth(app).currentUser?.uid;
    const storageKey = uid ? EULA_KEY(uid) : null;

    const readAcceptance = storageKey
      ? AsyncStorage.getItem(storageKey)
      : Promise.resolve(null);

    readAcceptance
      .then((value) => {
        if (!active) return;

        const alreadyAccepted = value === "accepted";
        setAcceptedAlready(alreadyAccepted);

        if (alreadyAccepted && !viewOnly) {
          setChecking(false);
          navigateAfterEula();
          return;
        }

        if (viewOnly) setHasScrolled(true);
        revealContent();
      })
      .catch((err) => {
        warnIfDev("Failed to read EULA acceptance from storage:", err);
        if (!active) return;
        if (viewOnly) setHasScrolled(true);
        revealContent();
      });

    let backHandler;
    if (!viewOnly) {
      backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
        Alert.alert(
          "Exit App",
          "You must accept the EULA to use CTU Academic Task Manager. Do you want to exit?",
          [
            { text: "Stay", style: "cancel" },
            {
              text: "Exit",
              style: "destructive",
              onPress: () => BackHandler.exitApp(),
            },
          ]
        );
        return true;
      });
    }

    return () => {
      active = false;
      if (backHandler) backHandler.remove();
    };
  }, [navigateAfterEula, revealContent, viewOnly]);

  const handleScroll = (event) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isAtBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isAtBottom) setHasScrolled(true);
  };

  const handleAccept = async () => {
    if (viewOnly) {
      closeReadOnlyView();
      return;
    }

    try {
      const uid = getAuth(app).currentUser?.uid;
      if (!uid) {
        router.replace("/(auth)/login");
        return;
      }
      setAccepting(true);
      await AsyncStorage.setItem(EULA_KEY(uid), "accepted");
      await navigateAfterEula();
    } catch (err) {
      warnIfDev("Failed to accept EULA:", err);
      setAccepting(false);
      Alert.alert("Error", "Unable to save EULA acceptance. Please try again.");
    }
  };

  const handleDecline = () => {
    Alert.alert(
      "Decline EULA",
      "You must accept the End User License Agreement to use CTU Academic Task Manager. If you decline, you will be returned to login.",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Go to Login",
          style: "destructive",
          onPress: async () => {
            try {
              const uid = getAuth(app).currentUser?.uid;
              if (uid) {
                await clearLocalClassSchedule(uid);
              }
              await signOut(getAuth(app));
              await AsyncStorage.removeItem(ACTIVE_UID_KEY);
            } catch (err) {
              warnIfDev("Failed to sign out when declining EULA:", err);
            }
            router.replace("/(auth)/login");
          },
        },
      ]
    );
  };

  if (checking) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.root,
        { backgroundColor: colors.background, opacity: fadeAnim },
      ]}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: isDark ? "#0f172a" : "#0057D9",
            paddingTop: insets.top + 12,
          },
        ]}
      >
        <View style={styles.headerDeco} />
        <View
          style={[
            styles.eulaIconBox,
            { backgroundColor: "rgba(255,255,255,0.15)" },
          ]}
        >
          <Text style={{ fontSize: 14, fontWeight: "800", color: "#fff" }}>
            EULA
          </Text>
        </View>
        <Text style={styles.headerTitle}>Terms of Use</Text>
        <Text style={styles.headerSub}>
          {viewOnly
            ? "Read-only copy of the End User License Agreement"
            : "Please read and accept the End User License Agreement to continue"}
        </Text>
        <View
          style={[
            styles.versionBadge,
            { backgroundColor: "rgba(255,255,255,0.15)" },
          ]}
        >
          <Text style={styles.versionText}>
            {`Version ${EULA_VERSION} - ${EULA_LAST_UPDATED}`}
          </Text>
        </View>
      </View>

      {!viewOnly && !hasScrolled && (
        <View
          style={[
            styles.scrollHint,
            {
              backgroundColor: isDark ? "#1e293b" : "#eff6ff",
              borderColor: "#bfdbfe",
            },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: isDark ? "#93c5fd" : "#1d4ed8",
            }}
          >
            Scroll down
          </Text>
          <Text
            style={[
              styles.scrollHintText,
              { color: isDark ? "#93c5fd" : "#1d4ed8" },
            ]}
          >
            Reach the bottom to enable the Accept button.
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator
      >
        <View
          style={[
            styles.introBox,
            {
              backgroundColor: isDark ? "#1e3a5f" : "#eff6ff",
              borderColor: "#bfdbfe",
            },
          ]}
        >
          <Text
            style={[
              styles.introText,
              { color: isDark ? "#93c5fd" : "#1e40af" },
            ]}
          >
            This End User License Agreement (EULA) is a legal agreement between
            you and the CTU Academic Task Manager development team. By using
            this App, you agree to be legally bound by these terms.
          </Text>
        </View>

        {SECTIONS.map((section, idx) => (
          <View
            key={idx}
            style={[styles.section, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionBody, { color: colors.text }]}>
              {section.body}
            </Text>
          </View>
        ))}

        <View
          style={[
            styles.endMarker,
            {
              backgroundColor: isDark ? "#052e16" : "#f0fdf4",
              borderColor: "#bbf7d0",
            },
          ]}
        >
          <Text
            style={[
              styles.endMarkerText,
              { color: isDark ? "#4ade80" : "#16a34a" },
            ]}
          >
            End of agreement.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(24, insets.bottom + 12),
          },
        ]}
      >
        {viewOnly ? (
          <>
            <Text style={[styles.footerNote, { color: colors.muted }]}>
              {acceptedAlready
                ? "You already accepted this EULA on this device."
                : "This is a read-only EULA view from the login screen."}
            </Text>
            <TouchableOpacity
              style={[styles.acceptBtn, { backgroundColor: "#0057D9" }]}
              onPress={closeReadOnlyView}
            >
              <Text style={styles.acceptBtnText}>Back to Login</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.footerNote, { color: colors.muted }]}>
              By tapping I Agree, you confirm that you have read, understood,
              and accepted this EULA.
            </Text>
            <TouchableOpacity
              style={[
                styles.acceptBtn,
                {
                  backgroundColor: hasScrolled ? "#0057D9" : colors.border,
                  opacity: accepting ? 0.7 : 1,
                },
              ]}
              onPress={handleAccept}
              disabled={!hasScrolled || accepting}
            >
              {accepting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.acceptBtnText}>
                  {hasScrolled
                    ? "I Agree to the Terms"
                    : "Scroll down to enable"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.declineBtn, { borderColor: colors.border }]}
              onPress={handleDecline}
            >
              <Text style={[styles.declineBtnText, { color: colors.muted }]}>
                Decline
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 22,
    alignItems: "center",
    overflow: "hidden",
  },
  headerDeco: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.06)",
    top: -60,
    right: -60,
  },
  eulaIconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
  },
  headerSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 12,
  },
  versionBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  versionText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "600",
  },
  scrollHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  scrollHintText: { fontSize: 12, fontWeight: "600", flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  introBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  introText: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
  section: { paddingVertical: 16, borderBottomWidth: 1 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  sectionBody: { fontSize: 13, lineHeight: 21 },
  endMarker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
  },
  endMarkerText: { fontSize: 13, fontWeight: "700", flex: 1 },
  footer: { padding: 16, borderTopWidth: 1, gap: 10 },
  footerNote: { fontSize: 11, textAlign: "center", lineHeight: 16 },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 15,
    borderRadius: 14,
    elevation: 3,
    shadowColor: "#0057D9",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  acceptBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  declineBtn: {
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  declineBtnText: { fontSize: 14, fontWeight: "600" },
});


