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

const EULA_KEY = "eula_accepted_v1";
const EULA_VERSION = "1.0";

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
    body: `By downloading, installing, or using CTU Time Manager (\"the App\"), you agree to be bound by this End User License Agreement (\"EULA\"). If you do not agree to these terms, do not use the App.\n\nThis agreement is between you (\"User\") and the CTU Danao development team (\"Developer\").`,
  },
  {
    title: "2. License Grant",
    body: `The Developer grants you a limited, non-exclusive, non-transferable, revocable license to use the App solely for your personal, non-commercial purposes as a student of Cebu Technological University - Danao Campus.\n\nThis license does not include the right to:\n- Modify, reverse engineer, or decompile the App\n- Distribute or resell the App\n- Use the App for any unlawful purpose`,
  },
  {
    title: "3. Data Collection and Privacy",
    body: `The App collects and stores the following information to provide its services:\n\n- Full name and student ID number\n- Email address\n- Course, year level, and section\n- Academic tasks, assignments, and exam schedules you create\n- App usage patterns for notification purposes\n\nAll data is stored securely using Google Firebase. We do not sell, share, or disclose your personal data to third parties except as required by law.\n\nYou may request deletion of your account and data at any time by contacting the development team.`,
  },
  {
    title: "4. User Responsibilities",
    body: `You agree to:\n\n- Provide accurate information during registration\n- Keep your account credentials confidential\n- Not share your account with other users\n- Use the App only for legitimate academic purposes\n- Not attempt to disrupt or compromise the App's security\n\nYou are solely responsible for all activity that occurs under your account.`,
  },
  {
    title: "5. Academic Integrity",
    body: `CTU Time Manager is designed to help students manage their academic workload. The App does not condone or facilitate academic dishonesty, cheating, plagiarism, or any violation of Cebu Technological University's academic integrity policies.\n\nAny misuse of the App in connection with academic misconduct is solely the responsibility of the User.`,
  },
  {
    title: "6. Notifications",
    body: `The App may send push notifications to your device including:\n\n- Class reminders before scheduled classes\n- Assignment and exam deadline warnings\n- Daily planning and audit reminders\n- Break reminders during extended study sessions\n\nYou may disable notifications at any time through the App's Notification Settings or your device's system settings.`,
  },
  {
    title: "7. Disclaimer of Warranties",
    body: `THE APP IS PROVIDED \"AS IS\" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. THE DEVELOPER DOES NOT WARRANT THAT:\n\n- The App will be error-free or uninterrupted\n- Schedule or announcement data will always be accurate\n- The App will meet your specific requirements\n\nYou use the App at your own risk. Always verify important academic deadlines with official university sources.`,
  },
  {
    title: "8. Limitation of Liability",
    body: `To the maximum extent permitted by law, the Developer shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the App, including but not limited to:\n\n- Missed deadlines or academic consequences\n- Data loss or corruption\n- Unauthorized access to your account\n\nYour sole remedy for dissatisfaction with the App is to stop using it.`,
  },
  {
    title: "9. Changes to This Agreement",
    body: `The Developer reserves the right to modify this EULA at any time. When we make significant changes, you will be notified within the App and asked to review and accept the updated terms before continuing to use the App.\n\nContinued use of the App after changes constitutes acceptance of the new terms.`,
  },
  {
    title: "10. Termination",
    body: `This license is effective until terminated. Your rights under this EULA will terminate automatically if you fail to comply with any of its terms.\n\nThe Developer reserves the right to suspend or terminate your access to the App at any time for violations of this agreement or the university's policies.`,
  },
  {
    title: "11. Governing Law",
    body: `This EULA shall be governed by and construed in accordance with the laws of the Republic of the Philippines. Any disputes arising from this agreement shall be subject to the jurisdiction of the appropriate courts in Cebu, Philippines.`,
  },
  {
    title: "12. Contact",
    body: `If you have questions about this EULA or the App, please contact the development team through the official CTU Danao channels.\n\nLast updated: March 2026\nVersion: ${EULA_VERSION}`,
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
      router.replace(role === "admin" ? "/(admin)/home" : "/(tabs)/home");
    } catch (err) {
      console.warn("Failed to resolve user role after EULA:", err);
      router.replace("/(tabs)/home");
    }
  }, [router]);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(EULA_KEY)
      .then((value) => {
        if (!active) return;

        const alreadyAccepted = value === "accepted";
        setAcceptedAlready(alreadyAccepted);

        if (alreadyAccepted && !viewOnly) {
          navigateAfterEula();
          return;
        }

        if (viewOnly) setHasScrolled(true);
        revealContent();
      })
      .catch((err) => {
        console.warn("Failed to read EULA acceptance from storage:", err);
        if (!active) return;
        if (viewOnly) setHasScrolled(true);
        revealContent();
      });

    let backHandler;
    if (!viewOnly) {
      backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
        Alert.alert(
          "Exit App",
          "You must accept the EULA to use CTU Time Manager. Do you want to exit?",
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
      setAccepting(true);
      await AsyncStorage.setItem(EULA_KEY, "accepted");
      await navigateAfterEula();
    } catch (err) {
      console.warn("Failed to accept EULA:", err);
      setAccepting(false);
      Alert.alert("Error", "Unable to save EULA acceptance. Please try again.");
    }
  };

  const handleDecline = () => {
    Alert.alert(
      "Decline EULA",
      "You must accept the End User License Agreement to use CTU Time Manager. If you decline, you will be returned to login.",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Go to Login",
          style: "destructive",
          onPress: async () => {
            try {
              await signOut(getAuth(app));
            } catch (err) {
              console.warn("Failed to sign out when declining EULA:", err);
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
            Version {EULA_VERSION} - March 2026
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
            you and the CTU Time Manager development team. By using this app,
            you agree to these terms.
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
              By tapping I Agree, you confirm you have read and accept these
              terms.
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
