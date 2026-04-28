import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import {
  collection,
  deleteDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Animated,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";
import { clearLocalClassSchedule } from "../../utils/classScheduleCache";
const MENU = [
  {
    icon: "calendar",
    label: "Create Schedule",
    route: "/(admin)/createSchedule",
    color: "#6366f1",
    bg: "#6366f118",
    desc: "Add class timetables for sections",
  },
  {
    icon: "list",
    label: "View Schedules",
    route: "/(admin)/viewSchedules",
    color: "#0ea5e9",
    bg: "#0ea5e918",
    desc: "Manage all course schedules",
  },
  {
    icon: "people",
    label: "Students",
    route: "/(admin)/students",
    color: "#10b981",
    bg: "#10b98118",
    desc: "Browse enrolled students",
  },
  {
    icon: "megaphone",
    label: "Announcements",
    route: "/(admin)/announcements",
    color: "#f59e0b",
    bg: "#f59e0b18",
    desc: "Post notices to students",
  },
  {
    icon: "chatbubble-ellipses",
    label: "Reviews",
    route: "/(admin)/reviews",
    color: "#8b5cf6",
    bg: "#8b5cf618",
    desc: "Read student feedback",
  },
];
export default function AdminHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleTheme } = useTheme();
  const [stats, setStats] = useState({
    students: 0,
    schedules: 0,
    announcements: 0,
  });
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const cardAnims = useRef(MENU.map(() => new Animated.Value(0))).current;
  const hasLoaded = useRef(false);
  //  Auto-refresh when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (!hasLoaded.current) {
        loadStats(true);
        hasLoaded.current = true;
      } else {
        loadStats(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );
  const animateIn = (first = false) => {
    if (first) {
      fadeAnim.setValue(0);
      slideAnim.setValue(24);
      cardAnims.forEach((a) => a.setValue(0));
    }
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
    cardAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 400,
        delay: first ? 300 + i * 80 : 0,
        useNativeDriver: true,
      }).start();
    });
  };
  const loadStats = async (first = false) => {
    try {
      const [studentsSnap, schedulesSnap, annSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "student"))),
        getDocs(collection(db, "schedules")),
        getDocs(collection(db, "announcements")),
      ]);
      setStats({
        students: studentsSnap.size,
        schedules: schedulesSnap.size,
        announcements: annSnap.size,
      });
    } catch (err) {
      console.warn("Failed to load admin stats:", err);
    } finally {
      setRefreshing(false);
      animateIn(first);
    }
  };
  const onRefresh = () => {
    setRefreshing(true);
    loadStats(false);
  };
  const logout = () => {
    Alert.alert("Logout", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          const uid = auth.currentUser?.uid;
          if (uid) {
            await clearLocalClassSchedule(uid);
          }
          await signOut(auth);
          await AsyncStorage.removeItem("active_uid_v1");
          router.replace("/(auth)/login");
        },
      },
    ]);
  };
  const clearAnnouncements = async () => {
    try {
      const snap = await getDocs(collection(db, "announcements"));
      const count = snap.size;
      Alert.alert(
        "Clear All Announcements",
        `This will permanently delete ${count} announcement${count !== 1 ? "s" : ""}. Continue?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete All",
            style: "destructive",
            onPress: async () => {
              try {
                await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
                Alert.alert("Done", "All announcements cleared.");
                loadStats(false);
              } catch (err) {
                console.warn("Failed to clear announcements:", err);
                Alert.alert(
                  "Delete Failed",
                  "Could not clear announcements. Please try again."
                );
              }
            },
          },
        ]
      );
    } catch (err) {
      console.warn("Failed to fetch announcement count:", err);
    }
  };
  const STAT_CARDS = [
    {
      label: "Students",
      value: stats.students,
      icon: "people",
      color: "#10b981",
    },
    {
      label: "Schedules",
      value: stats.schedules,
      icon: "calendar",
      color: "#6366f1",
    },
    {
      label: "Announcements",
      value: stats.announcements,
      icon: "megaphone",
      color: "#f59e0b",
    },
  ];
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  //  Derived colors for visibility
  const textPrimary = colors.text;
  const textSecondary = isDark ? "#94a3b8" : "#64748b";
  const cardBg = colors.card;
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={isDark ? "#0f172a" : "#1e1b4b"}
      />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#6366f1"]}
            tintColor="#6366f1"
          />
        }
      >
        {/*  HERO  */}
        <View
          style={[
            styles.hero,
            {
              backgroundColor: isDark ? "#0f172a" : "#1e1b4b",
              paddingTop: insets.top + 16,
            },
          ]}
        >
          <View style={styles.heroDeco1} />
          <View style={styles.heroDeco2} />
          <View style={styles.heroDeco3} />
          {/* Top row */}
          <View style={styles.heroTopRow}>
            <View
              style={[
                styles.adminBadge,
                { backgroundColor: "rgba(99,102,241,0.3)" },
              ]}
            >
              <Ionicons name="shield-checkmark" size={11} color="#a5b4fc" />
              <Text style={styles.adminBadgeText}>ADMIN PANEL</Text>
            </View>
            <View style={styles.heroActions}>
              <TouchableOpacity
                style={[
                  styles.heroIconBtn,
                  { backgroundColor: "rgba(255,255,255,0.12)" },
                ]}
                onPress={toggleTheme}
              >
                <Ionicons
                  name={isDark ? "sunny" : "moon"}
                  size={16}
                  color="#fff"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.heroIconBtn,
                  { backgroundColor: "rgba(239,68,68,0.22)" },
                ]}
                onPress={logout}
              >
                <Ionicons name="log-out-outline" size={16} color="#fca5a5" />
              </TouchableOpacity>
            </View>
          </View>
          {/* Greeting */}
          <Text style={styles.heroDate}>{dateStr}</Text>
          <Text style={styles.heroGreeting}>{greeting},</Text>
          <Text style={styles.heroTitle}>Administrator </Text>
          {/* Stat pills */}
          <View style={styles.heroPills}>
            <View
              style={[
                styles.heroPill,
                { backgroundColor: "rgba(16,185,129,0.22)" },
              ]}
            >
              <Ionicons name="people" size={11} color="#6ee7b7" />
              <Text style={styles.heroPillText}>{stats.students} students</Text>
            </View>
            <View
              style={[
                styles.heroPill,
                { backgroundColor: "rgba(99,102,241,0.22)" },
              ]}
            >
              <Ionicons name="calendar" size={11} color="#a5b4fc" />
              <Text style={styles.heroPillText}>
                {stats.schedules} schedules
              </Text>
            </View>
            <View
              style={[
                styles.heroPill,
                { backgroundColor: "rgba(245,158,11,0.22)" },
              ]}
            >
              <Ionicons name="megaphone" size={11} color="#fcd34d" />
              <Text style={styles.heroPillText}>
                {stats.announcements} posts
              </Text>
            </View>
          </View>
        </View>
        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          {/*  STAT CARDS  */}
          <Text style={[styles.sectionTitle, { color: textPrimary }]}>
            Overview
          </Text>
          <View style={styles.statsGrid}>
            {STAT_CARDS.map((s) => (
              <View
                key={s.label}
                style={[
                  styles.statCard,
                  {
                    backgroundColor: cardBg,
                    borderColor: s.color + "35",
                  },
                ]}
              >
                <View
                  style={[
                    styles.statIconBox,
                    { backgroundColor: s.color + "1a" },
                  ]}
                >
                  <Ionicons name={s.icon} size={22} color={s.color} />
                </View>
                <Text style={[styles.statValue, { color: textPrimary }]}>
                  {s.value}
                </Text>
                <Text style={[styles.statLabel, { color: textSecondary }]}>
                  {s.label}
                </Text>
                <View
                  style={[styles.statAccent, { backgroundColor: s.color }]}
                />
              </View>
            ))}
          </View>
          {/*  QUICK ACTIONS  */}
          <Text style={[styles.sectionTitle, { color: textPrimary }]}>
            Quick Actions
          </Text>
          {MENU.map((item, i) => (
            <Animated.View
              key={item.route}
              style={{
                opacity: cardAnims[i],
                transform: [
                  {
                    translateX: cardAnims[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [40, 0],
                    }),
                  },
                ],
              }}
            >
              <TouchableOpacity
                style={[
                  styles.menuCard,
                  {
                    backgroundColor: cardBg,
                    borderColor: item.color + "28",
                  },
                ]}
                onPress={() => router.push(item.route)}
                activeOpacity={0.75}
              >
                <View
                  style={[styles.menuIconBox, { backgroundColor: item.bg }]}
                >
                  <Ionicons name={item.icon} size={24} color={item.color} />
                </View>
                <View style={styles.menuText}>
                  <Text style={[styles.menuLabel, { color: textPrimary }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.menuDesc, { color: textSecondary }]}>
                    {item.desc}
                  </Text>
                </View>
                <View
                  style={[
                    styles.menuArrow,
                    { backgroundColor: item.color + "18" },
                  ]}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={item.color}
                  />
                </View>
              </TouchableOpacity>
            </Animated.View>
          ))}
          {/*  DANGER ZONE  */}
          <Text
            style={[styles.sectionTitle, { color: textPrimary, marginTop: 8 }]}
          >
            Danger Zone
          </Text>
          <View
            style={[
              styles.dangerCard,
              {
                backgroundColor: cardBg,
                borderColor: "#ef444435",
              },
            ]}
          >
            <View style={styles.dangerRow}>
              <View
                style={[styles.dangerIconBox, { backgroundColor: "#ef444418" }]}
              >
                <Ionicons name="trash" size={22} color="#ef4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dangerTitle, { color: textPrimary }]}>
                  Clear All Announcements
                </Text>
                <Text style={[styles.dangerDesc, { color: textSecondary }]}>
                  Permanently deletes every announcement post
                </Text>
              </View>
              <TouchableOpacity
                style={styles.dangerBtn}
                onPress={clearAnnouncements}
              >
                <Text style={styles.dangerBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/*  Footer  */}
          <View style={styles.footer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={14}
              color={textSecondary}
            />
            <Text style={[styles.footerText, { color: textSecondary }]}>
              CTU Academic Task Manager Admin Panel
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingBottom: 40 },
  // Hero
  hero: {
    paddingTop: 56,
    paddingBottom: 28,
    paddingHorizontal: 22,
    overflow: "hidden",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroDeco1: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(99,102,241,0.12)",
    top: -60,
    right: -60,
  },
  heroDeco2: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(16,185,129,0.08)",
    bottom: -20,
    left: -30,
  },
  heroDeco3: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(245,158,11,0.1)",
    top: 40,
    left: 120,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  adminBadgeText: {
    color: "#a5b4fc",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  heroActions: { flexDirection: "row", gap: 8 },
  heroIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  heroDate: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  heroGreeting: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    fontWeight: "500",
  },
  heroTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  // Section titles
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 18,
  },
  // Stat grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 18,
  },
  statCard: {
    width: "47%",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  statIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  statValue: {
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
    marginBottom: 3,
  },
  statLabel: { fontSize: 13, fontWeight: "700" },
  statAccent: { position: "absolute", bottom: 0, left: 0, right: 0, height: 3 },
  // Menu cards
  menuCard: {
    marginHorizontal: 18,
    marginBottom: 10,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1.5,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
  },
  menuIconBox: {
    width: 50,
    height: 50,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  menuText: { flex: 1 },
  menuLabel: { fontSize: 15, fontWeight: "800", marginBottom: 3 },
  menuDesc: { fontSize: 12, fontWeight: "500", lineHeight: 17 },
  menuArrow: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  // Danger zone
  dangerCard: {
    marginHorizontal: 18,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
  },
  dangerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dangerIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  dangerTitle: { fontSize: 14, fontWeight: "800", marginBottom: 3 },
  dangerDesc: { fontSize: 12, fontWeight: "500" },
  dangerBtn: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  dangerBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 32,
  },
  footerText: { fontSize: 11, fontWeight: "500" },
});


