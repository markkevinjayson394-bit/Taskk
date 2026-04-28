// app/(auth)/register.js
// CHANGE: Collapsed 7-step registration into 3 steps to reduce drop-off.
//   Step 1 — Personal Info  (name + student ID)
//   Step 2 — Academic Info  (college → course → year → section → schedule)
//   Step 3 — Account Setup  (email + password + review + submit)
// All validation, state, animation, and styles are preserved from the original.

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
  COLLEGES,
  getCoursesForCollege,
  normalizeCollege,
  normalizeCourse,
} from "../../constants/academics";

// ─── Step meta (3 steps instead of 7) ──────────────────────────────────────
const STEPS = [
  { id: 1, title: "Personal Info",   icon: "person-outline" },
  { id: 2, title: "Academic Info",   icon: "school-outline" },
  { id: 3, title: "Account Setup",   icon: "lock-closed-outline" },
];
const TOTAL_STEPS = STEPS.length;

// ─── Helpers ────────────────────────────────────────────────────────────────
const YEARS    = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SCHEDULE = ["Day", "Night"];
const ACTIVE_UID_KEY = "active_uid_v1";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function InputWrap({ icon, children, error }) {
  return (
    <View style={[styles.inputWrap, error && { borderColor: "#ef4444" }]}>
      <Ionicons name={icon} size={18} color="#94a3b8" style={styles.inputIcon} />
      {children}
    </View>
  );
}

function OptionGrid({ options, value, onSelect, columns = 2 }) {
  return (
    <View style={[styles.optionGrid, { flexDirection: "row", flexWrap: "wrap", gap: 10 }]}>
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[
              styles.optionChip,
              { width: columns === 2 ? "47%" : "30%" },
              selected && styles.optionChipSelected,
            ]}
            onPress={() => onSelect(opt)}
            activeOpacity={0.75}
          >
            <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const normalizeYearValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits || raw;
};

