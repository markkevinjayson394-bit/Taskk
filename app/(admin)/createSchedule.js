import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { db } from "../../config/firebase";
import {
  COLLEGES,
  getCoursesForCollege,
  normalizeCollege,
  normalizeCourse,
} from "../../constants/academics";
import { useTheme } from "../../context/ThemeContext";

// FIX #10: added Saturday to match schedule.js display
const daysOfWeek = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const sections = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const DEFAULT_COLLEGE = COLLEGES[0]?.value || "";
const DEFAULT_COURSE = getCoursesForCollege(DEFAULT_COLLEGE)[0] || "";

const findCollegeForCourse = (courseValue) => {
  const normalized = normalizeCourse(courseValue);
  if (!normalized) return "";
  for (const collegeItem of COLLEGES) {
    const list = getCoursesForCollege(collegeItem.value);
    if (list.some((item) => normalizeCourse(item) === normalized)) {
      return collegeItem.value;
    }
  }
  return "";
};

export default function CreateSchedule() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();

  /* ---------- SAFE PARAM HANDLING ---------- */
  let existingData = null;
  if (params.scheduleData) {
    if (typeof params.scheduleData === "string") {
      try {
        existingData = JSON.parse(params.scheduleData);
      } catch (err) {
        console.warn("Invalid scheduleData param:", err);
        existingData = null;
      }
    } else {
      existingData = params.scheduleData;
    }
  }

  const createEmptyWeek = () =>
    daysOfWeek.reduce((acc, day) => {
      acc[day] = [];
      return acc;
    }, {});

  const [college, setCollege] = useState(DEFAULT_COLLEGE);
  const [course, setCourse] = useState(DEFAULT_COURSE);
  const [year, setYear] = useState("1");
  const [section, setSection] = useState("A");
  const [semester, setSemester] = useState("");
  const [scheduleType, setScheduleType] = useState("Specific");
  const [weekClasses, setWeekClasses] = useState(createEmptyWeek());
  const [showPicker, setShowPicker] = useState(null);
  const [copiedDay, setCopiedDay] = useState(null);

  const courseOptions = useMemo(() => {
    const list = getCoursesForCollege(college);
    if (!course) return list;
    if (list.includes(course)) return list;
    return [...list, course];
  }, [college, course]);

  /* ---------- LOAD EDIT DATA ---------- */
  const isLoaded = useRef(false);

  useEffect(() => {
    if (existingData && !isLoaded.current) {
      isLoaded.current = true;
      const inferredCollege =
        normalizeCollege(existingData.college) ||
        findCollegeForCourse(existingData.course) ||
        DEFAULT_COLLEGE;
      setCollege(inferredCollege);
      setCourse(existingData.course || DEFAULT_COURSE);
      setYear(existingData.year || "1");
      setSection(existingData.section || "A");
      setSemester(existingData.semester || "");
      setScheduleType(existingData.scheduleType || "Specific");
      setWeekClasses(existingData.weekSchedule || createEmptyWeek());
    }
  }, [existingData]);

  const handleCollegeChange = (value) => {
    setCollege(value);
    const list = getCoursesForCollege(value);
    setCourse((prev) => {
      if (prev && list.includes(prev)) return prev;
      return list[0] || "";
    });
  };

  const cloneClasses = (classes = []) => classes.map((cls) => ({ ...cls }));

  /* ---------- CLASS FUNCTIONS ---------- */
  const addClass = (day) => {
    setWeekClasses((prev) => ({
      ...prev,
      [day]: [
        ...prev[day],
        { subject: "", teacher: "", start: null, end: null, timeDisplay: "" },
      ],
    }));
  };

  const updateClass = (day, index, field, value) => {
    const copy = { ...weekClasses };
    copy[day][index][field] = value;

    // FIX #3: auto-update timeDisplay whenever start or end changes
    if (field === "start" || field === "end") {
      const cls = copy[day][index];
      const startVal = field === "start" ? value : cls.start;
      const endVal = field === "end" ? value : cls.end;
      if (startVal && endVal) {
        copy[day][index].timeDisplay =
          `${formatTime(startVal)} - ${formatTime(endVal)}`;
      } else if (startVal) {
        copy[day][index].timeDisplay = formatTime(startVal);
      }
    }

    setWeekClasses(copy);
  };

  const deleteClass = (day, index) => {
    const copy = { ...weekClasses };
    copy[day].splice(index, 1);
    setWeekClasses(copy);
  };

  const copyDay = (day) => {
    setCopiedDay(day);
    Alert.alert("Copied", `${day} schedule copied!`);
  };

  const pasteToDay = (targetDay) => {
    if (!copiedDay) {
      Alert.alert("Error", "No day copied yet.");
      return;
    }
    if (copiedDay === targetDay) {
      Alert.alert("Error", "Cannot paste to the same day.");
      return;
    }
    setWeekClasses((prev) => ({
      ...prev,
      [targetDay]: cloneClasses(prev[copiedDay]),
    }));
    Alert.alert("Pasted", `Schedule from ${copiedDay} pasted to ${targetDay}!`);
  };

  const formatTime = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const hours24 = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${minutes} ${suffix}`;
  };

  const sanitize = (s) => String(s).replace(/\s+/g, "_").toLowerCase();

  /* ---------- SAVE ---------- */
  const saveSchedule = async () => {
    if (!college || !course || !year || !section) {
      Alert.alert("Error", "Fill all fields.");
      return;
    }

    try {
      const normalizedCollege = normalizeCollege(college);
      const normalizedCourse = normalizeCourse(course);
      const docId = `${sanitize(normalizedCourse)}_${year}_${section}`;

      // FIX #3: weekClasses already has timeDisplay set via updateClass
      await setDoc(doc(db, "schedules", docId), {
        college: normalizedCollege,
        course: normalizedCourse,
        year,
        section,
        semester,
        scheduleType,
        weekSchedule: weekClasses,
      });

      Alert.alert("Success", "Schedule Saved!");
      router.back();
    } catch (err) {
      Alert.alert("Error", err.message);
    }
  };

  /* ---------- DELETE ---------- */
  const deleteSchedule = async () => {
    Alert.alert(
      "Delete Schedule",
      "Are you sure you want to delete this schedule?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const normalizedCourse = normalizeCourse(course);
              const docId = `${sanitize(normalizedCourse)}_${year}_${section}`;
              await deleteDoc(doc(db, "schedules", docId));
              Alert.alert("Deleted");
              router.back();
            } catch (err) {
              Alert.alert("Error", err.message);
            }
          },
        },
      ]
    );
  };

  /* ---------- UI ---------- */
  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { backgroundColor: colors.background },
      ]}
    >
      <Text style={[styles.title, { color: colors.text }]}>
        {existingData ? "Edit Schedule" : "Create Schedule"}
      </Text>

      {/* COLLEGE */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>College</Text>
        <Picker
          selectedValue={college}
          onValueChange={handleCollegeChange}
          style={{ color: colors.text }}
        >
          {COLLEGES.map((item) => (
            <Picker.Item
              key={item.value}
              label={item.label}
              value={item.value}
            />
          ))}
        </Picker>
      </View>

      {/* COURSE */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Course</Text>
        <Picker
          selectedValue={course}
          onValueChange={setCourse}
          style={{ color: colors.text }}
        >
          {courseOptions.length === 0 ? (
            <Picker.Item label="No courses available" value="" />
          ) : (
            courseOptions.map((c) => (
              <Picker.Item key={c} label={c} value={c} />
            ))
          )}
        </Picker>
      </View>

      {/* YEAR */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Year</Text>
        <Picker
          selectedValue={year}
          onValueChange={setYear}
          style={{ color: colors.text }}
        >
          <Picker.Item label="1st Year" value="1" />
          <Picker.Item label="2nd Year" value="2" />
          <Picker.Item label="3rd Year" value="3" />
          <Picker.Item label="4th Year" value="4" />
        </Picker>
      </View>

      {/* SECTION */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Section</Text>
        <Picker
          selectedValue={section}
          onValueChange={setSection}
          style={{ color: colors.text }}
        >
          {sections.map((s) => (
            <Picker.Item key={s} label={s} value={s} />
          ))}
        </Picker>
      </View>

      {/* SCHEDULE TYPE */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Schedule Type</Text>
        <Picker
          selectedValue={scheduleType}
          onValueChange={setScheduleType}
          style={{ color: colors.text }}
        >
          <Picker.Item label="Day" value="Day" />
          <Picker.Item label="Night" value="Night" />
          <Picker.Item label="Specific" value="Specific" />
        </Picker>
      </View>

      {/* SEMESTER */}
      <TextInput
        placeholder="Semester (e.g. 1st Semester)"
        placeholderTextColor={colors.muted}
        value={semester}
        onChangeText={setSemester}
        style={[
          styles.input,
          {
            color: colors.text,
            borderColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      />

      {/* DAYS */}
      {daysOfWeek.map((day) => (
        <View key={day}>
          <View style={styles.dayHeader}>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => addClass(day)}
            >
              <Text style={{ color: "#fff" }}>+ Add {day}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.copyButton, { backgroundColor: "#f59e0b" }]}
              onPress={() => copyDay(day)}
            >
              <Text style={{ color: "#fff" }}>Copy</Text>
            </TouchableOpacity>

            {copiedDay && copiedDay !== day && (
              <TouchableOpacity
                style={[
                  styles.pasteButton,
                  { backgroundColor: colors.success },
                ]}
                onPress={() => pasteToDay(day)}
              >
                <Text style={{ color: "#fff" }}>Paste from {copiedDay}</Text>
              </TouchableOpacity>
            )}
          </View>

          {weekClasses[day]?.map((cls, i) => (
            <View
              key={i}
              style={[styles.card, { backgroundColor: colors.card }]}
            >
              <TextInput
                placeholder="Subject"
                placeholderTextColor={colors.muted}
                value={cls.subject}
                onChangeText={(t) => updateClass(day, i, "subject", t)}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border },
                ]}
              />
              <TextInput
                placeholder="Teacher"
                placeholderTextColor={colors.muted}
                value={cls.teacher}
                onChangeText={(t) => updateClass(day, i, "teacher", t)}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border },
                ]}
              />

              <View style={styles.timeRow}>
                <TouchableOpacity
                  style={[
                    styles.timeTile,
                    {
                      borderColor: colors.border,
                      backgroundColor: cls.start
                        ? `${colors.primary}18`
                        : colors.surface || colors.background,
                    },
                  ]}
                  onPress={() =>
                    setShowPicker({ day, index: i, field: "start" })
                  }
                >
                  <View style={styles.timeTileHeader}>
                    <Ionicons
                      name="time-outline"
                      size={14}
                      color={colors.muted}
                    />
                    <Text style={[styles.timeLabel, { color: colors.muted }]}>
                      Start
                    </Text>
                  </View>
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    {cls.start ? formatTime(cls.start) : "Set time"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.timeTile,
                    {
                      borderColor: colors.border,
                      backgroundColor: cls.end
                        ? `${colors.primary}18`
                        : colors.surface || colors.background,
                    },
                  ]}
                  onPress={() =>
                    setShowPicker({ day, index: i, field: "end" })
                  }
                >
                  <View style={styles.timeTileHeader}>
                    <Ionicons
                      name="time-outline"
                      size={14}
                      color={colors.muted}
                    />
                    <Text style={[styles.timeLabel, { color: colors.muted }]}>
                      End
                    </Text>
                  </View>
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    {cls.end ? formatTime(cls.end) : "Set time"}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Show computed timeDisplay as a preview */}
              {cls.timeDisplay ? (
                <Text
                  style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}
                >
                  Display: {cls.timeDisplay}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.deleteBtn, { backgroundColor: colors.danger }]}
                onPress={() => deleteClass(day, i)}
              >
                <Text style={{ color: "#fff" }}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}

      {/* TIME PICKER */}
      {showPicker && (
        <DateTimePicker
          value={new Date()}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour={false}
          onChange={(e, date) => {
            if (date) {
              updateClass(
                showPicker.day,
                showPicker.index,
                showPicker.field,
                date.toISOString()
              );
            }
            setShowPicker(null);
          }}
        />
      )}

      {/* SAVE */}
      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: colors.success }]}
        onPress={saveSchedule}
      >
        <Text style={{ color: "#fff", fontWeight: "bold" }}>Save Schedule</Text>
      </TouchableOpacity>

      {/* DELETE */}
      {existingData && (
        <TouchableOpacity
          style={[styles.deleteBtn, { backgroundColor: colors.danger }]}
          onPress={deleteSchedule}
        >
          <Text style={{ color: "#fff" }}>Delete Schedule</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 15,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 5,
  },
  addButton: {
    padding: 8,
    borderRadius: 8,
    marginTop: 10,
    alignItems: "center",
  },
  saveBtn: {
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    alignItems: "center",
  },
  deleteBtn: {
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    alignItems: "center",
  },
  timeRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  timeTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timeTileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  timeValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  dayHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
  },
  copyButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  pasteButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
});
