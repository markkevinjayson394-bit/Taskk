import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getApps, initializeApp } from "firebase/app";
import { getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  COLLEGES,
  getCollegeLabel,
  getCoursesForCollege,
} from "../constants/academics";
import { useTheme } from "../context/ThemeContext";

// ─── Firebase Configuration ────────────────────────────────────────────────

const firebaseConfig = Constants.expoConfig?.extra?.firebase || {};

// Initialize Firebase only if config exists and no app is already initialized
let app;
if (firebaseConfig.apiKey && getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else if (getApps().length > 0) {
  app = getApps()[0];
} else {
  console.error("Firebase config is missing or invalid:", firebaseConfig);
}

const auth = app
  ? initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    })
  : null;
const db = app ? getFirestore(app) : null;

if (!auth) {
  console.error(
    "Firebase Auth not initialized. Check your Firebase configuration."
  );
}
if (!db) {
  console.error(
    "Firebase Firestore not initialized. Check your Firebase configuration."
  );
}

export { app, auth, db };

// ─── Data ────────────────────────────────────────────────────────────────────

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"];
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOURS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MINUTES = [
  "00",
  "05",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
];
const PERIODS = ["AM", "PM"];

const COLLEGE_COLORS = {
  CED: { bg: "#D1FAE5", text: "#065F46", dot: "#10B981" },
  COE: { bg: "#DBEAFE", text: "#1E40AF", dot: "#3B82F6" },
  COT: { bg: "#EDE9FE", text: "#4C1D95", dot: "#8B5CF6" },
  CME: { bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  CENG: { bg: "#DBEAFE", text: "#1E40AF", dot: "#3B82F6" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const timeToMinutes = ({ hour, minute, period }) => {
  let h = parseInt(hour);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + parseInt(minute);
};

const formatTime = ({ hour, minute, period }) => `${hour}:${minute} ${period}`;
const defaultStart = () => ({ hour: "7", minute: "00", period: "AM" });
const defaultEnd = () => ({ hour: "8", minute: "00", period: "AM" });
const blankSchedule = () => DAYS.map(() => []);

// ─── InputField (copied from RegisterScreen) ─────────────────────────────────

function InputField({
  inputRef,
  label,
  icon,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  rightElement,
  hint,
  hintColor,
  maxLength,
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? <Text style={inpSt.label}>{label}</Text> : null}
      <View style={inpSt.wrap}>
        {icon ? (
          <Ionicons
            name={icon}
            size={17}
            color="#94a3b8"
            style={inpSt.iconStyle}
          />
        ) : null}
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
        <Text style={[inpSt.hint, hintColor ? { color: hintColor } : null]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const inpSt = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 7,
  },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    height: 52,
  },
  iconStyle: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: "#0f172a" },
  hint: { fontSize: 11, color: "#94a3b8", marginTop: 4, marginLeft: 2 },
});

// ─── Drum-Roll Picker Column ──────────────────────────────────────────────────

const ITEM_H = 44;
const VISIBLE = 5;
const PICKER_H = ITEM_H * VISIBLE;

