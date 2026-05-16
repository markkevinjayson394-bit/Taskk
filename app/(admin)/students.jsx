import { Ionicons } from "@expo/vector-icons";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    LayoutAnimation,
    Platform,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../config/firebase";
import { getCollegeLabel, normalizeCollege } from "../../constants/academics";
import { COURSE_COLORS } from "../../constants/courseColors";
import { useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { normalizeYear } from "../../utils/scheduleHelpers";

const isFabric =
  typeof global !== "undefined" && Boolean(global.nativeFabricUIManager);

if (
  Platform.OS === "android" &&
  !isFabric &&
  UIManager.setLayoutAnimationEnabledExperimental
)
  UIManager.setLayoutAnimationEnabledExperimental(true);

const COLLEGE_ORDER = ["COT", "COE", "CED", "CME"];

const getCourseCode = (course) => {
  const text = String(course || "").trim();
  if (!text) return "COURSE";
  const match = text.match(/\(([^)]+)\)/);
  if (match?.[1]) return match[1];
  return text.split(" ").slice(0, 2).join(" ");
};

export default function StudentsScreen() {
  const { colors, isDark } = useTheme();
  const { isOnline } = useOffline();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [totalStudents, setTotalStudents] = useState(0);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!isOnline) {
      setGroups({});
      setTotalStudents(0);
      setOfflineUnavailable(true);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const q = query(collection(db, "users"), where("role", "==", "student"));
      const snap = await getDocs(q);
      const grouped = {};
      let total = 0;

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data) return;
        const info = data.studentInfo;
        if (!info || !info.college) return;
        const college = normalizeCollege(info.college) || "COT";
        const course = String(info.course || "Unknown Course").trim();
        const year = normalizeYear(info.year) || "-";
        const section = String(info.section || "-").trim();
        if (!grouped[college]) grouped[college] = {};
        if (!grouped[college][course]) grouped[college][course] = {};
        if (!grouped[college][course][year])
          grouped[college][course][year] = {};
        if (!grouped[college][course][year][section])
          grouped[college][course][year][section] = [];
        grouped[college][course][year][section].push({
          id: docSnap.id,
          fullName: data.fullName || "No Name",
          email: data.email || "",
          idNumber: info.idNumber || "",
          college,
          course,
          year,
          section,
        });
        total++;
      });

      // Sort alphabetically within sections
      Object.values(grouped).forEach((years) =>
        Object.values(years).forEach((courses) =>
          Object.values(courses).forEach((sections) =>
            Object.values(sections).forEach((students) =>
              students.sort((a, b) => a.fullName.localeCompare(b.fullName))
            )
          )
        )
      );

      COLLEGE_ORDER.forEach((collegeCode) => {
        if (!grouped[collegeCode]) grouped[collegeCode] = {};
      });

      setGroups(grouped);
      setTotalStudents(total);
      setOfflineUnavailable(false);
      setCollapsed((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const next = {};
        Object.entries(grouped).forEach(([collegeCode, courses]) => {
          next[collegeCode] = true;
          Object.entries(courses).forEach(([course, years]) => {
            next[`${collegeCode}-${course}`] = true;
            Object.entries(years).forEach(([year, sections]) => {
              next[`${collegeCode}-${course}-${year}`] = true;
              Object.keys(sections).forEach((section) => {
                next[`${collegeCode}-${course}-${year}-${section}`] = true;
              });
            });
          });
        });
        return next;
      });
    } catch (err) {
      console.warn("Failed to load students:", err);
      setOfflineUnavailable(!isOnline);
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
  Object.entries(groups).forEach(([college, courses]) =>
    Object.entries(courses).forEach(([course, years]) =>
      Object.entries(years).forEach(([year, sections]) =>
        Object.entries(sections).forEach(([section, students]) =>
          students.forEach((s) =>
            allStudents.push({
              ...s,
              college,
              course,
              year: String(year),
              section,
            })
          )
        )
      )
    )
  );

  const yearLevels = Array.from(
    new Set(allStudents.map((s) => String(s.year || "").trim()).filter(Boolean))
  ).length;
  const courseCount = Array.from(
    new Set(
      allStudents.map((s) => String(s.course || "").trim()).filter(Boolean)
    )
  ).length;
  const departmentTotals = Object.entries(groups)
    .map(([collegeCode, courses]) => {
      const total = Object.values(courses).reduce(
        (sum, years) =>
          sum +
          Object.values(years).reduce(
            (sumYear, sections) =>
              sumYear +
              Object.values(sections).reduce(
                (sumSec, students) => sumSec + students.length,
                0
              ),
            0
          ),
        0
      );
      return { collegeCode, label: getCollegeLabel(collegeCode), total };
    })
    .sort((a, b) => {
      const aIdx = COLLEGE_ORDER.indexOf(a.collegeCode);
      const bIdx = COLLEGE_ORDER.indexOf(b.collegeCode);
      if (aIdx !== -1 || bIdx !== -1)
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      return a.label.localeCompare(b.label);
    });

  const needle = search.trim().toLowerCase();
  const searchResults = needle
    ? allStudents.filter((s) => {
        const haystack = [
          s.fullName,
          s.email,
          String(s.idNumber || ""),
          String(s.college || ""), // code e.g. "COT"
          getCollegeLabel(s.college || ""), // label e.g. "College of Technology"
          String(s.course || ""),
          String(s.year || ""),
          String(s.section || ""),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
    : [];

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>
          Loading students...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#10b981" />
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: "#10b981", paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.headerCircle} />
        <View style={styles.headerCircle2} />
        <Text style={styles.headerSub}>Enrolled students</Text>
        <Text style={styles.headerTitle}>Students</Text>
        <View style={styles.headerStatRow}>
          <View
            style={[
              styles.headerPill,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <Ionicons name="people" size={13} color="#fff" />
            <Text style={styles.headerPillText}>
              {totalStudents} total students
            </Text>
          </View>
          <View
            style={[
              styles.headerPill,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <Ionicons name="school" size={13} color="#fff" />
            <Text style={styles.headerPillText}>{courseCount} courses</Text>
          </View>
          <View
            style={[
              styles.headerPill,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <Ionicons name="layers-outline" size={13} color="#fff" />
            <Text style={styles.headerPillText}>{yearLevels} year levels</Text>
          </View>
          <View
            style={[
              styles.headerPill,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <Ionicons name="business" size={13} color="#fff" />
            <Text style={styles.headerPillText}>
              {Object.keys(groups).length} departments
            </Text>
          </View>
        </View>

        {departmentTotals.length > 0 && (
          <View style={styles.deptRow}>
            {departmentTotals.map((dept) => (
              <View key={dept.collegeCode} style={styles.deptPill}>
                <Text style={styles.deptCode}>{dept.collegeCode}</Text>
                <Text style={styles.deptCount}>{dept.total}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Search bar */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: "rgba(255,255,255,0.2)" },
          ]}
        >
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.8)" />
          <TextInput
            placeholder="Search name, email, ID, year, section..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons
                name="close-circle"
                size={16}
                color="rgba(255,255,255,0.8)"
              />
            </TouchableOpacity>
          ) : null}
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
              load();
            }}
            colors={["#10b981"]}
            tintColor="#10b981"
          />
        }
        >
        {offlineUnavailable ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Ionicons
              name="cloud-offline-outline"
              size={32}
              color={colors.muted}
              style={{ marginBottom: 8 }}
            />
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              Student roster is unavailable offline
            </Text>
            <Text style={[styles.emptySubText, { color: colors.muted }]}>
              Reconnect to load the admin roster.
            </Text>
          </View>
        ) : null}

        {/* Search results */}
        {!offlineUnavailable && search.trim() ? (
          <>
            <Text style={[styles.searchResultLabel, { color: colors.muted }]}>
              {searchResults.length} result
              {searchResults.length !== 1 ? "s" : ""} for {search}
            </Text>
            {searchResults.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
                <Ionicons
                  name="search-outline"
                  size={32}
                  color={colors.muted}
                  style={{ marginBottom: 8 }}
                />
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  No students found
                </Text>
              </View>
            ) : (
              searchResults.map((s) => (
                <StudentRow
                  key={s.id}
                  student={s}
                  colors={colors}
                  isDark={isDark}
                  showMeta
                  courseColor={COURSE_COLORS[s.course] || colors.primary}
                />
              ))
            )}
          </>
        ) : !offlineUnavailable ? (
          /* Grouped tree */
          Object.entries(groups)
            .sort((a, b) => {
              const aIdx = COLLEGE_ORDER.indexOf(a[0]);
              const bIdx = COLLEGE_ORDER.indexOf(b[0]);
              if (aIdx !== -1 || bIdx !== -1)
                return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
              return a[0].localeCompare(b[0]);
            })
            .map(([collegeCode, courses]) => {
              const collegeTotal = Object.values(courses).reduce(
                (sum, years) =>
                  sum +
                  Object.values(years).reduce(
                    (sumYear, sections) =>
                      sumYear +
                      Object.values(sections).reduce(
                        (sumSec, students) => sumSec + students.length,
                        0
                      ),
                    0
                  ),
                0
              );
              const collegeKey = collegeCode;
              const isCollegeOpen = !collapsed[collegeKey];
              const collegeLabel = getCollegeLabel(collegeCode);

              return (
                <View
                  key={collegeCode}
                  style={[
                    styles.courseCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.primary + "44",
                    },
                  ]}
                >
                  {/* College header */}
                  <TouchableOpacity
                    style={styles.courseHeader}
                    onPress={() => toggleKey(collegeKey)}
                    accessibilityLabel={`Toggle ${collegeLabel} details`}
                    accessibilityHint="Expands or collapses the college section"
                  >
                    <View
                      style={[
                        styles.courseIconBox,
                        { backgroundColor: colors.primary + "18" },
                      ]}
                    >
                      <Ionicons
                        name="business"
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.courseName, { color: colors.text }]}>
                        {collegeLabel}
                      </Text>
                      <Text
                        style={[styles.courseCount, { color: colors.muted }]}
                      >
                        {collegeTotal} student{collegeTotal !== 1 ? "s" : ""}
                      </Text>
                    </View>
                    <Ionicons
                      name={isCollegeOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={colors.muted}
                    />
                  </TouchableOpacity>

                  {isCollegeOpen &&
                    Object.entries(courses).map(([course, years]) => {
                      const courseTotal = Object.values(years).reduce(
                        (sum, sections) =>
                          sum +
                          Object.values(sections).reduce(
                            (sumSec, students) => sumSec + students.length,
                            0
                          ),
                        0
                      );
                      const courseColor =
                        COURSE_COLORS[course] || colors.primary;
                      const courseKey = `${collegeCode}-${course}`;
                      const isCourseOpen = !collapsed[courseKey];

                      return (
                        <View
                          key={course}
                          style={[
                            styles.yearBlock,
                            { borderTopColor: colors.border },
                          ]}
                        >
                          <TouchableOpacity
                            style={styles.yearHeader}
                            onPress={() => toggleKey(courseKey)}
                            accessibilityLabel={`Toggle ${course} details`}
                            accessibilityHint="Expands or collapses the course section"
                          >
                            <View
                              style={[
                                styles.yearBadge,
                                { backgroundColor: courseColor + "18" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.yearBadgeText,
                                  { color: courseColor },
                                ]}
                              >
                                {getCourseCode(course)}
                              </Text>
                            </View>
                            <Text
                              style={[styles.yearLabel, { color: colors.text }]}
                            >
                              {course} - {courseTotal} student
                              {courseTotal !== 1 ? "s" : ""}
                            </Text>
                            <Ionicons
                              name={
                                isCourseOpen ? "chevron-up" : "chevron-down"
                              }
                              size={15}
                              color={colors.muted}
                            />
                          </TouchableOpacity>

                          {isCourseOpen &&
                            Object.entries(years).map(([year, sections]) => {
                              const yearTotal =
                                Object.values(sections).flat().length;
                              const yearKey = `${collegeCode}-${course}-${year}`;
                              const isYearOpen = !collapsed[yearKey];

                              return (
                                <View key={year} style={styles.sectionBlock}>
                                  <TouchableOpacity
                                    style={styles.sectionHeader}
                                    onPress={() => toggleKey(yearKey)}
                                    accessibilityLabel={`Toggle Year ${year} details`}
                                    accessibilityHint="Expands or collapses the year section"
                                  >
                                    <View
                                      style={[
                                        styles.secBadge,
                                        {
                                          backgroundColor: isDark
                                            ? "#1e293b"
                                            : "#f1f5f9",
                                        },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.secBadgeText,
                                          { color: courseColor },
                                        ]}
                                      >
                                        YEAR {year}
                                      </Text>
                                    </View>
                                    <Text
                                      style={[
                                        styles.secCount,
                                        { color: colors.muted },
                                      ]}
                                    >
                                      {yearTotal} student
                                      {yearTotal !== 1 ? "s" : ""}
                                    </Text>
                                    <Ionicons
                                      name={
                                        isYearOpen
                                          ? "chevron-up"
                                          : "chevron-down"
                                      }
                                      size={14}
                                      color={colors.muted}
                                    />
                                  </TouchableOpacity>

                                  {isYearOpen &&
                                    Object.entries(sections).map(
                                      ([section, students]) => {
                                        const secKey = `${collegeCode}-${course}-${year}-${section}`;
                                        const isSecOpen = !collapsed[secKey];
                                        return (
                                          <View
                                            key={section}
                                            style={styles.sectionBlock}
                                          >
                                            <TouchableOpacity
                                              style={styles.sectionHeader}
                                              onPress={() => toggleKey(secKey)}
                                              accessibilityLabel={`Toggle Section ${section} details`}
                                              accessibilityHint="Expands or collapses the section"
                                            >
                                              <View
                                                style={[
                                                  styles.secBadge,
                                                  {
                                                    backgroundColor: isDark
                                                      ? "#1e293b"
                                                      : "#f1f5f9",
                                                  },
                                                ]}
                                              >
                                                <Text
                                                  style={[
                                                    styles.secBadgeText,
                                                    { color: courseColor },
                                                  ]}
                                                >
                                                  SEC {section}
                                                </Text>
                                              </View>
                                              <Text
                                                style={[
                                                  styles.secCount,
                                                  { color: colors.muted },
                                                ]}
                                              >
                                                {students.length} student
                                                {students.length !== 1
                                                  ? "s"
                                                  : ""}
                                              </Text>
                                              <Ionicons
                                                name={
                                                  isSecOpen
                                                    ? "chevron-up"
                                                    : "chevron-down"
                                                }
                                                size={14}
                                                color={colors.muted}
                                              />
                                            </TouchableOpacity>

                                            {isSecOpen &&
                                              students.map((s) => (
                                                <StudentRow
                                                  key={s.id}
                                                  student={s}
                                                  colors={colors}
                                                  isDark={isDark}
                                                  courseColor={courseColor}
                                                />
                                              ))}
                                          </View>
                                        );
                                      }
                                    )}
                                </View>
                              );
                            })}
                        </View>
                      );
                    })}
                </View>
              );
            })
        ) : null}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

function StudentRow({ student, colors, isDark, courseColor, showMeta }) {
  return (
    <View
      style={[
        styles.studentRow,
        { backgroundColor: isDark ? "#1e293b" : "#f8fafc" },
      ]}
    >
      <View
        style={[styles.studentAvatar, { backgroundColor: courseColor + "20" }]}
      >
        <Text style={[styles.studentAvatarText, { color: courseColor }]}>
          {student.fullName?.charAt(0)?.toUpperCase() || "?"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.studentName, { color: colors.text }]}>
          {student.fullName}
        </Text>
        <Text style={[styles.studentEmail, { color: colors.muted }]}>
          {student.email}
        </Text>
        {showMeta && (
          <Text style={[styles.studentMeta, { color: courseColor }]}>
            {getCollegeLabel(student.college)} | {student.course} Y
            {student.year} Sec {student.section}
          </Text>
        )}
        {!showMeta && student.year && (
          <Text style={[styles.studentMetaSub, { color: colors.muted }]}>
            Year {student.year} Sec {student.section}
          </Text>
        )}
      </View>
      <Text style={[styles.studentId, { color: colors.muted }]}>
        #{student.idNumber}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14 },

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
  headerStatRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  headerPillText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  deptRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  deptPill: {
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deptCode: { color: "#fff", fontSize: 11, fontWeight: "800" },
  deptCount: { color: "#fff", fontSize: 11, fontWeight: "600" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },
  searchResultLabel: { fontSize: 13, marginBottom: 10 },

  listContainer: { padding: 14 },

  emptyBox: { alignItems: "center", padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 15, marginTop: 4 },
  emptySubText: { fontSize: 12, marginTop: 6, textAlign: "center" },

  courseCard: {
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
  },
  courseHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  courseIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  courseName: { fontSize: 15, fontWeight: "700" },
  courseCount: { fontSize: 12, marginTop: 1 },

  yearBlock: { borderTopWidth: 1 },
  yearHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  yearBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  yearBadgeText: { fontSize: 12, fontWeight: "700" },
  yearLabel: { flex: 1, fontSize: 13, fontWeight: "600" },

  sectionBlock: { paddingLeft: 14 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 14,
    paddingVertical: 8,
  },
  secBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  secBadgeText: { fontSize: 11, fontWeight: "700" },
  secCount: { flex: 1, fontSize: 12 },

  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    marginBottom: 5,
  },
  studentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  studentAvatarText: { fontSize: 15, fontWeight: "800" },
  studentName: { fontSize: 13, fontWeight: "600" },
  studentEmail: { fontSize: 11, marginTop: 1 },
  studentMeta: { fontSize: 11, marginTop: 1, fontWeight: "600" },
  studentMetaSub: { fontSize: 11, marginTop: 1, fontWeight: "500" },
  studentId: { fontSize: 11 },
});
