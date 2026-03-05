/**
 * schedule.js — with offline cache
 * OFFLINE: loads weekSchedule from AsyncStorage cache
 * ONLINE:  fetches from Firestore and saves to cache
 */

import { Ionicons } from "@expo/vector-icons";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  Animated, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import OfflineBanner from "../../components/OfflineBanner";
import { CACHE_KEYS, loadFromCache, saveToCache } from "../../context/OfflineContext";
import { useOffline } from "../../context/OfflineContext";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_COLORS = {
  Monday: "#6366f1", Tuesday: "#0ea5e9", Wednesday: "#10b981",
  Thursday: "#f59e0b", Friday: "#ef4444", Saturday: "#8b5cf6",
};

function getTodayName() {
  return new Date().toLocaleString("en-US", { weekday: "long" });
}
function formatTime(s) {
  if (!s) return "";
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return s;
}

export default function ViewSchedule() {
  const { colors, isDark } = useTheme();
  const { isOnline, markSynced } = useOffline();

  const [weekSchedule, setWeekSchedule] = useState({});
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [activeDay,    setActiveDay]    = useState(getTodayName());
  const [fromCache,    setFromCache]    = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { loadSchedule(); }, [isOnline]);

  const loadSchedule = async () => {
    const user = auth.currentUser;
    if (!user) return;

    if (!isOnline) {
      const cached = await loadFromCache(CACHE_KEYS.schedule(user.uid) + "_week");
      if (cached?.data) {
        setWeekSchedule(cached.data);
        setFromCache(true);
      }
      setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) return;
      const { course, year, section, scheduleType } = userSnap.data().studentInfo || {};

      const snap = await getDocs(query(
        collection(db, "schedules"),
        where("course", "==", course), where("year", "==", year),
        where("section", "==", section), where("scheduleType", "==", scheduleType),
      ));

      if (!snap.empty) {
        const ws = snap.docs[0].data().weekSchedule || {};
        setWeekSchedule(ws);
        // Save to its own cache key
        await saveToCache(CACHE_KEYS.schedule(user.uid) + "_week", ws);
        await markSynced();
        setFromCache(false);
      }
    } catch (err) {
      console.log("Schedule error:", err);
      // Fallback to cache
      const cached = await loadFromCache(CACHE_KEYS.schedule(user.uid) + "_week");
      if (cached?.data) { setWeekSchedule(cached.data); setFromCache(true); }
    } finally {
      setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  };

  const todayName   = getTodayName();
  const activeColor = DAY_COLORS[activeDay] || colors.primary;
  const dayClasses  = weekSchedule[activeDay] || [];

  const totalClasses = Object.values(weekSchedule)
    .reduce((acc, arr) => acc + (arr?.length || 0), 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: activeColor }]}>
        <View style={styles.heroCircle} />
        <Text style={styles.heroSub}>Your timetable</Text>
        <Text style={styles.heroTitle}>Schedule</Text>
        <View style={styles.heroPills}>
          <View style={[styles.heroPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Ionicons name="calendar" size={11} color="#fff" />
            <Text style={styles.heroPillText}>{totalClasses} classes/week</Text>
          </View>
          <View style={[styles.heroPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Ionicons name="time" size={11} color="#fff" />
            <Text style={styles.heroPillText}>{dayClasses.length} today</Text>
          </View>
          {fromCache && (
            <View style={[styles.heroPill, { backgroundColor: "rgba(239,68,68,0.3)" }]}>
              <Ionicons name="cloud-offline-outline" size={11} color="#fff" />
              <Text style={styles.heroPillText}>Cached</Text>
            </View>
          )}
        </View>
      </View>

      {/* Day tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={[styles.dayTabsScroll, { backgroundColor: colors.card }]}
        contentContainerStyle={styles.dayTabsContent}
      >
        {DAYS.map((day) => {
          const isActive = day === activeDay;
          const isToday  = day === todayName;
          const count    = weekSchedule[day]?.length || 0;
          const color    = DAY_COLORS[day];
          return (
            <TouchableOpacity key={day} onPress={() => setActiveDay(day)}
              style={[styles.dayTab, isActive && { borderBottomColor: color, borderBottomWidth: 2.5 }]}>
              {isToday && <View style={[styles.todayDot, { backgroundColor: color }]} />}
              <Text style={[styles.dayTabLabel, { color: isActive ? color : colors.muted }]}>
                {day.slice(0, 3)}
              </Text>
              {count > 0 && (
                <View style={[styles.dayCount, { backgroundColor: isActive ? color : colors.border }]}>
                  <Text style={[styles.dayCountText, { color: isActive ? "#fff" : colors.muted }]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Classes list */}
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={styles.classContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { if (isOnline) { setRefreshing(true); loadSchedule(); } }}
            colors={[activeColor]} tintColor={activeColor}
            enabled={isOnline}
          />
        }
      >
        {dayClasses.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📭</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No classes on {activeDay}</Text>
          </View>
        ) : (
          dayClasses.map((cls, i) => (
            <View key={i} style={[styles.classCard, { backgroundColor: colors.card, borderLeftColor: activeColor }]}>
              <View style={[styles.classIconBox, { backgroundColor: activeColor + "15" }]}>
                <Ionicons name="book" size={18} color={activeColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.classSubject, { color: colors.text }]}>{cls.subject}</Text>
                <Text style={[styles.classTime, { color: colors.muted }]}>
                  {cls.timeDisplay || `${formatTime(cls.start)} – ${formatTime(cls.end)}`}
                </Text>
                {cls.teacher ? (
                  <Text style={[styles.classTeacher, { color: colors.muted }]}>{cls.teacher}</Text>
                ) : null}
              </View>
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { paddingTop: 52, paddingBottom: 18, paddingHorizontal: 20, overflow: "hidden" },
  heroCircle: {
    position: "absolute", width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)", top: -40, right: -30,
  },
  heroSub:   { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800", marginBottom: 12 },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroPill:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  dayTabsScroll:   { maxHeight: 64 },
  dayTabsContent:  { paddingHorizontal: 10, alignItems: "center", gap: 4 },
  dayTab: { alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  todayDot: { width: 5, height: 5, borderRadius: 3, marginBottom: 3 },
  dayTabLabel: { fontSize: 12, fontWeight: "700" },
  dayCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 3 },
  dayCountText: { fontSize: 10, fontWeight: "700" },

  classContainer: { padding: 16 },
  classCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, padding: 14, marginBottom: 10, borderLeftWidth: 4,
    elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  classIconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  classSubject: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  classTime:    { fontSize: 12, marginBottom: 2 },
  classTeacher: { fontSize: 12 },

  emptyBox:  { alignItems: "center", padding: 48, borderRadius: 20, marginTop: 10 },
  emptyText: { fontSize: 15 },
});
