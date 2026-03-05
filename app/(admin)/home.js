import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import {
  collection, deleteDoc, getDocs,
  query, where,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  Alert, Animated, RefreshControl,
  ScrollView, StyleSheet, Switch,
  Text, TouchableOpacity, View,
} from "react-native";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

const MENU = [
  { icon: "calendar",      label: "Create Schedule",  route: "/(admin)/createSchedule", color: "#6366f1", desc: "Add class timetables" },
  { icon: "list",          label: "View Schedules",   route: "/(admin)/viewSchedules",  color: "#0ea5e9", desc: "Manage all sections" },
  { icon: "people",        label: "Students",         route: "/(admin)/students",       color: "#10b981", desc: "Browse enrolled students" },
  { icon: "megaphone",     label: "Announcements",    route: "/(admin)/announcements",  color: "#f59e0b", desc: "Post to students" },
];

export default function AdminHome() {
  const router = useRouter();
  const { colors, theme, toggleTheme, isDark } = useTheme();

  const [stats, setStats] = useState({ students: 0, schedules: 0, announcements: 0, assignments: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => { loadStats(); }, []);

  const animateIn = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  };

  const loadStats = async () => {
    try {
      const [studentsSnap, schedulesSnap, annSnap, assignSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "student"))),
        getDocs(collection(db, "schedules")),
        getDocs(collection(db, "announcements")),
        getDocs(collection(db, "assignments")),
      ]);
      setStats({
        students: studentsSnap.size,
        schedules: schedulesSnap.size,
        announcements: annSnap.size,
        assignments: assignSnap.size,
      });
    } catch (err) {
      console.log("Stats error:", err);
    } finally {
      setRefreshing(false);
      animateIn();
    }
  };

  const onRefresh = () => { setRefreshing(true); loadStats(); };

  const logout = () => {
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: async () => {
        await signOut(auth); router.replace("/(auth)/login");
      }},
    ]);
  };

  const clearAnnouncements = () => {
    Alert.alert("Clear All Announcements", "This will permanently delete every announcement. Continue?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete All", style: "destructive", onPress: async () => {
        const snap = await getDocs(collection(db, "announcements"));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
        Alert.alert("✅ Done", "All announcements cleared.");
        loadStats();
      }},
    ]);
  };

  const STAT_CARDS = [
    { label: "Students",      value: stats.students,      icon: "people",        color: "#10b981" },
    { label: "Schedules",     value: stats.schedules,     icon: "calendar",      color: "#6366f1" },
    { label: "Announcements", value: stats.announcements, icon: "megaphone",     color: "#f59e0b" },
    { label: "Assignments",   value: stats.assignments,   icon: "document-text", color: "#0ea5e9" },
  ];

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
          colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      {/* ── HERO ── */}
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <View style={styles.heroCircle} />
        <View style={styles.heroCircle2} />
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.heroSub}>Welcome back</Text>
            <Text style={styles.heroTitle}>Admin Panel</Text>
          </View>
          <View style={styles.heroRight}>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginBottom: 4 }}>
              {isDark ? "🌙" : "☀️"}
            </Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.5)" }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Stat overview */}
        <View style={styles.statGrid}>
          {STAT_CARDS.map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Ionicons name={s.icon} size={18} color="#fff" />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

        {/* ── MANAGEMENT GRID ── */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Management</Text>
        <View style={styles.menuGrid}>
          {MENU.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.menuCard, { backgroundColor: colors.card }]}
              onPress={() => router.push(item.route)}
              activeOpacity={0.75}
            >
              <View style={[styles.menuIconBox, { backgroundColor: item.color + "18" }]}>
                <Ionicons name={item.icon} size={26} color={item.color} />
              </View>
              <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
              <Text style={[styles.menuDesc, { color: colors.muted }]}>{item.desc}</Text>
              <View style={[styles.menuArrow, { backgroundColor: item.color + "18" }]}>
                <Ionicons name="arrow-forward" size={14} color={item.color} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── DANGER ZONE ── */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Danger Zone</Text>
        <View style={[styles.dangerCard, { backgroundColor: colors.card, borderColor: colors.danger + "44" }]}>
          <View style={styles.dangerRow}>
            <View style={[styles.dangerIconBox, { backgroundColor: colors.danger + "15" }]}>
              <Ionicons name="trash" size={20} color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.dangerTitle, { color: colors.text }]}>Clear Announcements</Text>
              <Text style={[styles.dangerDesc, { color: colors.muted }]}>
                Permanently delete all {stats.announcements} announcements
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.dangerBtn, { backgroundColor: colors.danger }]}
              onPress={clearAnnouncements}
            >
              <Text style={styles.dangerBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── LOGOUT ── */}
        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: colors.danger }]}
          onPress={logout}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>Logout</Text>
        </TouchableOpacity>

        <View style={{ height: 20 }} />
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingBottom: 32 },

  hero: {
    paddingTop: 52, paddingBottom: 28, paddingHorizontal: 20,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: "hidden",
  },
  heroCircle: {
    position: "absolute", width: 200, height: 200, borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.06)", top: -60, right: -50,
  },
  heroCircle2: {
    position: "absolute", width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.05)", bottom: -20, left: 20,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  heroRight: { alignItems: "center" },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "800" },

  statGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statCard: {
    flex: 1, minWidth: "22%", borderRadius: 14,
    padding: 10, alignItems: "center", gap: 3,
  },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "800" },
  statLabel: { color: "rgba(255,255,255,0.75)", fontSize: 9, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.3, textAlign: "center" },

  sectionTitle: {
    fontSize: 14, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.6, marginTop: 24, marginBottom: 12, marginHorizontal: 18,
  },

  menuGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 10 },
  menuCard: {
    width: "47%", borderRadius: 20, padding: 16,
    elevation: 2, shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6,
  },
  menuIconBox: {
    width: 48, height: 48, borderRadius: 14,
    justifyContent: "center", alignItems: "center", marginBottom: 10,
  },
  menuLabel: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  menuDesc: { fontSize: 11, lineHeight: 15, marginBottom: 12 },
  menuArrow: {
    width: 28, height: 28, borderRadius: 8,
    justifyContent: "center", alignItems: "center", alignSelf: "flex-end",
  },

  dangerCard: {
    marginHorizontal: 18, borderRadius: 16, padding: 14, borderWidth: 1,
  },
  dangerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dangerIconBox: { width: 42, height: 42, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  dangerTitle: { fontSize: 14, fontWeight: "700" },
  dangerDesc: { fontSize: 12, marginTop: 2 },
  dangerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  dangerBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, margin: 18, padding: 14, borderRadius: 14, borderWidth: 1.5,
  },
  logoutText: { fontWeight: "700", fontSize: 15 },
});