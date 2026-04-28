import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

export default function ScheduleBrowseHeader({
  topInset,
  search,
  onSearchChange,
  schedulesCount,
  filteredCount,
  onCreate,
}) {
  return (
    <View style={[styles.header, { backgroundColor: "#0ea5e9", paddingTop: topInset + 16 }]}>
      <View style={styles.headerCircle} />
      <View style={styles.headerCircle2} />
      <Text style={styles.headerSub}>All class timetables</Text>
      <Text style={styles.headerTitle}>Schedules</Text>
      <View style={styles.headerPillRow}>
        <View style={[styles.headerPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
          <Ionicons name="calendar" size={13} color="#fff" />
          <Text style={styles.headerPillText}>{schedulesCount} schedules</Text>
        </View>
        <View style={[styles.headerPill, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
          <Ionicons name="filter" size={13} color="#fff" />
          <Text style={styles.headerPillText}>{filteredCount} shown</Text>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: "rgba(255,255,255,0.25)" }]}
          onPress={onCreate}
          accessibilityLabel="Create new schedule"
          accessibilityHint="Opens the schedule creation screen"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.searchBar, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
        <Ionicons name="search" size={16} color="rgba(255,255,255,0.8)" />
        <TextInput
          placeholder="Search course, year, section..."
          placeholderTextColor="rgba(255,255,255,0.6)"
          value={search}
          onChangeText={onSearchChange}
          style={styles.searchInput}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
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
});