function DrumColumn({ items, selected, onChange }) {
  const { colors } = useTheme();
  const ref = useRef(null);
  const idx = items.indexOf(String(selected));

  const onEnd = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    const c = Math.max(0, Math.min(i, items.length - 1));
    onChange(items[c]);
  };

  const onTap = (item, i) => {
    onChange(item);
    ref.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <View style={{ flex: 1, height: PICKER_H }}>
      <View
        style={[drum.selector, { backgroundColor: colors.primary + "20" }]}
        pointerEvents="none"
      />
      <FlatList
        ref={ref}
        data={items}
        keyExtractor={(x) => x}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={onEnd}
        initialScrollIndex={Math.max(0, idx)}
        getItemLayout={(_, i) => ({
          length: ITEM_H,
          offset: ITEM_H * i,
          index: i,
        })}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            onPress={() => onTap(item, index)}
            style={drum.item}
          >
            <Text
              style={[
                drum.txt,
                { color: colors.muted },
                item === String(selected) && drum.sel,
                item === String(selected) && { color: colors.text },
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

// ─── TimePicker – styled to match InputField card look ───────────────────────

function TimePicker({ label, value, onChange }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      {/* Label matches InputField label exactly */}
      <Text style={inpSt.label}>{label}</Text>

      {/* Drum-roll container shares InputField border/bg tokens */}
      <View
        style={[
          drum.wrap,
          {
            backgroundColor: "#f8fafc",
            borderColor: "#e2e8f0",
            borderWidth: 1.5,
            borderRadius: 14,
          },
        ]}
      >
        <DrumColumn
          items={HOURS}
          selected={value.hour}
          onChange={(h) => onChange({ ...value, hour: h })}
        />
        <Text style={[drum.colon, { color: colors.text }]}>:</Text>
        <DrumColumn
          items={MINUTES}
          selected={value.minute}
          onChange={(m) => onChange({ ...value, minute: m })}
        />
        <DrumColumn
          items={PERIODS}
          selected={value.period}
          onChange={(p) => onChange({ ...value, period: p })}
        />
      </View>
    </View>
  );
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────

function BottomSheet({
  visible,
  title,
  items,
  selected,
  onSelect,
  onClose,
  styles,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetDismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 340 }}
          >
            {items.map((item) => (
              <TouchableOpacity
                key={item.value}
                style={[
                  styles.sheetItem,
                  selected === item.value && styles.sheetItemActive,
                ]}
                onPress={() => {
                  onSelect(item.value);
                  onClose();
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.sheetItemText,
                    selected === item.value && styles.sheetItemTextActive,
                  ]}
                >
                  {item.label}
                </Text>
                {selected === item.value && (
                  <Text style={styles.sheetCheck}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.sheetCancel} onPress={onClose}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WeeklySchedule() {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  const [college, setCollege] = useState("");
  const [program, setProgram] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [section, setSection] = useState("");
  const [schedType, setSchedType] = useState("day");
  const [semester, setSemester] = useState("1st Semester");
  const [schoolYear, setSchoolYear] = useState("2025-2026");
  const [activeDay, setActiveDay] = useState(0);

  const [schedule, setSchedule] = useState(() => blankSchedule());
  const [copiedDay, setCopiedDay] = useState(null);

  // Entry modal state
  const [modal, setModal] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [mSubj, setMSubj] = useState("");
  const [mRoom, setMRoom] = useState("");
  const [mInstr, setMInstr] = useState("");
  const [mStart, setMStart] = useState(defaultStart());
  const [mEnd, setMEnd] = useState(defaultEnd());

  const roomRef = useRef(null);
  const instrRef = useRef(null);

  const [sheet, setSheet] = useState(null);

  const programs = college ? getCoursesForCollege(college) : [];
  const collegeLabel = college ? getCollegeLabel(college) : "";
  const collegeColor = COLLEGE_COLORS[college];
  const badgeColors =
    collegeColor && !isDark
      ? collegeColor
      : { bg: colors.highlight, text: colors.text, dot: colors.primary };
  const dayEntries = schedule[activeDay] ?? [];

  // ── Entry modal ──

  const openAdd = () => {
    setEditIdx(null);
    setMSubj("");
    setMRoom("");
    setMInstr("");
    setMStart(defaultStart());
    setMEnd(defaultEnd());
    setModal(true);
  };

  const openEdit = (idx) => {
    const e = dayEntries[idx];
    setEditIdx(idx);
    setMSubj(e.subj);
    setMRoom(e.room);
    setMInstr(e.instr);
    setMStart({ ...e.startTime });
    setMEnd({ ...e.endTime });
    setModal(true);
  };

  const saveEntry = () => {
    if (!mSubj.trim()) {
      Alert.alert("Required", "Please enter a subject name.");
      return;
    }
    if (timeToMinutes(mEnd) <= timeToMinutes(mStart)) {
      Alert.alert("Invalid time", "End time must be after start time.");
      return;
    }
    const entry = {
      subj: mSubj.trim(),
      room: mRoom.trim(),
      instr: mInstr.trim(),
      startTime: { ...mStart },
      endTime: { ...mEnd },
    };
    setSchedule((prev) => {
      const next = prev.map((d) => [...d]);
      if (editIdx !== null) next[activeDay][editIdx] = entry;
      else next[activeDay].push(entry);
      next[activeDay].sort(
        (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
      );
      return next;
    });
    setModal(false);
  };

  const deleteEntry = (idx) => {
    Alert.alert("Delete Subject", "Remove this subject from the schedule?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          setSchedule((prev) => {
            const next = prev.map((d) => [...d]);
            next[activeDay].splice(idx, 1);
            return next;
          }),
      },
    ]);
  };

  // ── Copy / Paste ──

  const onCopyBtn = () => {
    if (copiedDay === activeDay) {
      setCopiedDay(null);
      return;
    }
    setCopiedDay(activeDay);
    Alert.alert(
      "Copied",
      `${DAYS[activeDay]} schedule copied. Tap another day tab to paste.`
    );
  };

  const onDayTabPress = (i) => {
    if (copiedDay !== null && copiedDay !== i) {
      Alert.alert("Paste Schedule", `Paste ${DAYS[copiedDay]} to ${DAYS[i]}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Paste",
          onPress: () => {
            setSchedule((prev) => {
              const next = prev.map((d) => [...d]);
              next[i] = JSON.parse(JSON.stringify(prev[copiedDay]));
              return next;
            });
            setCopiedDay(null);
            setActiveDay(i);
          },
        },
      ]);
    } else {
      setActiveDay(i);
    }
  };

  // ── Computed ──

  const duration = timeToMinutes(mEnd) - timeToMinutes(mStart);
  const durationText =
    duration > 0
      ? `${Math.floor(duration / 60) > 0 ? Math.floor(duration / 60) + "h " : ""}${duration % 60 > 0 ? (duration % 60) + "min" : ""}`
      : null;

  // ── Render ──

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.card}
      />
      <ScrollView
        style={styles.root}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.appHeader}>
          <Text style={styles.appTitle}>Weekly Schedule</Text>
          <Text style={styles.appSub}>Student class schedule maker</Text>
        </View>

        {/* Student Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Student Information</Text>

          <TouchableOpacity
            style={styles.dropBtn}
            onPress={() => setSheet("college")}
            activeOpacity={0.7}
          >
            <Text style={styles.dropLabel}>College</Text>
            <Text
              style={[styles.dropValue, !college && styles.dropPh]}
              numberOfLines={1}
            >
              {college ? collegeLabel : "Select College"}
            </Text>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dropBtn}
            onPress={() => {
              if (!college) {
                Alert.alert("Please select a college first.");
                return;
              }
              setSheet("program");
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.dropLabel}>Program</Text>
            <Text
              style={[styles.dropValue, !program && styles.dropPh]}
              numberOfLines={1}
            >
              {program || "Select Program"}
            </Text>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>

          <View style={styles.row2}>
            <TouchableOpacity
              style={[styles.dropBtn, { flex: 1 }]}
              onPress={() => setSheet("year")}
              activeOpacity={0.7}
            >
              <Text style={styles.dropLabel}>Year</Text>
              <Text style={[styles.dropValue, !yearLevel && styles.dropPh]}>
                {yearLevel || "Select"}
              </Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
            <View style={{ width: 8 }} />
            <TouchableOpacity
              style={[styles.dropBtn, { flex: 1 }]}
              onPress={() => setSheet("section")}
              activeOpacity={0.7}
            >
              <Text style={styles.dropLabel}>Section</Text>
              <Text style={[styles.dropValue, !section && styles.dropPh]}>
                {section ? `Section ${section}` : "Select"}
              </Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.dropBtn}
            onPress={() => setSheet("semester")}
            activeOpacity={0.7}
          >
            <Text style={styles.dropLabel}>Semester</Text>
            <Text style={styles.dropValue}>{semester}</Text>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLbl}>School Year</Text>
              <TextInput
                style={styles.textInput}
                value={schoolYear}
                onChangeText={setSchoolYear}
                placeholder="2025-2026"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={{ width: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLbl}>Schedule Type</Text>
              <View style={styles.toggleRow}>
                {[
                  ["day", "☀ Day"],
                  ["night", "🌙 Night"],
                ].map(([k, l]) => (
                  <TouchableOpacity
                    key={k}
                    style={[
                      styles.toggleBtn,
                      schedType === k && styles.toggleOn,
                    ]}
                    onPress={() => setSchedType(k)}
                  >
                    <Text
                      style={[
                        styles.toggleTxt,
                        schedType === k && styles.toggleTxtOn,
                      ]}
                    >
                      {l}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {college && program && yearLevel && section ? (
            <View style={[styles.badge, { backgroundColor: badgeColors.bg }]}>
              <View
                style={[styles.badgeDot, { backgroundColor: badgeColors.dot }]}
              />
              <Text
                style={[styles.badgeText, { color: badgeColors.text }]}
                numberOfLines={2}
              >
                {college} · {program} · {yearLevel} · Sec {section} · {semester}{" "}
                · S.Y. {schoolYear}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Day Tabs */}
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScroll}
          >
            {DAYS_SHORT.map((d, i) => {
              const isActive = activeDay === i;
              const isCopied = copiedDay === i;
              const hasSubs = (schedule[i] ?? []).length > 0;
              return (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.tab,
                    isActive && styles.tabActive,
                    isCopied && styles.tabCopied,
                  ]}
                  onPress={() => onDayTabPress(i)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.tabTxt,
                      isActive && styles.tabTxtActive,
                      isCopied && styles.tabTxtCopied,
                    ]}
                  >
                    {d}
                  </Text>
                  {hasSubs && (
                    <View
                      style={[styles.tabDot, isActive && styles.tabDotActive]}
                    />
                  )}
                  {isCopied && <Text style={styles.copiedTag}>COPIED</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {copiedDay !== null ? (
          <View style={styles.copyBanner}>
            <Text style={styles.copyBannerTxt}>
              📋 <Text style={{ fontWeight: "700" }}>{DAYS[copiedDay]}</Text>{" "}
              copied — tap another day to paste
            </Text>
            <TouchableOpacity
              onPress={() => setCopiedDay(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.copyBannerX}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Day Schedule */}
        <View style={styles.section}>
          <View style={styles.dayRow}>
            <Text style={styles.dayTitle}>{DAYS[activeDay]}</Text>
            <View style={styles.dayActions}>
              <TouchableOpacity
                style={[
                  styles.copyDayBtn,
                  copiedDay === activeDay && styles.copyDayBtnOn,
                ]}
                onPress={onCopyBtn}
              >
                <Text
                  style={[
                    styles.copyDayTxt,
                    copiedDay === activeDay && styles.copyDayTxtOn,
                  ]}
                >
                  {copiedDay === activeDay ? "✓ Copied" : "Copy Day"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addSubjBtn} onPress={openAdd}>
                <Text style={styles.addSubjTxt}>+ Add Subject</Text>
              </TouchableOpacity>
            </View>
          </View>

          {dayEntries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyTitle}>No classes yet</Text>
              <Text style={styles.emptyHint}>
                Tap &apos;+ Add Subject&apos; to add a class for{" "}
                {DAYS[activeDay]}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {dayEntries.map((e, i) => {
                const cardAccent = badgeColors?.dot || colors.primary;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderLeftColor: cardAccent,
                      },
                    ]}
                    onPress={() => openEdit(i)}
                    onLongPress={() => deleteEntry(i)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardTop}>
                      <Text
                        style={[styles.cardSubj, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {e.subj}
                      </Text>
                      <View
                        style={[
                          styles.cardTime,
                          { backgroundColor: colors.highlight },
                        ]}
                      >
                        <Text
                          style={[
                            styles.cardTimeTxt,
                            { color: colors.primary },
                          ]}
                        >
                          {formatTime(e.startTime)}
                        </Text>
                        <Text
                          style={[
                            styles.cardTimeSep,
                            { color: colors.primary },
                          ]}
                        >
                          –
                        </Text>
                        <Text
                          style={[
                            styles.cardTimeTxt,
                            { color: colors.primary },
                          ]}
                        >
                          {formatTime(e.endTime)}
                        </Text>
                      </View>
                    </View>
                    {e.room ? (
                      <Text style={[styles.cardMeta, { color: colors.muted }]}>
                        📍 {e.room}
                      </Text>
                    ) : null}
                    {e.instr ? (
                      <Text style={[styles.cardMeta, { color: colors.muted }]}>
                        👤 {e.instr}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Week Overview */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Week Overview</Text>
          <View style={styles.overGrid}>
            {DAYS.map((d, i) => {
              const count = (schedule[i] ?? []).length;
              const on = activeDay === i;
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.overCard, on && styles.overCardOn]}
                  onPress={() => setActiveDay(i)}
                >
                  <Text style={[styles.overDay, on && styles.overDayOn]}>
                    {DAYS_SHORT[i]}
                  </Text>
                  <Text style={[styles.overCount, on && styles.overCountOn]}>
                    {count}
                  </Text>
                  <Text style={[styles.overSub, on && styles.overSubOn]}>
                    {count === 1 ? "class" : "classes"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Bottom Sheets ── */}
      <BottomSheet
        visible={sheet === "college"}
        title="Select College"
        items={COLLEGES.map((c) => ({ value: c.value, label: c.label }))}
        selected={college}
        onSelect={(v) => {
          setCollege(v);
          setProgram("");
        }}
        styles={styles}
        onClose={() => setSheet(null)}
      />
      <BottomSheet
        visible={sheet === "program"}
        title="Select Program"
        items={programs.map((p) => ({ value: p, label: p }))}
        selected={program}
        onSelect={setProgram}
        styles={styles}
        onClose={() => setSheet(null)}
      />
      <BottomSheet
        visible={sheet === "year"}
        title="Year Level"
        items={YEAR_LEVELS.map((y) => ({ value: y, label: y }))}
        selected={yearLevel}
        onSelect={setYearLevel}
        styles={styles}
        onClose={() => setSheet(null)}
      />
      <BottomSheet
        visible={sheet === "section"}
        title="Section"
        items={SECTIONS.map((s) => ({ value: s, label: `Section ${s}` }))}
        selected={section}
        onSelect={setSection}
        styles={styles}
        onClose={() => setSheet(null)}
      />
      <BottomSheet
        visible={sheet === "semester"}
        title="Semester"
        items={SEMESTERS.map((s) => ({ value: s, label: s }))}
        selected={semester}
        onSelect={setSemester}
        styles={styles}
        onClose={() => setSheet(null)}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          ADD / EDIT SUBJECT MODAL — restyled to match RegisterScreen form
          ═══════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={modal}
        transparent
        animationType="slide"
        onRequestClose={() => setModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Handle */}
            <View style={styles.modalHandle} />

            {/* Title row */}
            <View style={styles.modalTitleRow}>
              <View
                style={[
                  styles.modalTitleIcon,
                  { backgroundColor: colors.primary + "18" },
                ]}
              >
                <Ionicons
                  name={
                    editIdx !== null ? "create-outline" : "add-circle-outline"
                  }
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {editIdx !== null ? "Edit Subject" : "Add Subject"}
                </Text>
                <Text style={styles.modalSub}>{DAYS[activeDay]}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ marginTop: 8 }}
            >
              {/* ── Subject name ── */}
              <InputField
                label="Subject / Course"
                icon="book-outline"
                placeholder="e.g. Mathematics 1"
                value={mSubj}
                onChangeText={setMSubj}
                autoCapitalize="words"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => roomRef.current?.focus()}
              />

              {/* ── Time pickers ── */}
              <View style={styles.timeBlock}>
                <View style={styles.timeBlockHeader}>
                  <Ionicons name="time-outline" size={14} color="#94a3b8" />
                  <Text style={styles.timeBlockLabel}>Class Time</Text>
                </View>

                <View style={styles.timePickerRow}>
                  <TimePicker
                    label="Start Time"
                    value={mStart}
                    onChange={setMStart}
                  />
                  {/* Arrow divider */}
                  <View style={styles.timeArrow}>
                    <View style={styles.timeArrowLine} />
                    <Ionicons name="arrow-forward" size={14} color="#94a3b8" />
                    <View style={styles.timeArrowLine} />
                  </View>
                  <TimePicker
                    label="End Time"
                    value={mEnd}
                    onChange={setMEnd}
                  />
                </View>

                {/* Duration badge / error */}
                {durationText ? (
                  <View
                    style={[
                      styles.durBadge,
                      { backgroundColor: colors.highlight },
                    ]}
                  >
                    <Ionicons
                      name="hourglass-outline"
                      size={13}
                      color={colors.primary}
                    />
                    <Text style={[styles.durTxt, { color: colors.primary }]}>
                      {durationText} duration
                    </Text>
                  </View>
                ) : duration <= 0 && mSubj.trim() ? (
                  <View style={styles.durError}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={13}
                      color="#ef4444"
                    />
                    <Text style={styles.errTxt}>
                      End time must be after start time
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* ── Room ── */}
              <InputField
                inputRef={roomRef}
                label="Room"
                icon="location-outline"
                placeholder="e.g. Room 201"
                value={mRoom}
                onChangeText={setMRoom}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => instrRef.current?.focus()}
              />

              {/* ── Instructor ── */}
              <InputField
                inputRef={instrRef}
                label="Instructor"
                icon="person-outline"
                placeholder="e.g. Prof. Santos"
                value={mInstr}
                onChangeText={setMInstr}
                returnKeyType="done"
                blurOnSubmit={true}
              />

              {/* ── Live Preview (only when subject filled) ── */}
              {mSubj.trim() ? (
                <View style={styles.previewSection}>
                  <Text style={styles.previewLabel}>Preview</Text>
                  <View
                    style={[
                      styles.previewCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderLeftColor: colors.primary,
                      },
                    ]}
                  >
                    <View style={styles.cardTop}>
                      <Text style={[styles.cardSubj, { color: colors.text }]}>
                        {mSubj}
                      </Text>
                      <View
                        style={[
                          styles.cardTime,
                          { backgroundColor: colors.highlight },
                        ]}
                      >
                        <Text
                          style={[
                            styles.cardTimeTxt,
                            { color: colors.primary },
                          ]}
                        >
                          {formatTime(mStart)}
                        </Text>
                        <Text
                          style={[
                            styles.cardTimeSep,
                            { color: colors.primary },
                          ]}
                        >
                          –
                        </Text>
                        <Text
                          style={[
                            styles.cardTimeTxt,
                            { color: colors.primary },
                          ]}
                        >
                          {formatTime(mEnd)}
                        </Text>
                      </View>
                    </View>
                    {mRoom ? (
                      <Text style={[styles.cardMeta, { color: colors.muted }]}>
                        📍 {mRoom}
                      </Text>
                    ) : null}
                    {mInstr ? (
                      <Text style={[styles.cardMeta, { color: colors.muted }]}>
                        👤 {mInstr}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {/* ── Action Buttons ── */}
              <View style={styles.mBtns}>
                <TouchableOpacity
                  style={styles.btnCancel}
                  onPress={() => setModal(false)}
                >
                  <Text style={styles.btnCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnSave, { backgroundColor: colors.primary }]}
                  onPress={saveEntry}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={
                      editIdx !== null
                        ? "checkmark-circle-outline"
                        : "add-circle-outline"
                    }
                    size={17}
                    color="#fff"
                  />
                  <Text style={styles.btnSaveTxt}>
                    {editIdx !== null ? "Save Changes" : "Add Subject"}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Drum Styles ──────────────────────────────────────────────────────────────

const drum = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    height: PICKER_H,
    overflow: "hidden",
  },
  selector: {
    position: "absolute",
    top: ITEM_H * 2,
    left: 0,
    right: 0,
    height: ITEM_H,
    borderRadius: 8,
    zIndex: 1,
  },
  item: { height: ITEM_H, alignItems: "center", justifyContent: "center" },
  txt: { fontSize: 15, color: "#9CA3AF" },
  sel: { fontSize: 19, fontWeight: "800", color: "#111827" },
  colon: {
    fontSize: 22,
    fontWeight: "800",
    color: "#374151",
    paddingHorizontal: 2,
  },
});

// ─── Main Styles ──────────────────────────────────────────────────────────────

const makeStyles = (colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    root: { flex: 1, backgroundColor: colors.background },

    appHeader: {
      backgroundColor: colors.card,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    appTitle: {
      fontSize: 24,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: -0.5,
    },
    appSub: { fontSize: 13, color: colors.muted, marginTop: 2 },

    section: {
      backgroundColor: colors.card,
      marginTop: 10,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderTopWidth: 0.5,
      borderBottomWidth: 0.5,
      borderColor: colors.border,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },

    dropBtn: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
    },
    dropLabel: { fontSize: 12, color: colors.muted, width: 68 },
    dropValue: { flex: 1, fontSize: 14, color: colors.text, fontWeight: "500" },
    dropPh: { color: colors.muted, fontWeight: "400" },
    chev: { fontSize: 20, color: colors.muted, lineHeight: 22 },

    row2: { flexDirection: "row", marginBottom: 0 },
    inputLbl: { fontSize: 12, color: colors.muted, marginBottom: 4 },
    textInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontSize: 14,
      color: colors.text,
      marginBottom: 8,
    },
    toggleRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
    toggleBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
    },
    toggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    toggleTxt: { fontSize: 13, color: colors.muted, fontWeight: "500" },
    toggleTxtOn: { color: "#FFFFFF" },

    badge: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginTop: 6,
      gap: 8,
    },
    badgeDot: { width: 8, height: 8, borderRadius: 4 },
    badgeText: { fontSize: 12, fontWeight: "500", flex: 1 },

    // Tabs
    tabBar: {
      backgroundColor: colors.card,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    tabScroll: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
    tab: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: "center",
      minWidth: 52,
    },
    tabActive: { backgroundColor: colors.primary },
    tabCopied: {
      backgroundColor: colors.highlight,
      borderWidth: 1.5,
      borderColor: colors.primary,
    },
    tabTxt: { fontSize: 13, fontWeight: "600", color: colors.muted },
    tabTxtActive: { color: "#FFFFFF" },
    tabTxtCopied: { color: colors.primary },
    tabDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.muted,
      marginTop: 3,
    },
    tabDotActive: { backgroundColor: "#FFFFFF" },
    copiedTag: {
      fontSize: 7,
      color: colors.primary,
      fontWeight: "700",
      letterSpacing: 0.3,
      marginTop: 1,
    },

    copyBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.highlight,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
    },
    copyBannerTxt: { flex: 1, fontSize: 13, color: colors.text },
    copyBannerX: { fontSize: 16, color: colors.primary },

    dayRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
    dayTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.text },
    dayActions: { flexDirection: "row", gap: 8 },
    copyDayBtn: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    copyDayBtnOn: {
      backgroundColor: colors.highlight,
      borderColor: colors.primary,
    },
    copyDayTxt: { fontSize: 12, color: colors.text, fontWeight: "500" },
    copyDayTxtOn: { color: colors.primary },
    addSubjBtn: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    addSubjTxt: { fontSize: 12, color: "#FFFFFF", fontWeight: "600" },

    empty: { alignItems: "center", paddingVertical: 40 },
    emptyIcon: { fontSize: 40, marginBottom: 10 },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 4,
    },
    emptyHint: { fontSize: 13, color: colors.muted, textAlign: "center" },

    card: {
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      backgroundColor: colors.card,
    },
    cardTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 4,
    },
    cardSubj: { flex: 1, fontSize: 15, fontWeight: "700", lineHeight: 20 },
    cardTime: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      alignItems: "center",
    },
    cardTimeTxt: { fontSize: 11, fontWeight: "600" },
    cardTimeSep: { fontSize: 10, opacity: 0.6 },
    cardMeta: { fontSize: 12, opacity: 0.8, marginTop: 2 },

    overGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    overCard: {
      flex: 1,
      minWidth: 70,
      alignItems: "center",
      paddingVertical: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    overCardOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    overDay: { fontSize: 11, fontWeight: "700", color: colors.muted },
    overDayOn: { color: "#E2E8F0" },
    overCount: {
      fontSize: 22,
      fontWeight: "800",
      color: colors.text,
      marginTop: 2,
    },
    overCountOn: { color: "#FFFFFF" },
    overSub: { fontSize: 10, color: colors.muted, marginTop: 1 },
    overSubOn: { color: "#BFDBFE" },

    // Bottom sheets
    sheetOverlay: { flex: 1, justifyContent: "flex-end" },
    sheetDismiss: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: Platform.OS === "ios" ? 36 : 24,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: 16,
    },
    sheetTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    sheetItem: {
      paddingVertical: 14,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
    },
    sheetItemActive: { backgroundColor: colors.highlight },
    sheetItemText: { flex: 1, fontSize: 15, color: colors.text },
    sheetItemTextActive: { color: colors.primary, fontWeight: "700" },
    sheetCheck: { fontSize: 16, color: colors.primary },
    sheetCancel: {
      marginTop: 12,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetCancelText: { fontSize: 15, color: colors.muted, fontWeight: "500" },

    // ── Modal (restyled) ──
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    modalCard: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: Platform.OS === "ios" ? 36 : 24,
      maxHeight: "96%",
    },
    modalHandle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: 18,
    },

    modalTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 20,
    },
    modalTitleIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      justifyContent: "center",
      alignItems: "center",
    },
    modalTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
    modalSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
    modalCloseBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
      alignItems: "center",
    },

    // Time block container
    timeBlock: {
      backgroundColor: "#f8fafc",
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: "#e2e8f0",
      padding: 14,
      marginBottom: 16,
    },
    timeBlockHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 10,
    },
    timeBlockLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    timePickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    timeArrow: {
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      gap: 2,
    },
    timeArrowLine: { width: 1, height: 10, backgroundColor: "#cbd5e1" },

    durBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      alignSelf: "flex-start",
      marginTop: 10,
    },
    durTxt: { fontSize: 12, fontWeight: "600" },
    durError: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 8,
    },
    errTxt: { fontSize: 12, color: "#ef4444", fontWeight: "500" },

    previewSection: { marginBottom: 16 },
    previewLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 8,
    },
    previewCard: {
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderLeftWidth: 4,
    },

    mBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
    btnCancel: {
      flex: 1,
      paddingVertical: 15,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: "#e2e8f0",
      backgroundColor: "#f8fafc",
      alignItems: "center",
    },
    btnCancelTxt: { fontSize: 15, color: "#64748b", fontWeight: "600" },
    btnSave: {
      flex: 2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 15,
      borderRadius: 16,
      shadowColor: "#007bff",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 5,
    },
    btnSaveTxt: { fontSize: 15, color: "#FFFFFF", fontWeight: "700" },
  });
