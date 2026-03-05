import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
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
import { useTheme } from "../../context/ThemeContext";

// FIX #10: added Saturday to match schedule.js display
const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const sections = ["A","B","C","D","E","F","G","H","I","J"];

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
      } catch {
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

  const [course, setCourse] = useState("BSIT");
  const [year, setYear] = useState("1");
  const [section, setSection] = useState("A");
  const [semester, setSemester] = useState("");
  const [scheduleType, setScheduleType] = useState("Specific");
  const [weekClasses, setWeekClasses] = useState(createEmptyWeek());
  const [showPicker, setShowPicker] = useState(null);

  /* ---------- LOAD EDIT DATA ---------- */
  useEffect(() => {
    if (existingData) {
      setCourse(existingData.course || "BSIT");
      setYear(existingData.year || "1");
      setSection(existingData.section || "A");
      setSemester(existingData.semester || "");
      setScheduleType(existingData.scheduleType || "Specific");
      setWeekClasses(existingData.weekSchedule || createEmptyWeek());
    }
  }, []);

  /* ---------- CLASS FUNCTIONS ---------- */
  const addClass = (day) => {
    setWeekClasses((prev) => ({
      ...prev,
      [day]: [...prev[day], { subject: "", teacher: "", start: null, end: null, timeDisplay: "" }],
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
        copy[day][index].timeDisplay = `${formatTime(startVal)} - ${formatTime(endVal)}`;
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

  const formatTime = (dateString) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const sanitize = (s) => String(s).replace(/\s+/g, "_").toLowerCase();

  /* ---------- SAVE ---------- */
  const saveSchedule = async () => {
    if (!course || !year || !section) {
      Alert.alert("Error", "Fill all fields.");
      return;
    }

    try {
      const docId = `${sanitize(course)}_${year}_${section}`;

      // FIX #3: weekClasses already has timeDisplay set via updateClass
      await setDoc(doc(db, "schedules", docId), {
        course,
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
              const docId = `${sanitize(course)}_${year}_${section}`;
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

      {/* COURSE */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Course</Text>
        <Picker selectedValue={course} onValueChange={setCourse} style={{ color: colors.text }}>
          <Picker.Item label="BSIT" value="BSIT" />
          <Picker.Item label="BIT CompTech" value="BIT CompTech" />
          <Picker.Item label="BIT Drafting" value="BIT Drafting" />
          <Picker.Item label="BIT Electronics" value="BIT Electronics" />
          <Picker.Item label="BIT Electricity" value="BIT Electricity" />
          <Picker.Item label="BSMX" value="BSMX" />
        </Picker>
      </View>

      {/* YEAR */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Year</Text>
        <Picker selectedValue={year} onValueChange={setYear} style={{ color: colors.text }}>
          <Picker.Item label="1st Year" value="1" />
          <Picker.Item label="2nd Year" value="2" />
          <Picker.Item label="3rd Year" value="3" />
          <Picker.Item label="4th Year" value="4" />
        </Picker>
      </View>

      {/* SECTION */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Section</Text>
        <Picker selectedValue={section} onValueChange={setSection} style={{ color: colors.text }}>
          {sections.map((s) => (
            <Picker.Item key={s} label={s} value={s} />
          ))}
        </Picker>
      </View>

      {/* SCHEDULE TYPE */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text }}>Schedule Type</Text>
        <Picker selectedValue={scheduleType} onValueChange={setScheduleType} style={{ color: colors.text }}>
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
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
      />

      {/* DAYS */}
      {daysOfWeek.map((day) => (
        <View key={day}>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.primary }]}
            onPress={() => addClass(day)}
          >
            <Text style={{ color: "#fff" }}>+ Add {day}</Text>
          </TouchableOpacity>

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
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TextInput
                placeholder="Teacher"
                placeholderTextColor={colors.muted}
                value={cls.teacher}
                onChangeText={(t) => updateClass(day, i, "teacher", t)}
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />

              <TouchableOpacity
                style={styles.timeButton}
                onPress={() => setShowPicker({ day, index: i, field: "start" })}
              >
                <Text style={{ color: colors.text }}>
                  {cls.start ? formatTime(cls.start) : "⏰ Start Time"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.timeButton}
                onPress={() => setShowPicker({ day, index: i, field: "end" })}
              >
                <Text style={{ color: colors.text }}>
                  {cls.end ? formatTime(cls.end) : "⏰ End Time"}
                </Text>
              </TouchableOpacity>

              {/* Show computed timeDisplay as a preview */}
              {cls.timeDisplay ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
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
          display={Platform.OS === "ios" ? "compact" : "spinner"}
          is24Hour
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
  timeButton: {
    borderWidth: 1,
    padding: 10,
    borderRadius: 6,
    marginVertical: 5,
  },
});