// ─── Main component ──────────────────────────────────────────────────────────
export default function RegisterScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  // Form state
  const [step, setStep]             = useState(1);
  const [firstName, setFirstName]   = useState("");
  const [lastName, setLastName]     = useState("");
  const [idNumber, setIdNumber]     = useState("");
  const [college, setCollege]       = useState("");
  const [course, setCourse]         = useState("");
  const [year, setYear]             = useState("");
  const [section, setSection]       = useState("");
  const [schedule, setSchedule]     = useState("");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [errors, setErrors]         = useState({});

  // Animations
  const slideAnim    = useRef(new Animated.Value(0)).current;
  const shakeAnim    = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / TOTAL_STEPS)).current;

  const lastNameRef  = useRef(null);
  const emailRef     = useRef(null);
  const passwordRef  = useRef(null);
  const confirmRef   = useRef(null);

  // ─── Animation helpers ────────────────────────────────────────────────────
  const animateProgress = (toStep) => {
    Animated.timing(progressAnim, {
      toValue: toStep / TOTAL_STEPS,
      duration: 350,
      useNativeDriver: false,
    }).start();
  };

  const slideTransition = (direction, cb) => {
    Animated.sequence([
      Animated.timing(slideAnim, {
        toValue: direction === "forward" ? -30 : 30,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      cb();
      slideAnim.setValue(direction === "forward" ? 30 : -30);
      Animated.spring(slideAnim, {
        toValue: 0, tension: 65, friction: 10, useNativeDriver: true,
      }).start();
    });
  };

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 50, useNativeDriver: true }),
    ]).start();

  // ─── Validation ───────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    const normalizedEmail = normalizeEmail(email);
    if (step === 1) {
      if (!firstName.trim())              e.firstName = "Required";
      if (!lastName.trim())               e.lastName  = "Required";
      if (!/^\d{7}$/.test(idNumber.trim())) e.idNumber = "Must be a 7-digit ID";
    }
    if (step === 2) {
      if (!college)                       e.college  = "Please select a college";
      if (!course)                        e.course   = "Please select a course";
      if (!year)                          e.year     = "Select a year";
      if (!section)                       e.section  = "Select a section";
      if (!schedule)                      e.schedule = "Select Day or Night";
    }
    if (step === 3) {
      if (!normalizedEmail)               e.email    = "Required";
      else if (!EMAIL_PATTERN.test(normalizedEmail)) e.email = "Invalid email";
      if (!password)                      e.password = "Required";
      else if (password.length < 6)       e.password = "Minimum 6 characters";
      if (password !== confirmPass)       e.confirmPass = "Passwords do not match";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => {
    if (!validate()) { shake(); return; }
    const next = step + 1;
    slideTransition("forward", () => setStep(next));
    animateProgress(next);
  };

  const goBack = () => {
    if (step === 1) { router.back(); return; }
    const prev = step - 1;
    slideTransition("back", () => setStep(prev));
    animateProgress(prev);
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!validate()) { shake(); return; }
    const normalizedEmail = normalizeEmail(email);
    if (!isFirebaseConfigured || !auth || !db) {
      Alert.alert(
        "Configuration Error",
        "This app build is missing Firebase settings. Please update/reinstall the app or contact support."
      );
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password
      );
      // New registrations are always students; role is written explicitly so the
      // document is self-contained and login.jsx doesn't need a fallback default.
      await setDoc(doc(db, "users", cred.user.uid), {
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        role: "student",
        studentInfo: {
          idNumber:     idNumber.trim(),
          course:       normalizeCourse(course),
          year:         normalizeYearValue(year),
          section,
          scheduleType: schedule,
          college:      normalizeCollege(college),
        },
      }, { merge: true });
      await AsyncStorage.setItem(ACTIVE_UID_KEY, cred.user.uid);
      Alert.alert(
        "Account Created!",
        `Welcome, ${firstName.trim()}! Please review the terms to continue.`,
        [{ text: "Continue", onPress: () => router.replace("/eula?mode=consent&source=register") }]
      );
    } catch (err) {
      const code = err?.code ?? "";
      let msg = "Something went wrong. Please try again.";
      if (code === "auth/email-already-in-use") msg = "This email is already registered.";
      if (code === "auth/invalid-email")        msg = "Invalid email address.";
      if (code === "auth/weak-password")        msg = "Password is too weak.";
      Alert.alert("Registration Failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCollegeSelect = (val) => {
    setCollege(val);
    setCourse("");
    setErrors((e) => ({ ...e, college: undefined }));
  };

  const courseList = college ? getCoursesForCollege(college) : [];

  // ─── Step content ─────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {

      // Step 1 — Personal Info: name + student ID
      case 1:
        return (
          <>
            <FieldLabel>First Name</FieldLabel>
            <InputWrap icon="person-outline" error={errors.firstName}>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Juan"
                placeholderTextColor="#cbd5e1"
                value={firstName}
                onChangeText={(t) => { setFirstName(t); setErrors((e) => ({ ...e, firstName: undefined })); }}
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => lastNameRef.current?.focus()}
                blurOnSubmit={false}
              />
            </InputWrap>
            {errors.firstName && <Text style={styles.errorText}>{errors.firstName}</Text>}

            <FieldLabel>Last Name</FieldLabel>
            <InputWrap icon="person-outline" error={errors.lastName}>
              <TextInput
                ref={lastNameRef}
                style={styles.textInput}
                placeholder="e.g. Dela Cruz"
                placeholderTextColor="#cbd5e1"
                value={lastName}
                onChangeText={(t) => { setLastName(t); setErrors((e) => ({ ...e, lastName: undefined })); }}
                autoCapitalize="words"
                returnKeyType="next"
                blurOnSubmit={false}
              />
            </InputWrap>
            {errors.lastName && <Text style={styles.errorText}>{errors.lastName}</Text>}

            <FieldLabel>Student ID Number</FieldLabel>
            <InputWrap icon="card-outline" error={errors.idNumber}>
              <TextInput
                style={styles.textInput}
                placeholder="7-digit ID (e.g. 2300001)"
                placeholderTextColor="#cbd5e1"
                value={idNumber}
                onChangeText={(t) => {
                  if (/^\d{0,7}$/.test(t)) {
                    setIdNumber(t);
                    setErrors((e) => ({ ...e, idNumber: undefined }));
                  }
                }}
                keyboardType="number-pad"
                maxLength={7}
                returnKeyType="done"
              />
            </InputWrap>
            {errors.idNumber
              ? <Text style={styles.errorText}>{errors.idNumber}</Text>
              : <Text style={styles.hintText}>Your official CTU Danao student ID</Text>}
          </>
        );

      // Step 2 — Academic Info: college → course → year → section → schedule
      case 2:
        return (
          <>
            <FieldLabel>Select College</FieldLabel>
            {errors.college && <Text style={[styles.errorText, { marginBottom: 8 }]}>{errors.college}</Text>}
            <View style={{ gap: 10 }}>
              {COLLEGES.map((c) => {
                const selected = college === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.collegeCard, selected && styles.collegeCardSelected]}
                    onPress={() => handleCollegeSelect(c.value)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.collegeAbbr, selected && styles.collegeAbbrSelected]}>
                      <Text style={[styles.collegeAbbrText, selected && { color: "#fff" }]}>{c.value}</Text>
                    </View>
                    <Text style={[styles.collegeLabel, selected && { color: "#007bff", fontWeight: "700" }]}>
                      {c.label}
                    </Text>
                    {selected && <Ionicons name="checkmark-circle" size={20} color="#007bff" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {college ? (
              <>
                <FieldLabel>Select Course / Program</FieldLabel>
                {errors.course && <Text style={[styles.errorText, { marginBottom: 8 }]}>{errors.course}</Text>}
                {courseList.length === 0 ? (
                  <View style={styles.emptyNotice}>
                    <Ionicons name="alert-circle-outline" size={32} color="#94a3b8" />
                    <Text style={styles.emptyNoticeText}>No courses available for this college yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {courseList.map((c) => {
                      const sel = course === c;
                      return (
                        <TouchableOpacity
                          key={c}
                          style={[styles.courseRow, sel && styles.courseRowSelected]}
                          onPress={() => { setCourse(c); setErrors((e) => ({ ...e, course: undefined })); }}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.courseRadio, sel && styles.courseRadioSelected]}>
                            {sel && <View style={styles.courseRadioDot} />}
                          </View>
                          <Text style={[styles.courseRowText, sel && { color: "#007bff" }]}>{c}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            ) : null}

            <FieldLabel>Year Level</FieldLabel>
            {errors.year && <Text style={styles.errorText}>{errors.year}</Text>}
            <OptionGrid options={YEARS} value={year} onSelect={(v) => { setYear(v); setErrors((e) => ({ ...e, year: undefined })); }} columns={2} />

            <FieldLabel style={{ marginTop: 18 }}>Section</FieldLabel>
            {errors.section && <Text style={styles.errorText}>{errors.section}</Text>}
            <OptionGrid options={SECTIONS} value={section} onSelect={(v) => { setSection(v); setErrors((e) => ({ ...e, section: undefined })); }} columns={4} />

            <FieldLabel style={{ marginTop: 18 }}>Schedule Type</FieldLabel>
            {errors.schedule && <Text style={styles.errorText}>{errors.schedule}</Text>}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
              {SCHEDULE.map((s) => {
                const sel = schedule === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.scheduleCard, { flex: 1 }, sel && styles.scheduleCardSelected]}
                    onPress={() => { setSchedule(s); setErrors((e) => ({ ...e, schedule: undefined })); }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={s === "Day" ? "sunny-outline" : "moon-outline"} size={24} color={sel ? "#007bff" : "#94a3b8"} />
                    <Text style={[styles.scheduleCardText, sel && { color: "#007bff", fontWeight: "700" }]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      // Step 3 — Account Setup + confirmation summary
      case 3:
        return (
          <>
            <FieldLabel>Email Address</FieldLabel>
            <InputWrap icon="mail-outline" error={errors.email}>
              <TextInput
                ref={emailRef}
                style={styles.textInput}
                placeholder="yourname@ctu.edu.ph"
                placeholderTextColor="#cbd5e1"
                value={email}
                onChangeText={(t) => { setEmail(t); setErrors((e) => ({ ...e, email: undefined })); }}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
              />
            </InputWrap>
            {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}

            <FieldLabel>Password</FieldLabel>
            <InputWrap icon="lock-closed-outline" error={errors.password}>
              <TextInput
                ref={passwordRef}
                style={styles.textInput}
                placeholder="Minimum 6 characters"
                placeholderTextColor="#cbd5e1"
                value={password}
                onChangeText={(t) => { setPassword(t); setErrors((e) => ({ ...e, password: undefined })); }}
                secureTextEntry={!showPass}
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                blurOnSubmit={false}
              />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)}>
                <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </InputWrap>
            {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}

            <FieldLabel>Confirm Password</FieldLabel>
            <InputWrap icon="lock-closed-outline" error={errors.confirmPass}>
              <TextInput
                ref={confirmRef}
                style={styles.textInput}
                placeholder="Re-enter password"
                placeholderTextColor="#cbd5e1"
                value={confirmPass}
                onChangeText={(t) => { setConfirmPass(t); setErrors((e) => ({ ...e, confirmPass: undefined })); }}
                secureTextEntry={!showConfirm}
                returnKeyType="done"
              />
              <TouchableOpacity onPress={() => setShowConfirm((v) => !v)}>
                <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </InputWrap>
            {errors.confirmPass && <Text style={styles.errorText}>{errors.confirmPass}</Text>}

            {/* Review summary */}
            <View style={[styles.confirmBanner, { marginTop: 24 }]}>
              <Ionicons name="checkmark-circle" size={40} color="#007bff" />
              <Text style={styles.confirmBannerTitle}>Almost there!</Text>
              <Text style={styles.confirmBannerSub}>Review your info before creating your account.</Text>
            </View>
            <View style={styles.confirmCard}>
              {[
                { label: "Full Name", value: `${firstName} ${lastName}` },
                { label: "Student ID", value: idNumber },
                { label: "College",   value: college },
                { label: "Course",    value: course },
                { label: "Year",      value: year },
                { label: "Section",   value: section },
                { label: "Schedule",  value: schedule },
              ].map((row, i, arr) => (
                <View key={row.label} style={[styles.confirmRow, i < arr.length - 1 && styles.confirmRowBorder]}>
                  <Text style={styles.confirmRowLabel}>{row.label}</Text>
                  <Text style={styles.confirmRowValue} numberOfLines={1}>{row.value}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.confirmNote}>
              By creating an account you agree to the CTU Danao Terms of Service and Privacy Policy.
            </Text>
          </>
        );
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const currentStepMeta = STEPS[step - 1];
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0057D9" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.7}
          accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.stepCounter}>Step {step} of {TOTAL_STEPS}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[styles.progressFill, {
            width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          }]}
        />
      </View>

      {/* Hero label */}
      <View style={styles.heroLabel}>
        <View style={styles.stepIconWrap}>
          <Ionicons name={currentStepMeta.icon} size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>{currentStepMeta.title}</Text>
          <Text style={styles.heroSub}>CTU Danao · Create Account</Text>
        </View>
      </View>

      {/* Form sheet */}
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          bounces={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          contentContainerStyle={styles.sheetScroll}
        >
          <Animated.View style={{
            opacity: slideAnim.interpolate({ inputRange: [-30, 0, 30], outputRange: [0, 1, 0] }),
            transform: [{ translateX: shakeAnim }, { translateY: slideAnim }],
          }}>
            {renderStep()}
          </Animated.View>

          {/* Actions */}
          <View style={styles.footerActions}>
            {step < TOTAL_STEPS ? (
              <TouchableOpacity style={styles.nextBtn} onPress={goNext} activeOpacity={0.85}
                accessibilityLabel="Continue to next step">
                <Text style={styles.nextBtnText}>Continue</Text>
                <View style={styles.nextArrow}>
                  <Ionicons name="arrow-forward" size={16} color="#007bff" />
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.nextBtn, styles.registerBtn]}
                onPress={handleRegister}
                disabled={loading}
                activeOpacity={0.85}
                accessibilityLabel="Create account"
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="person-add-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.nextBtnText}>Create Account</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Step dots */}
            <View style={styles.stepDots}>
              {STEPS.map((s) => (
                <View key={s.id} style={[
                  styles.stepDot,
                  step === s.id && styles.stepDotActive,
                  step > s.id  && styles.stepDotDone,
                ]} />
              ))}
            </View>

            <TouchableOpacity style={styles.loginLinkBtn}
              onPress={() => router.replace("/(auth)/login")} activeOpacity={0.7}>
              <Text style={styles.loginLinkText}>
                Already have an account?{" "}
                <Text style={styles.loginLinkBold}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Styles (unchanged from original) ───────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0057D9" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.15)", justifyContent: "center", alignItems: "center" },
  stepCounter: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "600" },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: 20, borderRadius: 2, overflow: "hidden", marginBottom: 20 },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  heroLabel: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingBottom: 24, gap: 14 },
  stepIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  heroSub: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "500", marginTop: 2 },
  sheet: { flex: 1, backgroundColor: "#fff", borderTopLeftRadius: 36, borderTopRightRadius: 36, overflow: "hidden" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e2e8f0", alignSelf: "center", marginTop: 14, marginBottom: 6 },
  sheetScroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, flexGrow: 1 },
  fieldLabel: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8, marginTop: 14 },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderRadius: 14, borderWidth: 1.5, borderColor: "#e2e8f0", paddingHorizontal: 14, height: 54 },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, fontSize: 15, color: "#0f172a" },
  errorText: { color: "#ef4444", fontSize: 11, fontWeight: "600", marginTop: 4, marginLeft: 4 },
  hintText: { color: "#94a3b8", fontSize: 11, marginTop: 4, marginLeft: 4 },
  collegeCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", gap: 12 },
  collegeCardSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  collegeAbbr: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#e2e8f0", justifyContent: "center", alignItems: "center" },
  collegeAbbrSelected: { backgroundColor: "#007bff" },
  collegeAbbrText: { fontSize: 12, fontWeight: "800", color: "#64748b", letterSpacing: 0.5 },
  collegeLabel: { fontSize: 14, fontWeight: "600", color: "#334155", flex: 1, flexShrink: 1 },
  courseRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", gap: 12 },
  courseRowSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  courseRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#cbd5e1", justifyContent: "center", alignItems: "center" },
  courseRadioSelected: { borderColor: "#007bff" },
  courseRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#007bff" },
  courseRowText: { fontSize: 14, fontWeight: "600", color: "#334155" },
  optionGrid: { marginTop: 4 },
  optionChip: { paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", alignItems: "center" },
  optionChipSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  optionChipText: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  optionChipTextSelected: { color: "#007bff", fontWeight: "800" },
  scheduleCard: { padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", alignItems: "center", gap: 8 },
  scheduleCardSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  scheduleCardText: { fontSize: 14, fontWeight: "600", color: "#94a3b8" },
  emptyNotice: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptyNoticeText: { color: "#94a3b8", fontSize: 14, textAlign: "center" },
  confirmBanner: { alignItems: "center", paddingVertical: 16, gap: 6, marginBottom: 16 },
  confirmBannerTitle: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  confirmBannerSub: { fontSize: 13, color: "#64748b", textAlign: "center", maxWidth: 260 },
  confirmCard: { borderRadius: 18, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", overflow: "hidden" },
  confirmRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13 },
  confirmRowBorder: { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  confirmRowLabel: { fontSize: 12, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 },
  confirmRowValue: { fontSize: 14, fontWeight: "600", color: "#0f172a", maxWidth: "55%", textAlign: "right" },
  confirmNote: { marginTop: 14, textAlign: "center", fontSize: 11, color: "#94a3b8", lineHeight: 16 },
  footerActions: { marginTop: 28, gap: 16 },
  nextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#007bff", borderRadius: 16, height: 56, shadowColor: "#007bff", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8, gap: 10 },
  registerBtn: { backgroundColor: "#0057D9" },
  nextBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
  nextArrow: { width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)", justifyContent: "center", alignItems: "center" },
  stepDots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#e2e8f0" },
  stepDotActive: { width: 20, height: 6, borderRadius: 3, backgroundColor: "#007bff" },
  stepDotDone: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#93c5fd" },
  loginLinkBtn: { alignSelf: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 13, color: "#94a3b8" },
  loginLinkBold: { color: "#007bff", fontWeight: "700" },
});

