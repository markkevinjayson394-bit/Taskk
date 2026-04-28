import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import ScheduleActionBar from "../../components/admin-schedule/ScheduleActionBar";
import ScheduleClonePanel from "../../components/admin-schedule/ScheduleClonePanel";
import ScheduleDetailsSection from "../../components/admin-schedule/ScheduleDetailsSection";
import ScheduleValidationAlerts from "../../components/admin-schedule/ScheduleValidationAlerts";
import ScheduleDaySection from "../../components/admin-schedule/ScheduleDaySection";
import { db } from "../../config/firebase";
import {
  COLLEGES,
  getCoursesForCollege,
  normalizeCollege,
  normalizeCourse,
} from "../../constants/academics";
import { useTheme } from "../../context/ThemeContext";
import {
  buildLegacyScheduleDocId,
  buildScheduleDocId,
  cleanText,
  createEmptyWeek,
  DEFAULT_SCHOOL_YEAR,
  findCollegeForCourse,
  getAdjacentAcademicYear,
  getMinutesFromIso,
  normalizeScheduleTypeValue,
  SCHEDULE_DAYS as daysOfWeek,
  SCHOOL_YEAR_OPTIONS,
  validateWeekSchedule,
} from "../../utils/adminSchedule";

const YEAR_LEVEL_OPTIONS = ["1", "2", "3", "4"];
const sections = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const SEMESTERS = ["1st Sem", "2nd Sem", "Summer"];
const DEFAULT_COLLEGE = COLLEGES[0]?.value || "";
const DEFAULT_COURSE = getCoursesForCollege(DEFAULT_COLLEGE)[0] || "";
export default function CreateSchedule() {

  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();

  /* ---------- SAFE PARAM HANDLING ---------- */
  const existingData = useMemo(() => {
    if (!params.scheduleData) return null;
    if (typeof params.scheduleData === "string") {
      try {
        return JSON.parse(params.scheduleData);
      } catch (err) {
        console.warn("Invalid scheduleData param:", err);
        return null;
      }
    }
    return params.scheduleData;
  }, [params.scheduleData]);


  const [college, setCollege] = useState(DEFAULT_COLLEGE);
  const [course, setCourse] = useState(DEFAULT_COURSE);
  const [year, setYear] = useState("1");
  const [section, setSection] = useState("A");
  const [semester, setSemester] = useState(SEMESTERS[0] || "");
  const [academicYear, setAcademicYear] = useState(DEFAULT_SCHOOL_YEAR);
  const [scheduleType, setScheduleType] = useState("Day");
  const [weekClasses, setWeekClasses] = useState(createEmptyWeek());
  const [showPicker, setShowPicker] = useState(null);
  const [copiedDay, setCopiedDay] = useState(null);
  const [repeatEditor, setRepeatEditor] = useState(null);
  const [repeatTargets, setRepeatTargets] = useState({});
  const [cloneYear, setCloneYear] = useState("1");
  const [cloneSection, setCloneSection] = useState("A");

  const courseOptions = useMemo(() => {
    const list = getCoursesForCollege(college);
    if (!course) return list;
    if (list.includes(course)) return list;
    return [...list, course];
  }, [college, course]);

  const academicYearOptions = useMemo(() => {
    if (!academicYear) return SCHOOL_YEAR_OPTIONS;
    if (SCHOOL_YEAR_OPTIONS.includes(academicYear)) return SCHOOL_YEAR_OPTIONS;
    return [...SCHOOL_YEAR_OPTIONS, academicYear].filter(Boolean);
  }, [academicYear]);

  const scheduleValidation = useMemo(
    () => validateWeekSchedule(weekClasses),
    [weekClasses]
  );
  const missingHeaderFields =
    !college ||
    !course ||
    !year ||
    !section ||
    !semester ||
    !academicYear ||
    !scheduleType;
  const canSaveSchedule = !missingHeaderFields && !scheduleValidation.hasErrors;
  const normalizedScheduleType = normalizeScheduleTypeValue(scheduleType);
  const currentScheduleDocId = useMemo(
    () =>
      buildScheduleDocId({
        college,
        course,
        year,
        section,
        semester,
        academicYear,
        scheduleType: normalizedScheduleType,
      }),
    [college, course, year, section, semester, academicYear, normalizedScheduleType]
  );
  const legacyScheduleDocId = useMemo(
    () =>
      buildLegacyScheduleDocId({
        course,
        year,
        section,
      }),
    [course, year, section]
  );

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
      setSemester(existingData.semester || SEMESTERS[0] || "");
      setAcademicYear(existingData.academicYear || DEFAULT_SCHOOL_YEAR);
      setScheduleType(normalizeScheduleTypeValue(existingData.scheduleType));
      setWeekClasses(existingData.weekSchedule || createEmptyWeek());
    }
  }, [existingData]);

  useEffect(() => {
    setCloneYear(String(year || "1"));
  }, [year]);

  useEffect(() => {
    setCloneSection(String(section || "A"));
  }, [section]);

  useEffect(() => {
    if (!repeatEditor) return;
    const list = weekClasses[repeatEditor.day] || [];
    if (!list[repeatEditor.index]) {
      setRepeatEditor(null);
      setRepeatTargets({});
    }
  }, [repeatEditor, weekClasses]);

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
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          subject: "",
          teacher: "",
          start: null,
          end: null,
          timeDisplay: "",
        },
      ],
    }));
  };

  const updateClass = (day, index, field, value) => {
    const copy = { ...weekClasses };
    copy[day][index][field] = value;

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

  const startRepeatClass = (day, index) => {
    if (
      repeatEditor &&
      repeatEditor.day === day &&
      repeatEditor.index === index
    ) {
      setRepeatEditor(null);
      setRepeatTargets({});
      return;
    }

    const initialTargets = {};
    daysOfWeek.forEach((dayName) => {
      if (dayName !== day) initialTargets[dayName] = false;
    });
    setRepeatTargets(initialTargets);
    setRepeatEditor({ day, index });
  };

  const toggleRepeatTarget = (dayName) => {
    setRepeatTargets((prev) => ({
      ...prev,
      [dayName]: !prev[dayName],
    }));
  };

  const cancelRepeatClass = () => {
    setRepeatEditor(null);
    setRepeatTargets({});
  };

  const applyRepeatClass = () => {
    if (!repeatEditor) return;
    const { day, index } = repeatEditor;
    const sourceClass = weekClasses[day]?.[index];
    if (!sourceClass) {
      cancelRepeatClass();
      return;
    }

    const selectedDays = daysOfWeek.filter(
      (dayName) => dayName !== day && Boolean(repeatTargets[dayName])
    );
    if (selectedDays.length === 0) {
      Alert.alert("No Days Selected", "Select at least one target day.");
      return;
    }

    const subject = cleanText(sourceClass.subject);
    const teacher = cleanText(sourceClass.teacher);
    const startMinutes = getMinutesFromIso(sourceClass.start);
    const endMinutes = getMinutesFromIso(sourceClass.end);
    if (!subject || !teacher || startMinutes === null || endMinutes === null) {
      Alert.alert(
        "Complete Class Details",
        "Fill subject, teacher, start, and end time before repeating this class."
      );
      return;
    }
    if (endMinutes <= startMinutes) {
      Alert.alert(
        "Invalid Time Range",
        "End time must be after start time before repeating."
      );
      return;
    }

    const classCopy = { ...sourceClass };
    setWeekClasses((prev) => {
      const next = { ...prev };
      selectedDays.forEach((targetDay) => {
        next[targetDay] = [...(next[targetDay] || []), { ...classCopy }];
      });
      return next;
    });

    cancelRepeatClass();
    Alert.alert(
      "Class Repeated",
      `Copied to ${selectedDays.join(", ")}.`
    );
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

  const buildSchedulePayload = (overrides = {}) => {
    const normalizedCollege = normalizeCollege(overrides.college ?? college);
    const normalizedCourse = normalizeCourse(overrides.course ?? course);
    const normalizedYear = String(overrides.year ?? year);
    const normalizedSection = String(overrides.section ?? section);
    const normalizedSemester = String(overrides.semester ?? semester);
    const normalizedAcademicYear = String(
      overrides.academicYear ?? academicYear
    );
    const normalizedType = normalizeScheduleTypeValue(
      overrides.scheduleType ?? scheduleType
    );

    return {
      college: normalizedCollege,
      course: normalizedCourse,
      year: normalizedYear,
      section: normalizedSection,
      semester: normalizedSemester,
      academicYear: normalizedAcademicYear,
      scheduleType: normalizedType,
      weekSchedule: overrides.weekSchedule ?? weekClasses,
    };
  };

  const saveSchedule = async () => {
    if (missingHeaderFields) {
      Alert.alert("Missing Details", "Fill all schedule details before saving.");
      return;
    }

    if (scheduleValidation.hasErrors) {
      Alert.alert(
        "Fix Schedule Issues",
        `Please fix ${scheduleValidation.totalIssues} class entr${
          scheduleValidation.totalIssues === 1 ? "y" : "ies"
        } with validation issues before saving.`
      );
      return;
    }

    try {
      const payload = buildSchedulePayload();
      const docId = currentScheduleDocId;
      const ref = doc(db, "schedules", docId);
      await setDoc(ref, payload);

      const previousId =
        typeof existingData?.id === "string" ? existingData.id : "";
      if (previousId && previousId !== docId) {
        try {
          await deleteDoc(doc(db, "schedules", previousId));
        } catch (cleanupError) {
          console.warn("Old schedule cleanup skipped:", cleanupError);
        }
      }

      Alert.alert("Success", "Schedule Saved!");
      router.back();
    } catch (err) {
      Alert.alert("Error", err.message);
    }
  };

  const performCloneSchedule = async (cloneDocId, clonePayload) => {
    await setDoc(doc(db, "schedules", cloneDocId), clonePayload);
    Alert.alert(
      "Cloned",
      `Schedule copied to Year ${clonePayload.year}, Section ${clonePayload.section}.`
    );
  };

  const cloneSchedule = async () => {
    if (missingHeaderFields) {
      Alert.alert("Missing Details", "Complete schedule details before cloning.");
      return;
    }
    if (scheduleValidation.hasErrors) {
      Alert.alert(
        "Fix Schedule Issues",
        "Resolve validation issues before cloning this schedule."
      );
      return;
    }

    const targetYear = String(cloneYear || "").trim();
    const targetSection = String(cloneSection || "").trim();
    if (!targetYear || !targetSection) {
      Alert.alert("Choose Target", "Select target year and section.");
      return;
    }
    if (targetYear === String(year) && targetSection === String(section)) {
      Alert.alert("Same Target", "Choose a different year or section to clone.");
      return;
    }

    try {
      const clonePayload = buildSchedulePayload({
        year: targetYear,
        section: targetSection,
      });
      const cloneDocId = buildScheduleDocId(clonePayload);
      const targetRef = doc(db, "schedules", cloneDocId);
      const existingSnap = await getDoc(targetRef);

      if (existingSnap.exists()) {
        Alert.alert(
          "Target Already Exists",
          `A schedule already exists for Year ${targetYear}, Section ${targetSection}. Overwrite it?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Overwrite",
              style: "destructive",
              onPress: async () => {
                try {
                  await performCloneSchedule(cloneDocId, clonePayload);
                } catch (overwriteErr) {
                  Alert.alert("Clone Failed", overwriteErr.message);
                }
              },
            },
          ]
        );
        return;
      }

      await performCloneSchedule(cloneDocId, clonePayload);
    } catch (err) {
      Alert.alert("Clone Failed", err.message);
    }
  };

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
              const targetId =
                (typeof existingData?.id === "string" && existingData.id) ||
                currentScheduleDocId ||
                legacyScheduleDocId;
              await deleteDoc(doc(db, "schedules", targetId));
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

      <ScheduleDetailsSection
        colors={colors}
        college={college}
        course={course}
        year={year}
        section={section}
        semester={semester}
        academicYear={academicYear}
        scheduleType={scheduleType}
        collegeOptions={COLLEGES}
        courseOptions={courseOptions}
        yearOptions={YEAR_LEVEL_OPTIONS}
        sectionOptions={sections}
        semesterOptions={SEMESTERS}
        academicYearOptions={academicYearOptions}
        onCollegeChange={handleCollegeChange}
        onCourseChange={setCourse}
        onYearChange={setYear}
        onSectionChange={setSection}
        onSemesterChange={setSemester}
        onScheduleTypeChange={setScheduleType}
        onAcademicYearChange={setAcademicYear}
        onShiftAcademicYear={(delta) =>
          setAcademicYear(getAdjacentAcademicYear(academicYear, delta))
        }
      />
      <ScheduleValidationAlerts
        colors={colors}
        missingHeaderFields={missingHeaderFields}
        scheduleValidation={scheduleValidation}
      />

      {/* DAYS */}
      {daysOfWeek.map((day) => (
        <ScheduleDaySection
          key={day}
          colors={colors}
          day={day}
          classes={weekClasses[day]}
          dayValidation={scheduleValidation.dayErrors[day] || {}}
          copiedDay={copiedDay}
          repeatEditor={repeatEditor}
          repeatTargets={repeatTargets}
          daysOfWeek={daysOfWeek}
          onAddClass={addClass}
          onCopyDay={copyDay}
          onPasteDay={pasteToDay}
          onUpdateClass={updateClass}
          onDeleteClass={deleteClass}
          onOpenTimePicker={setShowPicker}
          onStartRepeatClass={startRepeatClass}
          onToggleRepeatTarget={toggleRepeatTarget}
          onCancelRepeatClass={cancelRepeatClass}
          onApplyRepeatClass={applyRepeatClass}
        />
      ))}

      <ScheduleClonePanel
        colors={colors}
        cloneYear={cloneYear}
        cloneSection={cloneSection}
        yearOptions={YEAR_LEVEL_OPTIONS}
        sectionOptions={sections}
        sourceYear={year}
        sourceSection={section}
        onCloneYearChange={setCloneYear}
        onCloneSectionChange={setCloneSection}
        onClone={cloneSchedule}
      />

      {/* TIME PICKER */}
      {showPicker && (
        <DateTimePicker
          value={
            (() => {
              const selectedClass = weekClasses[showPicker.day]?.[showPicker.index];
              const currentValue = selectedClass?.[showPicker.field];
              const parsed = currentValue ? new Date(currentValue) : null;
              return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
            })()
          }
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
      <ScheduleActionBar
        colors={colors}
        canSaveSchedule={canSaveSchedule}
        showDelete={Boolean(existingData)}
        onSave={saveSchedule}
        onDelete={deleteSchedule}
      />
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
});


