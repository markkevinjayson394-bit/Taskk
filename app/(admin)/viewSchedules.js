import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../config/firebase";
import {
  COLLEGES,
  getCollegeLabel,
  getCoursesForCollege,
  normalizeCollege,
} from "../../constants/academics";
import { useTheme } from "../../context/ThemeContext";

const COURSE_COLORS = {
  BSIT: "#6366f1",
  "BIT CompTech": "#0ea5e9",
  "BIT Drafting": "#f59e0b",
  "BIT Electronics": "#10b981",
  "BIT Electrical": "#ef4444",
  "BIT Electricity": "#ef4444",
  BSMX: "#8b5cf6",
  BSMx: "#8b5cf6",
};
const DEFAULT_YEAR_OPTIONS = ["1", "2", "3", "4"];

const normalizeText = (value) => String(value ?? "").trim();

const normalizeYear = (value) => {
  const raw = normalizeText(value);
  if (!raw) return "";
  const onlyDigits = raw.replace(/[^\d]/g, "");
  return onlyDigits || raw;
};

export default function ViewSchedules() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [schedules, setSchedules] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterCollege, setFilterCollege] = useState("All");
  const [filterCourse, setFilterCourse] = useState("All");
  const [filterYear, setFilterYear] = useState("All");
  const [search, setSearch] = useState("");

  const collegeOptions = useMemo(
    () => COLLEGES.map((c) => ({ value: c.value, label: c.label })),
    []
  );

  const courseOptions = useMemo(() => {
    const seen = new Set();
    if (filterCollege !== "All") {
      getCoursesForCollege(filterCollege).forEach((c) => seen.add(c));
      schedules.forEach((item) => {
        if (normalizeCollege(item.college) === filterCollege && item.course) {
          seen.add(item.course);
        }
      });
    } else {
      Object.keys(COURSE_COLORS).forEach((c) => seen.add(c));
      schedules.forEach((item) => {
        if (item.course) seen.add(item.course);
      });
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [schedules, filterCollege]);

  const yearOptions = useMemo(() => {
    const seen = new Set(DEFAULT_YEAR_OPTIONS);
    schedules.forEach((item) => {
      if (item.year) seen.add(item.year);
    });
    return Array.from(seen).sort((a, b) => {
      const aNum = Number(a);
      const bNum = Number(b);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [schedules]);

  useEffect(() => {
    fetchSchedules();
  }, []);

  useEffect(() => {
    let data = schedules;
    if (filterCollege !== "All") {
      data = data.filter((s) => normalizeCollege(s.college) === filterCollege);
    }
    if (filterCourse !== "All") {
      data = data.filter(
        (s) => s.course.toLowerCase() === filterCourse.toLowerCase()
      );
    }
    if (filterYear !== "All") {
      data = data.filter((s) => String(s.year) === String(filterYear));
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      data = data.filter((s) =>
        `${s.collegeLabel || ""} ${s.course} year ${s.year} section ${s.section} ${s.scheduleType || ""}`
          .toLowerCase()
          .includes(needle)
      );
    }
    setFiltered(data);
  }, [filterCollege, filterCourse, filterYear, search, schedules]);

  useEffect(() => {
    if (
      filterCollege !== "All" &&
      !collegeOptions.some((c) => c.value === filterCollege)
    ) {
      setFilterCollege("All");
    }
  }, [collegeOptions, filterCollege]);

  useEffect(() => {
    if (filterCourse !== "All" && !courseOptions.includes(filterCourse)) {
      setFilterCourse("All");
    }
  }, [courseOptions, filterCourse]);

  useEffect(() => {
    if (filterYear !== "All" && !yearOptions.includes(filterYear)) {
      setFilterYear("All");
    }
  }, [yearOptions, filterYear]);

  const fetchSchedules = async () => {
    try {
      const snap = await getDocs(collection(db, "schedules"));
      const data = snap.docs
        .map((d) => {
          const raw = d.data() || {};
          const collegeCode = normalizeCollege(raw.college || "");
          const collegeLabel = getCollegeLabel(
            collegeCode || raw.college || ""
          );
          const course = normalizeText(raw.course) || "Unknown Course";
          const year = normalizeYear(raw.year) || "-";
          const section = normalizeText(raw.section) || "-";
          const academicYear = normalizeText(raw.academicYear) || "";
          return {
            id: d.id,
            ...raw,
            college: collegeCode || raw.college || "",
            collegeLabel: collegeLabel || "",
            course,
            year,
            section,
            academicYear,
            scheduleType: normalizeText(raw.scheduleType) || "-",
          };
        })
        .sort((a, b) => {
          const byCollege = String(a.collegeLabel || "").localeCompare(
            String(b.collegeLabel || "")
          );
          if (byCollege !== 0) return byCollege;
          const byCourse = a.course.localeCompare(b.course);
          if (byCourse !== 0) return byCourse;

          const aYear = Number(a.year);
          const bYear = Number(b.year);
          if (!Number.isNaN(aYear) && !Number.isNaN(bYear) && aYear !== bYear) {
            return aYear - bYear;
          }

          return a.section.localeCompare(b.section);
        });
      setSchedules(data);
      setFiltered(data);
    } catch (err) {
      console.warn("Failed to fetch schedules:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = (id, label) => {
    Alert.alert("Delete Schedule", `Delete schedule for "${label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "schedules", id));
            fetchSchedules();
          } catch (err) {
            console.warn("Failed to delete schedule:", err);
            Alert.alert(
              "Delete Failed",
              "Could not delete this schedule. Please try again."
            );
          }
        },
      },
    ]);
  };

  // Count total classes across the week
  const countClasses = (weekSchedule) => {
    if (!weekSchedule) return 0;
    return Object.values(weekSchedule).reduce(
      (acc, day) => acc + (day?.length || 0),
      0
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0ea5e9" />
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: "#0ea5e9", paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.headerCircle} />
        <View style={styles.headerCircle2} />
        <Text style={styles.headerSub}>All class timetables</Text>
        <Text style={styles.headerTitle}>Schedules</Text>
        <View style={styles.headerPillRow}>
          <View
            style={[
              styles.headerPill,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <Ionicons name="calendar" size={13} color="#fff" />
            <Text style={styles.headerPillText}>
              {schedules.length} schedules
            </Text>
          </View>
          <View
            style={[
              styles.headerPill,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <Ionicons name="filter" size={13} color="#fff" />
            <Text style={styles.headerPillText}>{filtered.length} shown</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.addBtn,
              { backgroundColor: "rgba(255,255,255,0.25)" },
            ]}
            onPress={() => router.push("/(admin)/createSchedule")}
            accessibilityLabel="Create new schedule"
            accessibilityHint="Opens the schedule creation screen"
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>New</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: "rgba(255,255,255,0.2)" },
          ]}
        >
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.8)" />
          <TextInput
            placeholder="Search course, year, section..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
      </View>

      {/* Filters */}
      <View
        style={[
          styles.filterRow,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.filterBox, { borderColor: colors.border }]}>
          <Text style={[styles.filterLabel, { color: colors.muted }]}>
            College
          </Text>
          <View style={styles.pickerWrap}>
            <Picker
              mode="dropdown"
              dropdownIconColor={colors.text}
              selectedValue={filterCollege}
              onValueChange={setFilterCollege}
              style={[styles.picker, { color: colors.text }]}
            >
              <Picker.Item label="All Colleges" value="All" />
              {collegeOptions.map((c) => (
                <Picker.Item key={c.value} label={c.label} value={c.value} />
              ))}
            </Picker>
          </View>
        </View>
        <View style={[styles.filterBox, { borderColor: colors.border }]}>
          <Text style={[styles.filterLabel, { color: colors.muted }]}>
            Course
          </Text>
          <View style={styles.pickerWrap}>
            <Picker
              mode="dropdown"
              dropdownIconColor={colors.text}
              selectedValue={filterCourse}
              onValueChange={setFilterCourse}
              style={[styles.picker, { color: colors.text }]}
            >
              <Picker.Item label="All Courses" value="All" />
              {courseOptions.map((c) => (
                <Picker.Item key={c} label={c} value={c} />
              ))}
            </Picker>
          </View>
        </View>
        <View style={[styles.filterBox, { borderColor: colors.border }]}>
          <Text style={[styles.filterLabel, { color: colors.muted }]}>
            Year
          </Text>
          <View style={styles.pickerWrap}>
            <Picker
              mode="dropdown"
              dropdownIconColor={colors.text}
              selectedValue={filterYear}
              onValueChange={setFilterYear}
              style={[styles.picker, { color: colors.text }]}
            >
              <Picker.Item label="All Years" value="All" />
              {yearOptions.map((y) => (
                <Picker.Item
                  key={y}
                  label={Number.isNaN(Number(y)) ? y : `Year ${y}`}
                  value={y}
                />
              ))}
            </Picker>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchSchedules();
            }}
            colors={["#0ea5e9"]}
            tintColor="#0ea5e9"
          />
        }
      >
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Ionicons
              name="calendar-clear-outline"
              size={34}
              color={colors.muted}
              style={{ marginBottom: 8 }}
            />
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              No schedules found
            </Text>
          </View>
        ) : (
          filtered.map((item) => {
            const courseColor = COURSE_COLORS[item.course] || colors.primary;
            const classCount = countClasses(item.weekSchedule);
            const label = `${item.course} - Y${item.year} - Sec ${item.section}`;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.scheduleCard,
                  {
                    backgroundColor: colors.card,
                    borderLeftColor: courseColor,
                  },
                ]}
                onPress={() =>
                  router.push({
                    pathname: "/(admin)/createSchedule",
                    params: { scheduleData: JSON.stringify(item) },
                  })
                }
                activeOpacity={0.8}
                accessibilityLabel={`Edit schedule for ${label}`}
                accessibilityHint="Opens the schedule editor"
              >
                <View style={styles.cardTop}>
                  <View
                    style={[
                      styles.cardIconBox,
                      { backgroundColor: courseColor + "18" },
                    ]}
                  >
                    <Ionicons name="calendar" size={20} color={courseColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>
                      {item.course}
                    </Text>
                    <Text style={[styles.cardSub, { color: colors.muted }]}>
                      Year {item.year} - Section {item.section}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.deleteBtn,
                      { backgroundColor: colors.danger + "15" },
                    ]}
                    onPress={() => handleDelete(item.id, label)}
                    accessibilityLabel={`Delete schedule for ${label}`}
                    accessibilityHint="Deletes this schedule permanently"
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={colors.danger}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.cardMeta}>
                  {item.collegeLabel ? (
                    <View
                      style={[
                        styles.metaPill,
                        { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                      ]}
                    >
                      <Ionicons
                        name="business-outline"
                        size={11}
                        color={colors.muted}
                      />
                      <Text
                        style={[styles.metaPillText, { color: colors.muted }]}
                      >
                        {item.collegeLabel}
                      </Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.metaPill,
                      { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                    ]}
                  >
                    <Ionicons
                      name="school-outline"
                      size={11}
                      color={colors.muted}
                    />
                    <Text
                      style={[styles.metaPillText, { color: colors.muted }]}
                    >
                      Year {item.year}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.metaPill,
                      { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                    ]}
                  >
                    <Ionicons
                      name="time-outline"
                      size={11}
                      color={colors.muted}
                    />
                    <Text
                      style={[styles.metaPillText, { color: colors.muted }]}
                    >
                      {item.scheduleType || "-"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.metaPill,
                      { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                    ]}
                  >
                    <Ionicons
                      name="book-outline"
                      size={11}
                      color={colors.muted}
                    />
                    <Text
                      style={[styles.metaPillText, { color: colors.muted }]}
                    >
                      {classCount} class{classCount !== 1 ? "es" : ""}/week
                    </Text>
                  </View>
                  {item.semester ? (
                    <View
                      style={[
                        styles.metaPill,
                        { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                      ]}
                    >
                      <Ionicons
                        name="school-outline"
                        size={11}
                        color={colors.muted}
                      />
                      <Text
                        style={[styles.metaPillText, { color: colors.muted }]}
                      >
                        {item.semester}
                      </Text>
                    </View>
                  ) : null}
                  {item.academicYear ? (
                    <View
                      style={[
                        styles.metaPill,
                        { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
                      ]}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={11}
                        color={colors.muted}
                      />
                      <Text
                        style={[styles.metaPillText, { color: colors.muted }]}
                      >
                        {item.academicYear}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.editHint}>
                    <Text style={[styles.editHintText, { color: courseColor }]}>
                      Tap to edit
                    </Text>
                    <Ionicons name="pencil" size={11} color={courseColor} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  header: {
    paddingTop: 52,
    paddingBottom: 18,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerCircle: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -30,
    right: -20,
  },
  headerCircle2: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
  },
  headerPillRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  headerPillText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  addBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },

  filterRow: {
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  filterBox: {
    flex: 1,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === "android" ? 8 : 10,
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: 8,
    paddingLeft: 4,
  },
  pickerWrap: {
    borderRadius: 10,
    overflow: Platform.OS === "android" ? "visible" : "hidden",
  },
  picker: {
    width: "100%",
    height: Platform.OS === "android" ? 52 : 44,
    marginTop: 0,
  },

  listContainer: { padding: 14 },
  emptyBox: { alignItems: "center", padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 15, marginTop: 4 },

  scheduleCard: {
    borderRadius: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    paddingBottom: 8,
  },
  cardIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },

  cardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metaPillText: { fontSize: 11 },
  editHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  editHintText: { fontSize: 11, fontWeight: "600" },
});
