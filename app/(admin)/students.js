import { Ionicons } from "@expo/vector-icons";
import {
  collection, getDocs, query, where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, LayoutAnimation,
  Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput,
  TouchableOpacity, UIManager, View,
} from "react-native";
import { db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental)
  UIManager.setLayoutAnimationEnabledExperimental(true);

const COURSE_COLORS = {
  "BSIT":            "#6366f1",
  "BIT CompTech":    "#0ea5e9",
  "BIT Drafting":    "#f59e0b",
  "BIT Electronics": "#10b981",
  "BIT Electricity": "#ef4444",
  "BSMX":            "#8b5cf6",
};

export default function StudentsScreen() {
  const { colors, isDark } = useTheme();
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [totalStudents, setTotalStudents] = useState(0);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const q = query(collection(db, "users"), where("role", "==", "student"));
      const snap = await getDocs(q);
      const grouped = {};
      let total = 0;

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const info = data.studentInfo;
        if (!info) return;
        const { course, year, section } = info;
        if (!grouped[course]) grouped[course] = {};
        if (!grouped[course][year]) grouped[course][year] = {};
        if (!grouped[course][year][section]) grouped[course][year][section] = [];
        grouped[course][year][section].push({
          id: docSnap.id,
          fullName: data.fullName || "No Name",
          email: data.email || "—",
          idNumber: info.idNumber || "—",
        });
        total++;
      });

      // Sort alphabetically within sections
      Object.values(grouped).forEach((years) =>
        Object.values(years).forEach((sections) =>
          Object.values(sections).forEach((students) =>
            students.sort((a, b) => a.fullName.localeCompare(b.fullName))
          )
        )
      );

      setGroups(grouped);
      setTotalStudents(total);
    } catch (err) {
      Alert.alert("Error", "Failed to load students.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const toggleKey = (key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Flatten all students for search
  const allStudents = [];
  Object.entries(groups).forEach(([course, years]) =>
    Object.entries(years).forEach(([year, sections]) =>
      Object.entries(sections).forEach(([section, students]) =>
        students.forEach((s) => allStudents.push({ ...s, course, year, section }))
      )
    )
  );

  const searchResults = search.trim()
    ? allStudents.filter((s) =>
        s.fullName.toLowerCase().includes(search.toLowerCase()) ||
        s.email.toLowerCase().includes(search.toLowerCase()) ||
        s.idNumber.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading students...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: "#10b981" }]}>
        <View style={styles.headerCircle} />
        <Text style={styles.headerSub}>Enrolled students</Text>
        <Text style={styles.headerTitle}>Students</Text>
        <View style={styles.headerStatRow}>
          <View style={[styles.headerPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
            <Ionicons name="people" size={13} color="#fff" />
            <Text style={styles.headerPillText}>{totalStudents} total students</Text>
          </View>
          <View style={[styles.headerPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
            <Ionicons name="school" size={13} color="#fff" />
            <Text style={styles.headerPillText}>{Object.keys(groups).length} courses</Text>
          </View>
        </View>

        {/* Search bar */}
        <View style={[styles.searchBar, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.8)" />
          <TextInput
            placeholder="Search by name, email or ID..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
            colors={["#10b981"]} tintColor="#10b981" />
        }
      >
        {/* Search results */}
        {search.trim() ? (
          <>
            <Text style={[styles.searchResultLabel, { color: colors.muted }]}>
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{search}"
            </Text>
            {searchResults.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
                <Text style={{ fontSize: 36, marginBottom: 8 }}>🔍</Text>
                <Text style={[styles.emptyText, { color: colors.muted }]}>No students found</Text>
              </View>
            ) : (
              searchResults.map((s) => (
                <StudentRow key={s.id} student={s} colors={colors} isDark={isDark}
                  showMeta courseColor={COURSE_COLORS[s.course] || colors.primary} />
              ))
            )}
          </>
        ) : (
          /* Grouped tree */
          Object.entries(groups).map(([course, years]) => {
            const courseTotal = Object.values(years).flatMap((y) => Object.values(y).flat()).length;
            const courseColor = COURSE_COLORS[course] || colors.primary;
            const courseKey = course;
            const isCourseOpen = !collapsed[courseKey];

            return (
              <View key={course} style={[styles.courseCard, { backgroundColor: colors.card,
                borderColor: courseColor + "44" }]}>
                {/* Course header */}
                <TouchableOpacity style={styles.courseHeader} onPress={() => toggleKey(courseKey)}>
                  <View style={[styles.courseIconBox, { backgroundColor: courseColor + "18" }]}>
                    <Ionicons name="school" size={18} color={courseColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.courseName, { color: colors.text }]}>{course}</Text>
                    <Text style={[styles.courseCount, { color: colors.muted }]}>
                      {courseTotal} student{courseTotal !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <Ionicons name={isCourseOpen ? "chevron-up" : "chevron-down"}
                    size={18} color={colors.muted} />
                </TouchableOpacity>

                {isCourseOpen && Object.entries(years).map(([year, sections]) => {
                  const yearTotal = Object.values(sections).flat().length;
                  const yearKey = `${course}-${year}`;
                  const isYearOpen = !collapsed[yearKey];

                  return (
                    <View key={year} style={[styles.yearBlock, { borderTopColor: colors.border }]}>
                      <TouchableOpacity style={styles.yearHeader} onPress={() => toggleKey(yearKey)}>
                        <View style={[styles.yearBadge, { backgroundColor: courseColor + "18" }]}>
                          <Text style={[styles.yearBadgeText, { color: courseColor }]}>Y{year}</Text>
                        </View>
                        <Text style={[styles.yearLabel, { color: colors.text }]}>
                          Year {year} — {yearTotal} student{yearTotal !== 1 ? "s" : ""}
                        </Text>
                        <Ionicons name={isYearOpen ? "chevron-up" : "chevron-down"}
                          size={15} color={colors.muted} />
                      </TouchableOpacity>

                      {isYearOpen && Object.entries(sections).map(([section, students]) => {
                        const secKey = `${course}-${year}-${section}`;
                        const isSecOpen = !collapsed[secKey];

                        return (
                          <View key={section} style={styles.sectionBlock}>
                            <TouchableOpacity style={styles.sectionHeader}
                              onPress={() => toggleKey(secKey)}>
                              <View style={[styles.secBadge, { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }]}>
                                <Text style={[styles.secBadgeText, { color: courseColor }]}>
                                  SEC {section}
                                </Text>
                              </View>
                              <Text style={[styles.secCount, { color: colors.muted }]}>
                                {students.length} student{students.length !== 1 ? "s" : ""}
                              </Text>
                              <Ionicons name={isSecOpen ? "chevron-up" : "chevron-down"}
                                size={14} color={colors.muted} />
                            </TouchableOpacity>

                            {isSecOpen && students.map((s) => (
                              <StudentRow key={s.id} student={s} colors={colors}
                                isDark={isDark} courseColor={courseColor} />
                            ))}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

function StudentRow({ student, colors, isDark, courseColor, showMeta }) {
  return (
    <View style={[styles.studentRow, { backgroundColor: isDark ? "#1e293b" : "#f8fafc" }]}>
      <View style={[styles.studentAvatar, { backgroundColor: courseColor + "20" }]}>
        <Text style={[styles.studentAvatarText, { color: courseColor }]}>
          {student.fullName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.studentName, { color: colors.text }]}>{student.fullName}</Text>
        <Text style={[styles.studentEmail, { color: colors.muted }]}>{student.email}</Text>
        {showMeta && (
          <Text style={[styles.studentMeta, { color: courseColor }]}>
            {student.course} · Y{student.year} · Sec {student.section}
          </Text>
        )}
      </View>
      <Text style={[styles.studentId, { color: colors.muted }]}>#{student.idNumber}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14 },

  header: {
    paddingTop: 16, paddingBottom: 16, paddingHorizontal: 20, overflow: "hidden",
  },
  headerCircle: {
    position: "absolute", width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)", top: -30, right: -20,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 10 },
  headerStatRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  headerPill: { flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  headerPillText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },
  searchResultLabel: { fontSize: 13, marginBottom: 10 },

  listContainer: { padding: 14 },

  emptyBox: { alignItems: "center", padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 15, marginTop: 4 },

  courseCard: {
    borderRadius: 18, marginBottom: 12, borderWidth: 1, overflow: "hidden",
    elevation: 2, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 5,
  },
  courseHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  courseIconBox: { width: 42, height: 42, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  courseName: { fontSize: 15, fontWeight: "700" },
  courseCount: { fontSize: 12, marginTop: 1 },

  yearBlock: { borderTopWidth: 1 },
  yearHeader: { flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10 },
  yearBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  yearBadgeText: { fontSize: 12, fontWeight: "700" },
  yearLabel: { flex: 1, fontSize: 13, fontWeight: "600" },

  sectionBlock: { paddingLeft: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8,
    paddingRight: 14, paddingVertical: 8 },
  secBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  secBadgeText: { fontSize: 11, fontWeight: "700" },
  secCount: { flex: 1, fontSize: 12 },

  studentRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, marginBottom: 5,
  },
  studentAvatar: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: "center", alignItems: "center",
  },
  studentAvatarText: { fontSize: 15, fontWeight: "800" },
  studentName: { fontSize: 13, fontWeight: "600" },
  studentEmail: { fontSize: 11, marginTop: 1 },
  studentMeta: { fontSize: 11, marginTop: 1, fontWeight: "600" },
  studentId: { fontSize: 11 },
});