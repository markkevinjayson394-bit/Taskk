import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, db, isFirebaseConfigured } from "../../config/firebase";
import {
  ACTIVE_UID_KEY,
  getEulaConsentRoute,
  needsEulaConsent,
} from "../../utils/eula";
import {
  getPostOnboardingRoute,
  getTutorialRoute,
  hasCompletedOnboarding,
} from "../../utils/onboarding";
import { clearLocalClassSchedule } from "../../utils/classScheduleCache";

const { height } = Dimensions.get("window");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HERO_POINTS = [
  "Deadline-aware reminders",
  "Class and planner synchronization",
  "Offline-ready student workflow",
];

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Animations  stable refs, never cause re-renders
  const heroAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(40)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const btnScale = useRef(new Animated.Value(1)).current;

  //  TextInput refs for programmatic focus (no state needed)
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(heroAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.spring(formAnim, {
          toValue: 0,
          tension: 60,
          friction: 10,
          useNativeDriver: true,
        }),
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [heroAnim, formAnim, formOpacity]);

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 12,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -12,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 8,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -8,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 55,
        useNativeDriver: true,
      }),
    ]).start();

  const handleLogin = async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      shake();
      Alert.alert("Missing Fields", "Please enter your email and password.");
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      shake();
      Alert.alert("Invalid Email", "Please enter a valid email address.");
      return;
    }
    if (!isFirebaseConfigured || !auth || !db) {
      Alert.alert(
        "Configuration Error",
        "This app build is missing Firebase settings. Please update/reinstall the app or contact support."
      );
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        password
      );
      const uid = cred.user.uid;
      await AsyncStorage.setItem(ACTIVE_UID_KEY, uid);
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) {
        // User document doesn't exist - create basic user data or redirect with error
        Alert.alert(
          "Account Error",
          "Your account data is missing. Please contact support."
        );
        const currentUid = auth.currentUser?.uid;
        if (currentUid) {
          await clearLocalClassSchedule(currentUid);
        }
        await signOut(auth);
        await AsyncStorage.removeItem(ACTIVE_UID_KEY);
        return;
      }

      const userData = snap.data();
      if (needsEulaConsent(userData)) {
        router.replace(getEulaConsentRoute("login"));
        return;
      }

      const role = userData.role === "admin" ? "admin" : "student";
      const completedOnboarding = await hasCompletedOnboarding(uid);
      if (!completedOnboarding) {
        router.replace(getTutorialRoute(role));
        return;
      }
      router.replace(getPostOnboardingRoute(role));
    } catch (err) {
      console.warn("Login failed:", err);
      if (__DEV__) {
        console.error("Full error details:", JSON.stringify(err, null, 2));
      } else {
        console.error("Login error code:", err?.code);
      }
      shake();
      const code = err?.code || "auth/unknown-error";
      const apiKeyErrorCodes = new Set([
        "auth/api-key-not-valid",
        "auth/invalid-api-key",
      ]);
      if (apiKeyErrorCodes.has(code)) {
        Alert.alert(
          "Configuration Error",
          "This app is using an invalid Firebase API key. Please update the app or contact support."
        );
        return;
      }
      if (code === "auth/invalid-email") {
        Alert.alert("Invalid Email", "Please enter a valid email address.");
        return;
      }
      Alert.alert(
        "Login Failed",
        "Incorrect email or password. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a4ecb" />

      {/*
         NO KeyboardAvoidingView  it causes layout reflows on Android
           which the OS misreads as a tap-outside, closing the keyboard.
           ScrollView with keyboardShouldPersistTaps="handled" is enough.
           On iOS, automaticallyAdjustKeyboardInsets handles the scroll-up.
      */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        bounces={false}
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      >
        {/*  HERO  */}
        <Animated.View
          style={[
            styles.hero,
            { opacity: heroAnim, paddingTop: insets.top + 24 },
          ]}
        >
          {/* Decorative rings */}
          <View style={[styles.ring, { width: 280, top: -90, right: -90 }]} />
          <View style={[styles.ring, { width: 180, top: -20, right: 20 }]} />
          <View style={[styles.ring, { width: 120, bottom: 10, left: -30 }]} />

          <View style={styles.logoWrap}>
            <View style={styles.logoInner}>
              <Ionicons name="time" size={34} color="#007bff" />
            </View>
          </View>

          <Text style={styles.appName}>CTU Danao</Text>
          <Text style={styles.appSub}>Academic Task Manager</Text>
          <Text style={styles.heroPitch}>
            A research prototype for helping students organize classes, study
            sessions, and academic deadlines in one place.
          </Text>

          <View style={styles.taglineRow}>
            <View style={styles.taglineLine} />
            <Text style={styles.tagline}>Plan / Study / Succeed</Text>
            <View style={styles.taglineLine} />
          </View>

          <View style={styles.heroPointList}>
            {HERO_POINTS.map((point) => (
              <View key={point} style={styles.heroPointChip}>
                <Ionicons name="checkmark-circle" size={13} color="#bfdbfe" />
                <Text style={styles.heroPointText}>{point}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/*  FORM SHEET  */}
        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: formOpacity,
              transform: [{ translateY: formAnim }, { translateX: shakeAnim }],
            },
          ]}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Welcome back</Text>
          <Text style={styles.sheetSub}>
            Sign in to continue to your planning dashboard
          </Text>

          <View style={styles.proofRow}>
            <View style={styles.proofPill}>
              <Ionicons name="shield-checkmark-outline" size={14} color="#2563eb" />
              <Text style={styles.proofText}>Campus workflow</Text>
            </View>
            <View style={styles.proofPill}>
              <Ionicons name="flash-outline" size={14} color="#2563eb" />
              <Text style={styles.proofText}>Fast reminders</Text>
            </View>
          </View>

          {/*  Email  */}
          <Text style={styles.fieldLabel}>Email Address</Text>
          <View style={styles.inputWrap}>
            <Ionicons
              name="mail-outline"
              size={18}
              color="#94a3b8"
              style={styles.inputIcon}
            />
            <TextInput
              ref={emailRef}
              style={styles.textInput}
              placeholder="yourname@ctu.edu.ph"
              placeholderTextColor="#cbd5e1"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              blurOnSubmit={false}
              //  Move focus to password without closing keyboard
              onSubmitEditing={() => passwordRef.current?.focus()}
              accessibilityLabel="Email address"
              accessibilityHint="Enter your email address"
            />
            {email.length > 3 && email.includes("@") && (
              <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            )}
          </View>

          {/*  Password  */}
          <Text style={styles.fieldLabel}>Password</Text>
          <View style={styles.inputWrap}>
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color="#94a3b8"
              style={styles.inputIcon}
            />
            <TextInput
              ref={passwordRef}
              style={[styles.textInput, { flex: 1 }]}
              placeholder="Enter your password"
              placeholderTextColor="#cbd5e1"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              accessibilityLabel="Password"
              accessibilityHint="Enter your password"
            />
            <TouchableOpacity
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color="#94a3b8"
              />
            </TouchableOpacity>
          </View>

          {/*  Sign In  */}
          <Animated.View
            style={{ transform: [{ scale: btnScale }], marginTop: 8 }}
          >
            <TouchableOpacity
              style={[
                styles.signInBtn,
                !email.trim() && !password && styles.signInBtnDim,
              ]}
              onPress={handleLogin}
              disabled={loading}
              onPressIn={() =>
                Animated.spring(btnScale, {
                  toValue: 0.96,
                  useNativeDriver: true,
                }).start()
              }
              onPressOut={() =>
                Animated.spring(btnScale, {
                  toValue: 1,
                  useNativeDriver: true,
                }).start()
              }
              activeOpacity={1}
              accessibilityLabel="Sign in"
              accessibilityHint="Logs you into the app"
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.signInBtnText}>Sign In</Text>
                  <View style={styles.signInArrow}>
                    <Ionicons name="arrow-forward" size={16} color="#2563eb" />
                  </View>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          {/*  Divider  */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>
              New to CTU Academic Task Manager?
            </Text>
            <View style={styles.dividerLine} />
          </View>

          {/*  Register  */}
          <TouchableOpacity
            style={styles.registerBtn}
            onPress={() => router.push("/(auth)/register")}
            activeOpacity={0.75}
            accessibilityLabel="Create an account"
            accessibilityHint="Goes to the registration screen"
          >
            <Ionicons
              name="person-add-outline"
              size={16}
              color="#2563eb"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.registerBtnText}>Create an Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.eulaLinkBtn}
            onPress={() => router.push("/eula?mode=view")}
            activeOpacity={0.7}
            accessibilityLabel="View terms of use"
            accessibilityHint="Opens the EULA terms"
          >
            <Ionicons
              name="document-text-outline"
              size={14}
              color="#64748b"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.eulaLinkText}>View Terms of Use (EULA)</Text>
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Cebu Technological University - Danao Campus
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a4ecb" },
  scroll: { flexGrow: 1 },

  hero: {
    backgroundColor: "#0a4ecb",
    paddingTop: 64,
    paddingBottom: 40,
    paddingHorizontal: 30,
    overflow: "hidden",
    alignItems: "flex-start",
  },
  ring: {
    position: "absolute",
    // width set inline; height = width via aspectRatio trick below
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  logoInner: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  appName: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  appSub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 10,
  },
  heroPitch: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
    maxWidth: 320,
  },
  taglineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  taglineLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.2)" },
  tagline: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "700",
  },
  heroPointList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  heroPointChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroPointText: {
    color: "#eff6ff",
    fontSize: 11,
    fontWeight: "600",
  },

  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingHorizontal: 28,
    paddingTop: 14,
    paddingBottom: 48,
    minHeight: height * 0.58,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
    alignSelf: "center",
    marginBottom: 26,
  },
  sheetTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  sheetSub: { fontSize: 14, color: "#94a3b8", marginBottom: 28 },
  proofRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 22,
  },
  proofPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
  },
  proofText: {
    color: "#1e3a8a",
    fontSize: 11,
    fontWeight: "700",
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  //  No focus-dependent border color  static styling only
  // This eliminates the re-render  layout shift  keyboard dismiss cycle
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    height: 54,
    marginBottom: 18,
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, fontSize: 15, color: "#0f172a" },

  signInBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    borderRadius: 16,
    height: 56,
    gap: 10,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  signInBtnDim: { backgroundColor: "#3b82f6", shadowOpacity: 0.15 },
  signInBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  signInArrow: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },

  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#f1f5f9" },
  dividerLabel: {
    fontSize: 11,
    color: "#cbd5e1",
    textAlign: "center",
    maxWidth: 160,
  },

  registerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  registerBtnText: { color: "#2563eb", fontSize: 15, fontWeight: "700" },
  eulaLinkBtn: {
    marginTop: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  eulaLinkText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },

  footer: {
    backgroundColor: "#fff",
    paddingVertical: 18,
    alignItems: "center",
  },
  footerText: { fontSize: 11, color: "#cbd5e1" },
});


