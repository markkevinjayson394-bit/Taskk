import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  Alert, Animated, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import OfflineBanner from "../../components/OfflineBanner";
import { CACHE_KEYS, loadFromCache, saveToCache } from "../../context/OfflineContext";
import { useOffline } from "../../context/OfflineContext";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

const PRIORITY_COLOR  = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const PRIORITY_WEIGHT = { high: 1, medium: 2, low: 3 };
const TYPE_ICON = { assignment: "document-text", quiz: "help-circle", exam: "school", project: "construct" };
const FILTERS   = ["All","High","Medium","Low"];

const PENDING_UPDATES_KEY = (uid) => `pending_complete_${uid}`;

export default function Assignments() {
  const { colors, isDark } = useTheme();
  const { isOnline, markSynced } = useOffline();

  const [assignments,  setAssignments]  = useState([]);
  const [history,      setHistory]      = useState([]);
  const [showHistory,  setShowHistory]  = useState(false);
  const [filter,       setFilter]       = useState("All");
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [fromCache,    setFromCache]    = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { load(); }, [isOnline]);

  // When back online, flush any queued "complete" actions
  useEffect(() => {
    if (isOnline) flushPendingUpdates();
  }, [isOnline]);

  const load = async () => {
    const user = auth.currentUser;
    if (!user) return;

    if (!isOnline) {
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        const { pending, done } = cached.data;
        setAssignments(pending || []);
        setHistory(done || []);
        setFromCache(true);
      }
      setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();

      // Show how many updates are waiting
      const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(user.uid));
      const queue = raw ? JSON.parse(raw) : [];
      setPendingCount(queue.length);
      return;
    }

    try {
      const snap = await getDocs(query(
        collection(db, "assignments"), where("userId", "==", user.uid),
      ));
      const now = new Date();
      const all = snap.docs.map((d) => ({
        id: d.id, ...d.data(),
        dueAt: d.data().dueAt?.toDate?.()?.toISOString() ?? null,
        completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null,
      }));

      const pending = all.filter((a) => !a.completed).sort((a, b) => {
        const aDue = new Date(a.dueAt), bDue = new Date(b.dueAt);
        const aOver = aDue < now, bOver = bDue < now;
        if (aOver !== bOver) return aOver ? -1 : 1;
        return (PRIORITY_WEIGHT[a.priority] || 3) - (PRIORITY_WEIGHT[b.priority] || 3);
      });
      const done = all.filter((a) => a.completed)
        .sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt));

      setAssignments(pending);
      setHistory(done);
      setFromCache(false);

      await saveToCache(CACHE_KEYS.assignments(user.uid), { pending, done });
      await markSynced();
    } catch (err) {
      console.log("Assignments error:", err);
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        setAssignments(cached.data.pending || []);
        setHistory(cached.data.done || []);
        setFromCache(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  };

  // Mark complete — works offline by queuing the update
  const markComplete = async (id) => {
    const user = auth.currentUser;
    if (!user) return;

    // Optimistic UI update immediately
    setAssignments((prev) => prev.filter((a) => a.id !== id));
    const completed = assignments.find((a) => a.id === id);
    if (completed) {
      setHistory((prev) => [{ ...completed, completed: true }, ...prev]);
    }

    if (isOnline) {
      try {
        await updateDoc(doc(db, "assignments", id), {
          completed: true, completedAt: new Date(),
        });
        // Update cache
        const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
        if (cached?.data) {
          const updated = {
            pending: (cached.data.pending || []).filter((a) => a.id !== id),
            done: [{ ...completed, completed: true }, ...(cached.data.done || [])],
          };
          await saveToCache(CACHE_KEYS.assignments(user.uid), updated);
        }
      } catch (err) {
        Alert.alert("Error", "Could not mark complete. Will retry when online.");
      }
    } else {
      // Queue for later
      const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(user.uid));
      const queue = raw ? JSON.parse(raw) : [];
      queue.push({ id, action: "complete", queuedAt: new Date().toISOString() });
      await AsyncStorage.setItem(PENDING_UPDATES_KEY(user.uid), JSON.stringify(queue));
      setPendingCount(queue.length);
      Alert.alert(
        "Saved Offline",
        "Task marked as done. It will sync to the server when you're back online.",
        [{ text: "OK" }]
      );
    }
  };

  // Flush queued updates when back online
  const flushPendingUpdates = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(user.uid));
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (queue.length === 0) return;

    let flushed = 0;
    for (const item of queue) {
      try {
        if (item.action === "complete") {
          await updateDoc(doc(db, "assignments", item.id), {
            completed: true, completedAt: new Date(item.queuedAt),
          });
          flushed++;
        }
      } catch (err) {
        console.warn("Flush error:", err);
      }
    }

    await AsyncStorage.removeItem(PENDING_UPDATES_KEY(user.uid));
    setPendingCount(0);
    if (flushed > 0) {
      load(); // Refresh list after flush
    }
  };

  const filtered = filter === "All"
    ? assignments
    : assignments.filter((a) => a.priority?.toLowerCase() === filter.toLowerCase());

  const overdueCount = assignments.filter((a) => {
    const due = a.dueAt ? new Date(a.dueAt) : null;
    return due && due < new Date();
  }).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { if (isOnline) { setRefreshing(true); load(); } }}
            colors={["#f59e0b"]} tintColor="#f59e0b"
            enabled={isOnline}
          />
        }
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: "#f59e0b" }]}>
          <View style={styles.heroCircle} />
          <Text style={styles.heroSub}>Your tasks</Text>
          <Text style={styles.heroTitle}>Assignments</Text>

          {/* Pending sync banner */}
          {pendingCount > 0 && (
            <View style={styles.syncPill}>
              <Ionicons name="cloud-upload-outline" size={13} color="#fff" />
              <Text style={styles.syncPillText}>
                {pendingCount} update{pendingCount > 1 ? "s" : ""} waiting to sync
              </Text>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsRow}>
            {[
              { label: "Pending",  value: assignments.length, color: "#fff" },
              { label: "Done",     value: history.length,     color: "#fff" },
              { label: "Overdue",  value: overdueCount,       color: overdueCount > 0 ? "#fecaca" : "#fff" },
            ].map((s) => (
              <View key={s.label} style={[styles.statBox, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}>
            {FILTERS.map((f) => {
              const isActive = filter === f;
              const color = f === "High" ? "#ef4444" : f === "Medium" ? "#f59e0b" : f === "Low" ? "#22c55e" : "#6366f1";
              return (
                <TouchableOpacity key={f} onPress={() => setFilter(f)}
                  style={[styles.filterChip, { backgroundColor: isActive ? color : colors.card, borderColor: isActive ? color : colors.border }]}>
                  <Text style={[styles.filterText, { color: isActive ? "#fff" : colors.muted }]}>{f}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Task list */}
          {filtered.length === 0 ? (
            <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
              <Text style={{ fontSize: 36, marginBottom: 8 }}>✅</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {filter === "All" ? "No pending tasks!" : `No ${filter.toLowerCase()} priority tasks`}
              </Text>
            </View>
          ) : (
            filtered.map((a) => {
              const due   = a.dueAt ? new Date(a.dueAt) : null;
              const over  = due && due < new Date();
              const color = PRIORITY_COLOR[a.priority] || "#94a3b8";
              return (
                <View key={a.id} style={[styles.taskCard, { backgroundColor: colors.card, borderLeftColor: color }]}>
                  <View style={[styles.taskIconBox, { backgroundColor: color + "15" }]}>
                    <Ionicons name={TYPE_ICON[a.type] || "document-text"} size={18} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskTitle, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
                    <Text style={[styles.taskSub, { color: colors.muted }]}>{a.subject}</Text>
                    {due && (
                      <View style={[styles.duePill, { backgroundColor: over ? "#fef2f2" : (isDark ? "#1e293b" : "#f8fafc") }]}>
                        <Ionicons name="time-outline" size={11} color={over ? "#ef4444" : colors.muted} />
                        <Text style={[styles.dueText, { color: over ? "#ef4444" : colors.muted }]}>
                          {over ? "Overdue" : due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.doneBtn, { backgroundColor: color }]}
                    onPress={() => markComplete(a.id)}
                  >
                    <Ionicons name="checkmark" size={14} color="#fff" />
                    <Text style={styles.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          {/* History */}
          {history.length > 0 && (
            <>
              <TouchableOpacity style={styles.historyToggle}
                onPress={() => setShowHistory(v => !v)}>
                <Text style={[styles.historyToggleText, { color: colors.muted }]}>
                  {showHistory ? "▲" : "▼"} Completed ({history.length})
                </Text>
              </TouchableOpacity>
              {showHistory && history.map((a) => (
                <View key={a.id} style={[styles.historyRow, { backgroundColor: isDark ? "#1e293b" : "#f8fafc" }]}>
                  <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                  <Text style={[styles.historyText, { color: colors.muted }]} numberOfLines={1}>
                    {a.title}
                  </Text>
                </View>
              ))}
            </>
          )}

          <View style={{ height: 32 }} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingBottom: 32 },

  hero: { paddingTop: 52, paddingBottom: 24, paddingHorizontal: 20, overflow: "hidden" },
  heroCircle: {
    position: "absolute", width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)", top: -40, right: -30,
  },
  heroSub:   { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800", marginBottom: 12 },

  syncPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.2)", alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, marginBottom: 10,
  },
  syncPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  statsRow: { flexDirection: "row", gap: 8 },
  statBox:  { flex: 1, borderRadius: 12, padding: 10, alignItems: "center" },
  statValue:{ color: "#fff", fontSize: 20, fontWeight: "800" },
  statLabel:{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },

  filters: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5,
  },
  filterText: { fontSize: 12, fontWeight: "700" },

  taskCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginBottom: 10,
    borderRadius: 16, padding: 12, borderLeftWidth: 4,
    elevation: 2, shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4,
  },
  taskIconBox: { width: 42, height: 42, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  taskTitle:   { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  taskSub:     { fontSize: 11, marginBottom: 5 },
  duePill:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  dueText:     { fontSize: 10, fontWeight: "600" },
  doneBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  doneBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  historyToggle:    { marginHorizontal: 16, marginVertical: 12, alignItems: "center" },
  historyToggleText:{ fontSize: 13, fontWeight: "600" },
  historyRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 10 },
  historyText:      { flex: 1, fontSize: 13 },

  emptyBox:  { alignItems: "center", margin: 16, padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 14 },
});