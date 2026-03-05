import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
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
import { auth, db } from "../../config/firebase";

const { height } = Dimensions.get("window");

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Animations — stable refs, never cause re-renders
  const heroAnim    = useRef(new Animated.Value(0)).current;
  const formAnim    = useRef(new Animated.Value(40)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const shakeAnim   = useRef(new Animated.Value(0)).current;
  const btnScale    = useRef(new Animated.Value(1)).current;

  // ✅ TextInput refs for programmatic focus (no state needed)
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(heroAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.parallel([
        Animated.spring(formAnim,    { toValue: 0,   tension: 60, friction: 10, useNativeDriver: true }),
        Animated.timing(formOpacity, { toValue: 1,   duration: 400,             useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue:  12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:   8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:  -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:   0, duration: 55, useNativeDriver: true }),
    ]).start();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      shake();
      Alert.alert("Missing Fields", "Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      if (snap.exists() && snap.data().role === "admin") {
        router.replace("/(admin)/home");
      } else {
        router.replace("/(tabs)/home");
      }
    } catch {
      shake();
      Alert.alert("Login Failed", "Incorrect email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0057D9" />

      {/*
        ✅ NO KeyboardAvoidingView — it causes layout reflows on Android
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
        {/* ── HERO ── */}
        <Animated.View style={[styles.hero, { opacity: heroAnim }]}>
          {/* Decorative rings */}
          <View style={[styles.ring, { width: 280, top: -90, right: -90 }]} />
          <View style={[styles.ring, { width: 180, top: -20, right:  20 }]} />
          <View style={[styles.ring, { width: 120, bottom: 10, left: -30 }]} />

          <View style={styles.logoWrap}>
            <View style={styles.logoInner}>
              <Ionicons name="time" size={34} color="#007bff" />
            </View>
          </View>

          <Text style={styles.appName}>CTU Danao</Text>
          <Text style={styles.appSub}>Time Manager</Text>

          <View style={styles.taglineRow}>
            <View style={styles.taglineLine} />
            <Text style={styles.tagline}>Plan · Study · Succeed</Text>
            <View style={styles.taglineLine} />
          </View>
        </Animated.View>

        {/* ── FORM SHEET ── */}
        <Animated.View style={[styles.sheet, {
          opacity: formOpacity,
          transform: [{ translateY: formAnim }, { translateX: shakeAnim }],
        }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Welcome back 👋</Text>
          <Text style={styles.sheetSub}>Sign in to continue</Text>

          {/* ── Email ── */}
          <Text style={styles.fieldLabel}>Email Address</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
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
              // ✅ Move focus to password without closing keyboard
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            {email.length > 3 && email.includes("@") && (
              <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            )}
          </View>

          {/* ── Password ── */}
          <Text style={styles.fieldLabel}>Password</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
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
            />
            <TouchableOpacity
              onPress={() => setShowPassword(v => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18} color="#94a3b8"
              />
            </TouchableOpacity>
          </View>

          {/* ── Sign In ── */}
          <Animated.View style={{ transform: [{ scale: btnScale }], marginTop: 8 }}>
            <TouchableOpacity
              style={[styles.signInBtn, !email.trim() && !password && styles.signInBtnDim]}
              onPress={handleLogin}
              disabled={loading}
              onPressIn={() => Animated.spring(btnScale, { toValue: 0.96, useNativeDriver: true }).start()}
              onPressOut={() => Animated.spring(btnScale, { toValue: 1, useNativeDriver: true }).start()}
              activeOpacity={1}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Text style={styles.signInBtnText}>Sign In</Text>
                    <View style={styles.signInArrow}>
                      <Ionicons name="arrow-forward" size={16} color="#007bff" />
                    </View>
                  </>
              }
            </TouchableOpacity>
          </Animated.View>

          {/* ── Divider ── */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>New to CTU Danao Time Manager?</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Register ── */}
          <TouchableOpacity
            style={styles.registerBtn}
            onPress={() => router.push("/(auth)/register")}
            activeOpacity={0.75}
          >
            <Ionicons name="person-add-outline" size={16} color="#007bff" style={{ marginRight: 8 }} />
            <Text style={styles.registerBtnText}>Create an Account</Text>
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Cebu Technological University — Danao Campus</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#0057D9" },
  scroll: { flexGrow: 1 },

  hero: {
    backgroundColor: "#0057D9",
    paddingTop: 64, paddingBottom: 44, paddingHorizontal: 30,
    overflow: "hidden", alignItems: "flex-start",
  },
  ring: {
    position: "absolute",
    // width set inline; height = width via aspectRatio trick below
    aspectRatio: 1, borderRadius: 999,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  logoWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center",
    marginBottom: 22,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
  logoInner: {
    width: 58, height: 58, borderRadius: 16, backgroundColor: "#fff",
    justifyContent: "center", alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  appName:    { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -0.8 },
  appSub:     { color: "rgba(255,255,255,0.65)", fontSize: 17, fontWeight: "500", marginBottom: 18 },
  taglineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  taglineLine:{ flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.2)" },
  tagline:    { color: "rgba(255,255,255,0.45)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "600" },

  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 36, borderTopRightRadius: 36,
    paddingHorizontal: 28, paddingTop: 14, paddingBottom: 48,
    minHeight: height * 0.58,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: "#e2e8f0",
    alignSelf: "center", marginBottom: 26,
  },
  sheetTitle: { fontSize: 26, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  sheetSub:   { fontSize: 14, color: "#94a3b8", marginBottom: 28 },

  fieldLabel: {
    fontSize: 12, fontWeight: "700", color: "#64748b",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
  },
  // ✅ No focus-dependent border color — static styling only
  // This eliminates the re-render → layout shift → keyboard dismiss cycle
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#f8fafc", borderRadius: 14,
    borderWidth: 1.5, borderColor: "#e2e8f0",
    paddingHorizontal: 14, height: 54, marginBottom: 18,
  },
  inputIcon:  { marginRight: 10 },
  textInput:  { flex: 1, fontSize: 15, color: "#0f172a" },

  signInBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#007bff", borderRadius: 16, height: 56, gap: 10,
    shadowColor: "#007bff", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  signInBtnDim:  { backgroundColor: "#3b82f6", shadowOpacity: 0.15 },
  signInBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
  signInArrow: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center",
  },

  divider:      { flexDirection: "row", alignItems: "center", marginVertical: 24, gap: 12 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: "#f1f5f9" },
  dividerLabel: { fontSize: 11, color: "#cbd5e1", textAlign: "center", maxWidth: 160 },

  registerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    height: 54, borderRadius: 16, borderWidth: 1.5,
    borderColor: "#bfdbfe", backgroundColor: "#eff6ff",
  },
  registerBtnText: { color: "#007bff", fontSize: 15, fontWeight: "700" },

  footer:     { backgroundColor: "#fff", paddingVertical: 18, alignItems: "center" },
  footerText: { fontSize: 11, color: "#cbd5e1" },
});