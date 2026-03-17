import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
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
import { auth, db } from "../../config/firebase";
import {
  COLLEGES,
  getCoursesForCollege,
  normalizeCollege,
  normalizeCourse,
} from "../../constants/academics";

// ─── Step meta ────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, title: "Personal Info", icon: "person-outline" },
  { id: 2, title: "Student ID", icon: "card-outline" },
  { id: 3, title: "College", icon: "school-outline" },
  { id: 4, title: "Course", icon: "book-outline" },
  { id: 5, title: "Academic Info", icon: "calendar-outline" },
  { id: 6, title: "Account Setup", icon: "lock-closed-outline" },
  { id: 7, title: "Confirmation", icon: "checkmark-circle-outline" },
];
const TOTAL_STEPS = STEPS.length;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SCHEDULE = ["Day", "Night"];

// ─── Small reusable pieces ────────────────────────────────────────────────────
function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function InputWrap({ icon, children, error }) {
  return (
    <View style={[styles.inputWrap, error && { borderColor: "#ef4444" }]}>
      <Ionicons
        name={icon}
        size={18}
        color="#94a3b8"
        style={styles.inputIcon}
      />
      {children}
    </View>
  );
}

function OptionGrid({ options, value, onSelect, columns = 2 }) {
  return (
    <View
      style={[
        styles.optionGrid,
        { flexDirection: "row", flexWrap: "wrap", gap: 10 },
      ]}
    >
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
            <Text
              style={[
                styles.optionChipText,
                selected && styles.optionChipTextSelected,
              ]}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Form state
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [college, setCollege] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [section, setSection] = useState("");
  const [schedule, setSchedule] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Animations
  const slideAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / TOTAL_STEPS)).current;

  // Refs
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPassRef = useRef(null);

  // ── Progress bar animation ─────────────────────────────────────────────────
  const animateProgress = (toStep) => {
    Animated.timing(progressAnim, {
      toValue: toStep / TOTAL_STEPS,
      duration: 350,
      useNativeDriver: false,
    }).start();
  };

  // ── Slide transition ───────────────────────────────────────────────────────
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
        toValue: 0,
        tension: 65,
        friction: 10,
        useNativeDriver: true,
      }).start();
    });
  };

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 6,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -6,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    switch (step) {
      case 1:
        if (!firstName.trim()) e.firstName = "Required";
        if (!lastName.trim()) e.lastName = "Required";
        break;
      case 2:
        if (!/^\d{7}$/.test(idNumber.trim()))
          e.idNumber = "Must be exactly 7 digits";
        break;
      case 3:
        if (!college) e.college = "Please select a college";
        break;
      case 4:
        if (!course) e.course = "Please select a course";
        break;
      case 5:
        if (!year) e.year = "Select a year";
        if (!section) e.section = "Select a section";
        if (!schedule) e.schedule = "Select a schedule";
        break;
      case 6:
        if (!email.trim()) e.email = "Required";
        else if (!email.includes("@")) e.email = "Invalid email";
        if (password.length < 8) e.password = "At least 8 characters";
        if (password !== confirmPass) e.confirmPass = "Passwords don't match";
        break;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Next / Back ────────────────────────────────────────────────────────────
  const goNext = () => {
    if (!validate()) {
      shake();
      return;
    }
    const next = step + 1;
    slideTransition("forward", () => setStep(next));
    animateProgress(next);
  };

  const goBack = () => {
    if (step === 1) {
      router.back();
      return;
    }
    const prev = step - 1;
    slideTransition("back", () => setStep(prev));
    animateProgress(prev);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      await setDoc(doc(db, "users", cred.user.uid), {
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        studentInfo: {
          idNumber: idNumber.trim(),
          course: normalizeCourse(course),
          year,
          section,
          semester: "",
          academicYear: "",
          scheduleType: schedule,
          college: normalizeCollege(college),
        },
        email: email.trim().toLowerCase(),
        role: "student",
        createdAt: serverTimestamp(),
      });
      Alert.alert(
        "Account Created! 🎉",
        `Welcome, ${firstName.trim()}! Your account has been registered.`,
        [{ text: "Sign In", onPress: () => router.replace("/(auth)/login") }]
      );
    } catch (err) {
      console.warn("Registration failed:", err);
      console.error("Full error details:", JSON.stringify(err, null, 2));
      const code = err?.code ?? "";
      let msg = "Something went wrong. Please try again.";
      if (code === "auth/email-already-in-use")
        msg = "This email is already registered.";
      if (code === "auth/invalid-email") msg = "Invalid email address.";
      if (code === "auth/weak-password") msg = "Password is too weak.";
      Alert.alert("Registration Failed", msg);
    } finally {
      setLoading(false);
    }
  };

  // ── College change  clear course ──────────────────────────────────────────
  const handleCollegeSelect = (val) => {
    setCollege(val);
    setCourse("");
    setErrors((e) => ({ ...e, college: undefined }));
  };

  // ── Courses list ───────────────────────────────────────────────────────────
  const courseList = college ? getCoursesForCollege(college) : [];

  // ── Confirmation rows ──────────────────────────────────────────────────────
  const confirmRows = [
    { label: "Full Name", value: `${firstName} ${lastName}` },
    { label: "Student ID", value: idNumber },
    { label: "College", value: college },
    { label: "Course", value: course },
    { label: "Year", value: year },
    { label: "Section", value: section },
    { label: "Schedule", value: schedule },
    { label: "Email", value: email },
  ];

  // ── Step content ───────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      // ── Step 1: Personal Info ──────────────────────────────────────────────
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
                onChangeText={(t) => {
                  setFirstName(t);
                  setErrors((e) => ({ ...e, firstName: undefined }));
                }}
                autoCapitalize="words"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => lastNameRef.current?.focus()}
                accessibilityLabel="First name"
                accessibilityHint="Enter your first name"
              />
            </InputWrap>
            {errors.firstName && (
              <Text style={styles.errorText}>{errors.firstName}</Text>
            )}

            <FieldLabel>Last Name</FieldLabel>
            <InputWrap icon="person-outline" error={errors.lastName}>
              <TextInput
                ref={lastNameRef}
                style={styles.textInput}
                placeholder="e.g. Dela Cruz"
                placeholderTextColor="#cbd5e1"
                value={lastName}
                onChangeText={(t) => {
                  setLastName(t);
                  setErrors((e) => ({ ...e, lastName: undefined }));
                }}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={goNext}
                accessibilityLabel="Last name"
                accessibilityHint="Enter your last name"
              />
            </InputWrap>
            {errors.lastName && (
              <Text style={styles.errorText}>{errors.lastName}</Text>
            )}
          </>
        );

      // ── Step 2: Student ID ─────────────────────────────────────────────────
      case 2:
        return (
          <>
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
                onSubmitEditing={goNext}
                accessibilityLabel="Student ID number"
                accessibilityHint="Enter your 7-digit student ID"
              />
              {idNumber.length === 7 && (
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
              )}
            </InputWrap>
            {errors.idNumber ? (
              <Text style={styles.errorText}>{errors.idNumber}</Text>
            ) : (
              <Text style={styles.hintText}>{idNumber.length}/7 digits</Text>
            )}
          </>
        );

      // ── Step 3: College ────────────────────────────────────────────────────
      case 3:
        return (
          <>
            <FieldLabel>Select College</FieldLabel>
            {errors.college && (
              <Text style={[styles.errorText, { marginBottom: 8 }]}>
                {errors.college}
              </Text>
            )}
            <View style={{ gap: 10 }}>
              {COLLEGES.map((c) => {
                const selected = college === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[
                      styles.collegeCard,
                      selected && styles.collegeCardSelected,
                    ]}
                    onPress={() => handleCollegeSelect(c.value)}
                    activeOpacity={0.75}
                  >
                    <View
                      style={[
                        styles.collegeAbbr,
                        selected && styles.collegeAbbrSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.collegeAbbrText,
                          selected && { color: "#fff" },
                        ]}
                      >
                        {c.value}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.collegeLabel,
                        selected && { color: "#007bff", fontWeight: "700" },
                      ]}
                    >
                      {c.label}
                    </Text>
                    {selected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color="#007bff"
                        style={{ marginLeft: "auto" }}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      // ── Step 4: Course ─────────────────────────────────────────────────────
      case 4:
        return (
          <>
            <FieldLabel>Select Course / Program</FieldLabel>
            {errors.course && (
              <Text style={[styles.errorText, { marginBottom: 8 }]}>
                {errors.course}
              </Text>
            )}
            {courseList.length === 0 ? (
              <View style={styles.emptyNotice}>
                <Ionicons
                  name="alert-circle-outline"
                  size={32}
                  color="#94a3b8"
                />
                <Text style={styles.emptyNoticeText}>
                  {college
                    ? "No courses configured for this college."
                    : "Go back and select a college first."}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {courseList.map((c) => {
                  const selected = course === c;
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.courseRow,
                        selected && styles.courseRowSelected,
                      ]}
                      onPress={() => {
                        setCourse(c);
                        setErrors((e) => ({ ...e, course: undefined }));
                      }}
                      activeOpacity={0.75}
                    >
                      <View
                        style={[
                          styles.courseRadio,
                          selected && styles.courseRadioSelected,
                        ]}
                      >
                        {selected && <View style={styles.courseRadioDot} />}
                      </View>
                      <Text
                        style={[
                          styles.courseRowText,
                          selected && { color: "#007bff", fontWeight: "700" },
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        );

      // ── Step 5: Academic Info ──────────────────────────────────────────────
      case 5:
        return (
          <>
            <FieldLabel>Year Level</FieldLabel>
            {errors.year && <Text style={styles.errorText}>{errors.year}</Text>}
            <OptionGrid
              options={YEARS}
              value={year}
              onSelect={(v) => {
                setYear(v);
                setErrors((e) => ({ ...e, year: undefined }));
              }}
              columns={2}
            />

            <FieldLabel style={{ marginTop: 18 }}>Section</FieldLabel>
            {errors.section && (
              <Text style={styles.errorText}>{errors.section}</Text>
            )}
            <OptionGrid
              options={SECTIONS}
              value={section}
              onSelect={(v) => {
                setSection(v);
                setErrors((e) => ({ ...e, section: undefined }));
              }}
              columns={4}
            />

            <FieldLabel style={{ marginTop: 18 }}>Class Schedule</FieldLabel>
            {errors.schedule && (
              <Text style={styles.errorText}>{errors.schedule}</Text>
            )}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
              {SCHEDULE.map((s) => {
                const selected = schedule === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.scheduleCard,
                      selected && styles.scheduleCardSelected,
                      { flex: 1 },
                    ]}
                    onPress={() => {
                      setSchedule(s);
                      setErrors((e) => ({ ...e, schedule: undefined }));
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={s === "Day" ? "sunny-outline" : "moon-outline"}
                      size={22}
                      color={selected ? "#007bff" : "#94a3b8"}
                    />
                    <Text
                      style={[
                        styles.scheduleCardText,
                        selected && { color: "#007bff", fontWeight: "700" },
                      ]}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      // ── Step 6: Account Setup ──────────────────────────────────────────────
      case 6:
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
                onChangeText={(t) => {
                  setEmail(t);
                  setErrors((e) => ({ ...e, email: undefined }));
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordRef.current?.focus()}
                accessibilityLabel="Email address"
                accessibilityHint="Enter your email address"
              />
              {email.length > 3 && email.includes("@") && (
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
              )}
            </InputWrap>
            {errors.email && (
              <Text style={styles.errorText}>{errors.email}</Text>
            )}

            <FieldLabel>Password</FieldLabel>
            <InputWrap icon="lock-closed-outline" error={errors.password}>
              <TextInput
                ref={passwordRef}
                style={[styles.textInput, { flex: 1 }]}
                placeholder="Min. 8 characters"
                placeholderTextColor="#cbd5e1"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setErrors((e) => ({ ...e, password: undefined }));
                }}
                secureTextEntry={!showPass}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => confirmPassRef.current?.focus()}
                accessibilityLabel="Password"
                accessibilityHint="Enter a password with at least 8 characters"
              />
              <TouchableOpacity
                onPress={() => setShowPass((v) => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showPass ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color="#94a3b8"
                />
              </TouchableOpacity>
            </InputWrap>
            {errors.password ? (
              <Text style={styles.errorText}>{errors.password}</Text>
            ) : (
              password.length > 0 && (
                <View style={styles.strengthBar}>
                  {[...Array(4)].map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.strengthSegment,
                        i < Math.min(Math.floor(password.length / 2), 4) &&
                          styles.strengthSegmentActive,
                      ]}
                    />
                  ))}
                  <Text style={styles.strengthLabel}>
                    {password.length < 4
                      ? "Weak"
                      : password.length < 8
                        ? "Fair"
                        : "Strong"}
                  </Text>
                </View>
              )
            )}

            <FieldLabel>Confirm Password</FieldLabel>
            <InputWrap icon="lock-closed-outline" error={errors.confirmPass}>
              <TextInput
                ref={confirmPassRef}
                style={[styles.textInput, { flex: 1 }]}
                placeholder="Re-enter password"
                placeholderTextColor="#cbd5e1"
                value={confirmPass}
                onChangeText={(t) => {
                  setConfirmPass(t);
                  setErrors((e) => ({ ...e, confirmPass: undefined }));
                }}
                secureTextEntry={!showConfirm}
                returnKeyType="done"
                onSubmitEditing={goNext}
                accessibilityLabel="Confirm password"
                accessibilityHint="Re-enter your password to confirm"
              />
              <TouchableOpacity
                onPress={() => setShowConfirm((v) => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showConfirm ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color="#94a3b8"
                />
              </TouchableOpacity>
            </InputWrap>
            {errors.confirmPass ? (
              <Text style={styles.errorText}>{errors.confirmPass}</Text>
            ) : (
              confirmPass.length > 0 &&
              password === confirmPass && (
                <Text style={[styles.hintText, { color: "#22c55e" }]}>
                  ✓ Passwords match
                </Text>
              )
            )}
          </>
        );

      // ── Step 7: Confirmation ───────────────────────────────────────────────
      case 7:
        return (
          <>
            <View style={styles.confirmBanner}>
              <Ionicons name="checkmark-circle" size={40} color="#007bff" />
              <Text style={styles.confirmBannerTitle}>Almost there!</Text>
              <Text style={styles.confirmBannerSub}>
                Please review your information before creating your account.
              </Text>
            </View>
            <View style={styles.confirmCard}>
              {confirmRows.map((row, i) => (
                <View
                  key={row.label}
                  style={[
                    styles.confirmRow,
                    i < confirmRows.length - 1 && styles.confirmRowBorder,
                  ]}
                >
                  <Text style={styles.confirmRowLabel}>{row.label}</Text>
                  <Text
                    style={styles.confirmRowValue}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {row.value || "—"}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.confirmNote}>
              By creating an account you agree to the CTU Danao Time Manager
              Terms of Use.
            </Text>
          </>
        );
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const currentStepMeta = STEPS[step - 1];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0057D9" />

      {/* ── HEADER ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {/* Back button */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={goBack}
          activeOpacity={0.7}
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous step or screen"
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>

        {/* Step counter */}
        <Text style={styles.stepCounter}>
          Step {step} of {TOTAL_STEPS}
        </Text>

        {/* Placeholder */}
        <View style={{ width: 40 }} />
      </View>

      {/* ── PROGRESS BAR ── */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>

      {/* ── HERO LABEL ── */}
      <View style={styles.heroLabel}>
        <View style={styles.stepIconWrap}>
          <Ionicons name={currentStepMeta.icon} size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>{currentStepMeta.title}</Text>
          <Text style={styles.heroSub}>CTU Danao — Create Account</Text>
        </View>
      </View>

      {/* ── FORM SHEET ── */}
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
          <Animated.View
            style={{
              opacity: slideAnim.interpolate({
                inputRange: [-30, 0, 30],
                outputRange: [0, 1, 0],
              }),
              transform: [{ translateX: shakeAnim }, { translateY: slideAnim }],
            }}
          >
            {renderStep()}
          </Animated.View>

          {/* ── Next / Register ── */}
          <View style={styles.footerActions}>
            {step < TOTAL_STEPS ? (
              <TouchableOpacity
                style={styles.nextBtn}
                onPress={goNext}
                activeOpacity={0.85}
                accessibilityLabel="Continue to next step"
                accessibilityHint="Proceeds to the next registration step"
              >
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
                accessibilityHint="Creates your new account"
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="person-add-outline"
                      size={18}
                      color="#fff"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.nextBtnText}>Create Account</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Step dots */}
            <View style={styles.stepDots}>
              {STEPS.map((s) => (
                <View
                  key={s.id}
                  style={[
                    styles.stepDot,
                    step === s.id && styles.stepDotActive,
                    step > s.id && styles.stepDotDone,
                  ]}
                />
              ))}
            </View>

            {/* Login link */}
            <TouchableOpacity
              style={styles.loginLinkBtn}
              onPress={() => router.replace("/(auth)/login")}
              activeOpacity={0.7}
              accessibilityLabel="Sign in to existing account"
              accessibilityHint="Goes to the login screen"
            >
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

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0057D9" },

  // ── Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  stepCounter: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: "600",
  },

  // ── Progress
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginHorizontal: 20,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 20,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 2,
  },

  // ── Hero label
  heroLabel: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 14,
  },
  stepIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  heroTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  heroSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },

  // ── Sheet
  sheet: {
    flex: 1,
    backgroundColor: "#fff",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: "hidden",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
    alignSelf: "center",
    marginTop: 14,
    marginBottom: 6,
  },
  sheetScroll: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },

  // ── Form fields
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 8,
    marginTop: 14,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    height: 54,
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, fontSize: 15, color: "#0f172a" },
  errorText: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
    marginLeft: 4,
  },
  hintText: { color: "#94a3b8", fontSize: 11, marginTop: 4, marginLeft: 4 },

  // ── Password strength
  strengthBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    marginLeft: 4,
  },
  strengthSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
  },
  strengthSegmentActive: { backgroundColor: "#22c55e" },
  strengthLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    marginLeft: 2,
  },

  // ── College cards
  collegeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    gap: 12,
  },
  collegeCardSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  collegeAbbr: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#e2e8f0",
    justifyContent: "center",
    alignItems: "center",
  },
  collegeAbbrSelected: { backgroundColor: "#007bff" },
  collegeAbbrText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.5,
  },
  collegeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    flex: 1,
    flexShrink: 1,
  },

  // ── Course rows
  courseRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    gap: 12,
  },
  courseRowSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  courseRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    justifyContent: "center",
    alignItems: "center",
  },
  courseRadioSelected: { borderColor: "#007bff" },
  courseRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#007bff",
  },
  courseRowText: { fontSize: 14, fontWeight: "600", color: "#334155" },

  // ── Option chips (year / section)
  optionGrid: { marginTop: 4 },
  optionChip: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
  },
  optionChipSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  optionChipText: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  optionChipTextSelected: { color: "#007bff", fontWeight: "800" },

  // ── Schedule cards
  scheduleCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    gap: 8,
  },
  scheduleCardSelected: { borderColor: "#93c5fd", backgroundColor: "#eff6ff" },
  scheduleCardText: { fontSize: 14, fontWeight: "600", color: "#94a3b8" },

  // ── Empty notice
  emptyNotice: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
  },
  emptyNoticeText: { color: "#94a3b8", fontSize: 14, textAlign: "center" },

  // ── Confirmation
  confirmBanner: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 6,
    marginBottom: 16,
  },
  confirmBannerTitle: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  confirmBannerSub: {
    fontSize: 13,
    color: "#64748b",
    textAlign: "center",
    maxWidth: 260,
  },
  confirmCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    overflow: "hidden",
  },
  confirmRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  confirmRowBorder: { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  confirmRowLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  confirmRowValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    maxWidth: "55%",
    textAlign: "right",
  },
  confirmNote: {
    marginTop: 14,
    textAlign: "center",
    fontSize: 11,
    color: "#94a3b8",
    lineHeight: 16,
  },

  // ── Footer actions
  footerActions: { marginTop: 28, gap: 16 },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#007bff",
    borderRadius: 16,
    height: 56,
    shadowColor: "#007bff",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
    gap: 10,
  },
  registerBtn: { backgroundColor: "#0057D9" },
  nextBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  nextArrow: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Step dots
  stepDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#e2e8f0" },
  stepDotActive: {
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#007bff",
  },
  stepDotDone: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#93c5fd",
  },

  // ── Login link
  loginLinkBtn: { alignSelf: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 13, color: "#94a3b8" },
  loginLinkBold: { color: "#007bff", fontWeight: "700" },
});
