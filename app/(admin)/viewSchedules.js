import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, RefreshControl,
  ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

const COURSE_COLORS = {
  "BSIT":            "#6366f1",
  "BIT CompTech":    "#0ea5e9",
  "BIT Drafting":    "#f59e0b",
  "BIT Electronics": "#10b981",
  "BIT Electricity": "#ef4444",
  "BSMX":            "#8b5cf6",
};

export default function ViewSchedules() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const [schedules, setSchedules] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterCourse, setFilterCourse] = useState("All");
  const [filterYear, setFilterYear] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => { fetchSchedules(); }, []);

  useEffect(() => {
    let data = schedules;
    if (filterCourse !== "All") data = data.filter((s) => s.course === filterCourse);
    if (filterYear !== "All") data = data.filter((s) => s.year === filterYear);
    if (search.trim()) data = data.filter((s) =>
      `${s.course} ${s.year} ${s.section}`.toLowerCase().includes(search.toLowerCase())
    );
    setFiltered(data);
  }, [filterCourse, filterYear, search, schedules]);

  const fetchSchedules = async () => {
    try {
      const snap = await getDocs(collection(db, "schedules"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSchedules(data);
      setFiltered(data);
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = (id, label) => {
    Alert.alert("Delete Schedule", `Delete schedule for "${label}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await deleteDoc(doc(db, "schedules", id));
        fetchSchedules();
      }},
    ]);
  };

  // Count total classes across the week
  const countClasses = (weekSchedule) => {
    if (!weekSchedule) return 0;
    return Object.values(weekSchedule).reduce((acc, day) => acc + (day?.length || 0), 0);
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
      {/* Header */}
      <View style={[styles.header, { backgroundColor: "#0ea5e9" }]}>
        <View style={styles.headerCircle} />
        <Text style={styles.headerSub}>All class timetables</Text>
        <Text style={styles.headerTitle}>Schedules</Text>
        <View style={styles.headerPillRow}>
          <View style={[styles.headerPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
            <Ionicons name="calendar" size={13} color="#fff" />
            <Text style={styles.headerPillText}>{schedules.length} schedules</Text>
          </View>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: "rgba(255,255,255,0.25)" }]}
            onPress={() => router.push("/(admin)/createSchedule")}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>New</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchBar, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.8)" />
          <TextInput
            placeholder="Search course, year, section..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={search} onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
      </View>

      {/* Filters */}
      <View style={[styles.filterRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.filterBox, { borderRightColor: colors.border }]}>
          <Text style={[styles.filterLabel, { color: colors.muted }]}>Course</Text>
          <Picker selectedValue={filterCourse} onValueChange={setFilterCourse}
            style={[styles.picker, { color: colors.text }]}>
            <Picker.Item label="All" value="All" />
            {["BSIT","BIT CompTech","BIT Drafting","BIT Electronics","BIT Electricity","BSMX"].map((c) =>
              <Picker.Item key={c} label={c} value={c} />)}
          </Picker>
        </View>
        <View style={styles.filterBox}>
          <Text style={[styles.filterLabel, { color: colors.muted }]}>Year</Text>
          <Picker selectedValue={filterYear} onValueChange={setFilterYear}
            style={[styles.picker, { color: colors.text }]}>
            <Picker.Item label="All" value="All" />
            {["1","2","3","4"].map((y) => <Picker.Item key={y} label={`Year ${y}`} value={y} />)}
          </Picker>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchSchedules(); }}
            colors={["#0ea5e9"]} tintColor="#0ea5e9" />
        }
      >
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>📭</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No schedules found</Text>
          </View>
        ) : (
          filtered.map((item) => {
            const courseColor = COURSE_COLORS[item.course] || colors.primary;
            const classCount = countClasses(item.weekSchedule);
            const label = `${item.course} · Y${item.year} · Sec ${item.section}`;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.scheduleCard, { backgroundColor: colors.card, borderLeftColor: courseColor }]}
                onPress={() => router.push({ pathname: "/(admin)/createSchedule",
                  params: { scheduleData: JSON.stringify(item) } })}
                activeOpacity={0.8}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.cardIconBox, { backgroundColor: courseColor + "18" }]}>
                    <Ionicons name="calendar" size={20} color={courseColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>
                      {item.course}
                    </Text>
                    <Text style={[styles.cardSub, { color: colors.muted }]}>
                      Year {item.year} · Section {item.section}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.deleteBtn, { backgroundColor: colors.danger + "15" }]}
                    onPress={() => handleDelete(item.id, label)}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>

                <View style={styles.cardMeta}>
                  <View style={[styles.metaPill, { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }]}>
                    <Ionicons name="time-outline" size={11} color={colors.muted} />
                    <Text style={[styles.metaPillText, { color: colors.muted }]}>
                      {item.scheduleType || "—"}
                    </Text>
                  </View>
                  <View style={[styles.metaPill, { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }]}>
                    <Ionicons name="book-outline" size={11} color={colors.muted} />
                    <Text style={[styles.metaPillText, { color: colors.muted }]}>
                      {classCount} class{classCount !== 1 ? "es" : ""}/week
                    </Text>
                  </View>
                  {item.semester ? (
                    <View style={[styles.metaPill, { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }]}>
                      <Ionicons name="school-outline" size={11} color={colors.muted} />
                      <Text style={[styles.metaPillText, { color: colors.muted }]}>{item.semester}</Text>
                    </View>
                  ) : null}
                  <View style={styles.editHint}>
                    <Text style={[styles.editHintText, { color: courseColor }]}>Tap to edit</Text>
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
    paddingTop: 16, paddingBottom: 16, paddingHorizontal: 20, overflow: "hidden",
  },
  headerCircle: {
    position: "absolute", width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)", top: -30, right: -20,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 10 },
  headerPillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  headerPill: { flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  headerPillText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },

  filterRow: { flexDirection: "row", borderBottomWidth: 1 },
  filterBox: { flex: 1, paddingHorizontal: 10, borderRightWidth: 1 },
  filterLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase",
    letterSpacing: 0.5, paddingTop: 8, paddingLeft: 4 },
  picker: { height: 44 },

  listContainer: { padding: 14 },
  emptyBox: { alignItems: "center", padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 15, marginTop: 4 },

  scheduleCard: {
    borderRadius: 16, marginBottom: 10, borderLeftWidth: 4, overflow: "hidden",
    elevation: 2, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, paddingBottom: 8 },
  cardIconBox: { width: 42, height: 42, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  deleteBtn: { width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center" },

  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  metaPillText: { fontSize: 11 },
  editHint: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  editHintText: { fontSize: 11, fontWeight: "600" },
});