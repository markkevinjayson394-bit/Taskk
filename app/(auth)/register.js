import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db, storage } from "../../config/firebase";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const COURSES  = ["BIT CompTech","BIT Drafting","BIT Electronics","BIT Electricity","BSIT","BSMX"];
const SECTIONS = ["A","B","C","D","E","F","G","H","I","J"];
const STEPS = [
  { number: 1, label: "Profile",  color: "#007bff" },
  { number: 2, label: "Academic", color: "#0ea5e9" },
  { number: 3, label: "Security", color: "#10b981" },
];

// ─────────────────────────────────────────────────────────────────────────────
// InputField — NO focus state, static border only
// ─────────────────────────────────────────────────────────────────────────────
function InputField({
  inputRef, label, icon, placeholder, value, onChangeText,
  keyboardType, secureTextEntry, autoCapitalize,
  returnKeyType, onSubmitEditing, blurOnSubmit,
  rightElement, hint, hintColor, maxLength,
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? <Text style={inpSt.label}>{label}</Text> : null}
      <View style={inpSt.wrap}>
        {icon ? <Ionicons name={icon} size={17} color="#94a3b8" style={inpSt.iconStyle} /> : null}
        <TextInput
          ref={inputRef}
          style={inpSt.input}
          placeholder={placeholder}
          placeholderTextColor="#cbd5e1"
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType || "default"}
          secureTextEntry={secureTextEntry || false}
          autoCapitalize={autoCapitalize ?? "sentences"}
          returnKeyType={returnKeyType || "next"}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={blurOnSubmit ?? false}
          maxLength={maxLength}
        />
        {rightElement || null}
      </View>
      {hint ? (
        <Text style={[inpSt.hint, hintColor ? { color: hintColor } : null]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const inpSt = StyleSheet.create({
  label: {
    fontSize: 12, fontWeight: "700", color: "#64748b",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 7,
  },
  wrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#f8fafc", borderRadius: 14,
    borderWidth: 1.5, borderColor: "#e2e8f0",
    paddingHorizontal: 14, height: 52,
  },
  iconStyle: { marginRight: 10 },
  input:     { flex: 1, fontSize: 15, color: "#0f172a" },
  hint:      { fontSize: 11, color: "#94a3b8", marginTop: 4, marginLeft: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// SelectField
// ─────────────────────────────────────────────────────────────────────────────
function SelectField({ label, icon, value, onValueChange, children }) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? <Text style={inpSt.label}>{label}</Text> : null}
      <View style={selSt.wrap}>
        {icon ? <Ionicons name={icon} size={15} color="#94a3b8" style={selSt.iconStyle} /> : null}
        <Picker selectedValue={value} onValueChange={onValueChange} style={selSt.picker}>
          {children}
        </Picker>
      </View>
    </View>
  );
}

const selSt = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#f8fafc", borderRadius: 14,
    borderWidth: 1.5, borderColor: "#e2e8f0",
    paddingLeft: 14, paddingRight: 4, overflow: "hidden",
  },
  iconStyle: { marginRight: 6 },
  picker:    { flex: 1, color: "#0f172a", height: 52 },
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 0 — Profile
// Uses refs to move focus between fields without any state
// ─────────────────────────────────────────────────────────────────────────────
function Step0({ fullName, setFullName, idNumber, setIdNumber, image, onPickImage }) {
  const idRef = useRef(null);

  return (
    <>
      <TouchableOpacity style={styles.avatarWrap} onPress={onPickImage} activeOpacity={0.85}>
        {image ? (
          <Image source={{ uri: image }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatarEmpty}>
            <Ionicons name="camera-outline" size={30} color="#007bff" />
            <Text style={styles.avatarEmptyLabel}>Add Photo</Text>
            <Text style={styles.avatarEmptyHint}>Optional</Text>
          </View>
        )}
        <View style={styles.avatarBadge}>
          <Ionicons name="camera" size={13} color="#fff" />
        </View>
      </TouchableOpacity>

      <InputField
        label="Full Name"
        icon="person-outline"
        placeholder="e.g. Juan dela Cruz"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={() => idRef.current?.focus()}
      />

      <InputField
        inputRef={idRef}
        label="Student ID Number"
        icon="card-outline"
        placeholder="7-digit number e.g. 2400001"
        value={idNumber}
        onChangeText={(text) => {
          const cleaned = text.replace(/[^0-9]/g, "").slice(0, 7);
          setIdNumber(cleaned);
        }}
        keyboardType="number-pad"
        autoCapitalize="none"
        maxLength={7}
        returnKeyType="done"
        blurOnSubmit={true}
        hint={`${idNumber.length}/7 digits`}
        hintColor={idNumber.length === 7 ? "#22c55e" : "#94a3b8"}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Academic (pickers only, no keyboard involved)
// ─────────────────────────────────────────────────────────────────────────────
function Step1({ college, setCollege, course, setCourse, year, setYear,
  sectionLetter, setSectionLetter, scheduleType, setScheduleType }) {
  return (
    <>
      <SelectField label="College" icon="business-outline" value={college} onValueChange={setCollege}>
        <Picker.Item label="Select College" value="" />
        <Picker.Item label="COT — College of Technology" value="COT" />
      </SelectField>

      <SelectField label="Course / Major" icon="school-outline" value={course} onValueChange={setCourse}>
        <Picker.Item label="Select your course" value="" />
        {COURSES.map((c) => <Picker.Item key={c} label={c} value={c} />)}
      </SelectField>

      <View style={styles.rowHalf}>
        <View style={styles.halfLeft}>
          <SelectField label="Year Level" icon="layers-outline" value={year} onValueChange={setYear}>
            <Picker.Item label="Year" value="" />
            <Picker.Item label="Year 1" value="1" />
            <Picker.Item label="Year 2" value="2" />
            <Picker.Item label="Year 3" value="3" />
            <Picker.Item label="Year 4" value="4" />
          </SelectField>
        </View>
        <View style={styles.halfRight}>
          <SelectField label="Section" icon="people-outline" value={sectionLetter} onValueChange={setSectionLetter}>
            <Picker.Item label="Sec" value="" />
            {SECTIONS.map((s) => <Picker.Item key={s} label={s} value={s} />)}
          </SelectField>
        </View>
      </View>

      <SelectField label="Schedule Type" icon="time-outline" value={scheduleType} onValueChange={setScheduleType}>
        <Picker.Item label="Select schedule type" value="" />
        <Picker.Item label="☀️  Day Schedule" value="Day" />
        <Picker.Item label="🌙  Night Schedule" value="Night" />
      </SelectField>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Security
// Uses refs to tab between fields, show/hide pw tracked locally
// ─────────────────────────────────────────────────────────────────────────────
function Step2({
  email, setEmail, password, setPassword,
  confirmPassword, setConfirmPassword,
  fullName, idNumber, course, year, sectionLetter, scheduleType,
}) {
  const pwRef  = useRef(null);
  const cpwRef = useRef(null);

  const [showPw,  setShowPw]  = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  const strength = (() => {
    if (!password) return null;
    if (password.length < 6)  return { label: "Too short", color: "#ef4444", pct: "25%" };
    if (password.length < 8)  return { label: "Fair",      color: "#f59e0b", pct: "55%" };
    if (/[A-Z]/.test(password) && /[0-9]/.test(password))
                               return { label: "Strong",    color: "#22c55e", pct: "100%" };
    return                          { label: "Good",      color: "#0ea5e9", pct: "75%" };
  })();

  const pwMatch    = confirmPassword.length > 0 && password === confirmPassword;
  const pwMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <>
      <InputField
        label="Email Address"
        icon="mail-outline"
        placeholder="yourname@ctu.edu.ph"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={() => pwRef.current?.focus()}
      />

      <InputField
        inputRef={pwRef}
        label="Password"
        icon="lock-closed-outline"
        placeholder="Minimum 6 characters"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPw}
        autoCapitalize="none"
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={() => cpwRef.current?.focus()}
        rightElement={
          <TouchableOpacity
            onPress={() => setShowPw(v => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={17} color="#94a3b8" />
          </TouchableOpacity>
        }
      />

      {strength ? (
        <View style={{ marginTop: -10, marginBottom: 16 }}>
          <View style={styles.strengthTrack}>
            <View style={[styles.strengthFill, { width: strength.pct, backgroundColor: strength.color }]} />
          </View>
          <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
        </View>
      ) : null}

      <InputField
        inputRef={cpwRef}
        label="Confirm Password"
        icon="lock-closed-outline"
        placeholder="Re-enter your password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry={!showCpw}
        autoCapitalize="none"
        returnKeyType="done"
        blurOnSubmit={true}
        rightElement={
          <TouchableOpacity
            onPress={() => setShowCpw(v => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name={showCpw ? "eye-off-outline" : "eye-outline"} size={17} color="#94a3b8" />
          </TouchableOpacity>
        }
      />

      {(pwMatch || pwMismatch) ? (
        <View style={[styles.matchRow, { backgroundColor: pwMatch ? "#f0fdf4" : "#fef2f2" }]}>
          <Ionicons
            name={pwMatch ? "checkmark-circle" : "close-circle"}
            size={15} color={pwMatch ? "#22c55e" : "#ef4444"}
          />
          <Text style={{ fontSize: 12, fontWeight: "600", color: pwMatch ? "#22c55e" : "#ef4444" }}>
            {pwMatch ? "Passwords match ✓" : "Passwords don't match"}
          </Text>
        </View>
      ) : null}

      <View style={styles.reviewCard}>
        <Text style={styles.reviewTitle}>📋 Review your info</Text>
        {[
          { icon: "person",  label: "Name",     value: fullName },
          { icon: "card",    label: "ID",       value: idNumber },
          { icon: "school",  label: "Course",   value: course || "—" },
          { icon: "layers",  label: "Year",     value: year ? `Year ${year} · Sec ${sectionLetter}` : "—" },
          { icon: "time",    label: "Schedule", value: scheduleType || "—" },
        ].map((r) => (
          <View key={r.label} style={styles.reviewRow}>
            <Ionicons name={r.icon} size={13} color="#007bff" />
            <Text style={styles.reviewLabel}>{r.label}</Text>
            <Text style={styles.reviewValue} numberOfLines={1}>{r.value || "—"}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
export default function RegisterScreen() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const stepAnim = useRef(new Animated.Value(0)).current;
  const pageAnim = useRef(new Animated.Value(0)).current;

  const [fullName, setFullName]           = useState("");
  const [idNumber, setIdNumber]           = useState("");
  const [image, setImage]                 = useState(null);
  const [college, setCollege]             = useState("");
  const [course, setCourse]               = useState("");
  const [year, setYear]                   = useState("");
  const [sectionLetter, setSectionLetter] = useState("");
  const [scheduleType, setScheduleType]   = useState("");
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [uploading, setUploading]         = useState(false);

  useEffect(() => {
    Animated.spring(stepAnim, {
      toValue: step, tension: 60, friction: 10, useNativeDriver: false,
    }).start();
  }, [step]);

  const animatePage = (direction, cb) => {
    Animated.sequence([
      Animated.timing(pageAnim, { toValue: direction * 28, duration: 110, useNativeDriver: true }),
      Animated.timing(pageAnim, { toValue: 0,              duration: 180, useNativeDriver: true }),
    ]).start(cb);
  };

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.75,
    });
    if (!result.canceled) setImage(result.assets[0].uri);
  }, []);

  const validate = () => {
    if (step === 0) {
      if (!fullName.trim())      { Alert.alert("Required", "Please enter your full name."); return false; }
      if (!idNumber.trim())      { Alert.alert("Required", "Please enter your ID number."); return false; }
      if (idNumber.length !== 7) { Alert.alert("Invalid ID", "Student ID must be exactly 7 digits."); return false; }
    }
    if (step === 1) {
      if (!college)       { Alert.alert("Required", "Please select your college."); return false; }
      if (!course)        { Alert.alert("Required", "Please select your course."); return false; }
      if (!year)          { Alert.alert("Required", "Please select your year level."); return false; }
      if (!sectionLetter) { Alert.alert("Required", "Please select your section."); return false; }
      if (!scheduleType)  { Alert.alert("Required", "Please select your schedule type."); return false; }
    }
    if (step === 2) {
      if (!email.trim())              { Alert.alert("Required", "Please enter your email address."); return false; }
      if (password.length < 6)        { Alert.alert("Weak Password", "Password must be at least 6 characters."); return false; }
      if (password !== confirmPassword) { Alert.alert("Mismatch", "Passwords do not match."); return false; }
    }
    return true;
  };

  const goNext = () => {
    if (!validate()) return;
    if (step < 2) { animatePage(-1, () => setStep(s => s + 1)); }
    else { handleRegister(); }
  };

  const goBack = () => {
    if (step > 0) { animatePage(1, () => setStep(s => s - 1)); }
    else { router.back(); }
  };

  const handleRegister = async () => {
    try {
      setUploading(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = cred.user;

      let photoURL = "";
      if (image) {
        const resp = await fetch(image);
        const blob = await resp.blob();
        const sRef = ref(storage, `profilePictures/${user.uid}.jpg`);
        await uploadBytes(sRef, blob);
        photoURL = await getDownloadURL(sRef);
      }

      await setDoc(doc(db, "users", user.uid), {
        fullName: fullName.trim(), email: email.trim(),
        role: "student", photoURL: photoURL || null,
        createdAt: new Date(),
        studentInfo: {
          idNumber: idNumber.trim(), college, course, year,
          section: sectionLetter, scheduleType,
        },
      });

      Alert.alert("🎉 Account Created!", "You can now sign in.", [
        { text: "Go to Login", onPress: () => router.replace("/(auth)/login") },
      ]);
    } catch (err) {
      Alert.alert("Registration Failed", err.message);
    } finally {
      setUploading(false);
    }
  };

  const progressWidth = stepAnim.interpolate({
    inputRange: [0, 1, 2], outputRange: ["18%", "55%", "100%"],
  });

  const currentStep = STEPS[step];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0057D9" />

      {/* ── HEADER ── */}
      <View style={[styles.header, { backgroundColor: currentStep.color }]}>
        <View style={[styles.ring, { width: 200, height: 200, top: -70, right: -60 }]} />
        <View style={[styles.ring, { width: 110, height: 110, top: 10,  right: 50  }]} />

        <View style={styles.headerTop}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerStepCount}>Step {step + 1} of {STEPS.length}</Text>
          </View>
          <View style={styles.headerIconBox}>
            <Ionicons name="time" size={18} color={currentStep.color} />
          </View>
        </View>

        <Text style={styles.headerTitle}>Create Account</Text>
        <Text style={styles.headerSub}>
          {step === 0 && "Let's start with your profile"}
          {step === 1 && "Tell us about your program"}
          {step === 2 && "Set up your login credentials"}
        </Text>

        <View style={styles.stepsRow}>
          {STEPS.map((s, i) => {
            const isDone = i < step, isActive = i === step;
            return (
              <View key={s.number} style={styles.stepItem}>
                <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                  {isDone
                    ? <Ionicons name="checkmark" size={11} color={currentStep.color} />
                    : <Text style={[styles.stepNum, isActive && { color: currentStep.color }]}>{s.number}</Text>
                  }
                </View>
                <Text style={[styles.stepName, isActive && { color: "#fff", fontWeight: "700" }]}>{s.label}</Text>
                {i < STEPS.length - 1 && (
                  <View style={[styles.stepConnector, isDone && styles.stepConnectorDone]} />
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
      </View>

      {/* ── FORM ── */}
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      >
        <Animated.View style={{ transform: [{ translateX: pageAnim }] }}>
          {step === 0 && (
            <Step0
              fullName={fullName}   setFullName={setFullName}
              idNumber={idNumber}   setIdNumber={setIdNumber}
              image={image}         onPickImage={pickImage}
            />
          )}
          {step === 1 && (
            <Step1
              college={college}             setCollege={setCollege}
              course={course}               setCourse={setCourse}
              year={year}                   setYear={setYear}
              sectionLetter={sectionLetter} setSectionLetter={setSectionLetter}
              scheduleType={scheduleType}   setScheduleType={setScheduleType}
            />
          )}
          {step === 2 && (
            <Step2
              email={email}                     setEmail={setEmail}
              password={password}               setPassword={setPassword}
              confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              fullName={fullName}   idNumber={idNumber}
              course={course}       year={year}
              sectionLetter={sectionLetter}     scheduleType={scheduleType}
            />
          )}
        </Animated.View>

        {/* Navigation */}
        <View style={styles.btnRow}>
          {step > 0 && (
            <TouchableOpacity style={styles.backPillBtn} onPress={goBack}>
              <Ionicons name="arrow-back" size={16} color="#64748b" />
              <Text style={styles.backPillBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.nextBtn,
              { backgroundColor: currentStep.color },
              uploading && styles.nextBtnDim,
              step === 0 && { flex: 1 },
            ]}
            onPress={goNext}
            disabled={uploading}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>
              {uploading ? "Creating Account..." : step === 2 ? "Create Account" : "Continue"}
            </Text>
            {!uploading && (
              <Ionicons
                name={step === 2 ? "checkmark-circle-outline" : "arrow-forward"}
                size={17} color="#fff"
              />
            )}
          </TouchableOpacity>
        </View>

        {step === 0 && (
          <TouchableOpacity style={styles.loginLink} onPress={() => router.push("/(auth)/login")}>
            <Text style={styles.loginLinkText}>Already have an account? </Text>
            <Text style={[styles.loginLinkText, { color: "#007bff", fontWeight: "700" }]}>Sign In</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },

  header: { paddingTop: 52, paddingHorizontal: 22, paddingBottom: 20, overflow: "hidden" },
  ring:   { position: "absolute", borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center",
  },
  headerCenter:    { flex: 1, alignItems: "center" },
  headerStepCount: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
  headerIconBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#fff",
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 24, fontWeight: "800", marginBottom: 3 },
  headerSub:   { color: "rgba(255,255,255,0.65)", fontSize: 13, marginBottom: 20 },

  stepsRow:     { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  stepItem:     { flexDirection: "row", alignItems: "center", flex: 1 },
  stepCircle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.22)",
    justifyContent: "center", alignItems: "center",
  },
  stepCircleActive: { backgroundColor: "#fff" },
  stepCircleDone:   { backgroundColor: "rgba(255,255,255,0.9)" },
  stepNum:  { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.6)" },
  stepName: { fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: "600", marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.3 },
  stepConnector:     { flex: 1, height: 2, marginHorizontal: 6, backgroundColor: "rgba(255,255,255,0.2)" },
  stepConnectorDone: { backgroundColor: "rgba(255,255,255,0.7)" },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  progressFill:  { height: "100%", borderRadius: 2, backgroundColor: "rgba(255,255,255,0.85)" },

  formScroll:   { flex: 1, backgroundColor: "#fff" },
  formContent:  { padding: 22, paddingTop: 26 },

  rowHalf:  { flexDirection: "row" },
  halfLeft: { flex: 1, marginRight: 8 },
  halfRight:{ flex: 1, marginLeft: 8 },

  avatarWrap: {
    alignSelf: "center", width: 108, height: 108, borderRadius: 54,
    marginBottom: 24, position: "relative",
    shadowColor: "#007bff", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2, shadowRadius: 12, elevation: 5,
  },
  avatarImg: { width: 108, height: 108, borderRadius: 54 },
  avatarEmpty: {
    width: 108, height: 108, borderRadius: 54,
    borderWidth: 2, borderColor: "#007bff", borderStyle: "dashed",
    backgroundColor: "#eff6ff", justifyContent: "center", alignItems: "center", gap: 2,
  },
  avatarEmptyLabel: { fontSize: 12, fontWeight: "700", color: "#007bff" },
  avatarEmptyHint:  { fontSize: 10, color: "#93c5fd" },
  avatarBadge: {
    position: "absolute", bottom: 3, right: 3,
    width: 28, height: 28, borderRadius: 14, backgroundColor: "#007bff",
    justifyContent: "center", alignItems: "center",
    borderWidth: 2.5, borderColor: "#fff",
  },

  strengthTrack: { height: 4, backgroundColor: "#f1f5f9", borderRadius: 2, overflow: "hidden", marginBottom: 4 },
  strengthFill:  { height: "100%", borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontWeight: "600", textAlign: "right" },

  matchRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    padding: 10, borderRadius: 10, marginTop: -6, marginBottom: 14,
  },

  reviewCard: {
    backgroundColor: "#f8fafc", borderRadius: 16,
    padding: 14, marginBottom: 6, borderWidth: 1, borderColor: "#e2e8f0",
  },
  reviewTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a", marginBottom: 12 },
  reviewRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  reviewLabel: { fontSize: 12, color: "#94a3b8", width: 68 },
  reviewValue: { fontSize: 13, fontWeight: "600", color: "#0f172a", flex: 1 },

  btnRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  backPillBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 18, height: 54, borderRadius: 16,
    borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc",
  },
  backPillBtnText: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  nextBtn: {
    flex: 2, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, height: 54, borderRadius: 16,
    shadowColor: "#007bff", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  nextBtnDim:  { opacity: 0.6, shadowOpacity: 0 },
  nextBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  loginLink:     { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  loginLinkText: { fontSize: 14, color: "#94a3b8" },
});