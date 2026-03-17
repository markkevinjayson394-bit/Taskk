import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics"; // FIX: haptic feedback
import { useFocusEffect } from "expo-router"; // FIX: useFocusEffect
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react"; // FIX: useCallback
import {
  Alert,
  Animated,
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
import EmptyStateCard from "../../components/EmptyStateCard";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import { useNotifications } from "../../context/NotificationContext";
import {
  CACHE_KEYS,
  loadFromCache,
  saveToCache,
  useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { cancelAssignmentNotifications } from "../../utils/assignmentNotifications";

const PRIORITY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const PRIORITY_WEIGHT = { high: 1, medium: 2, low: 3 };
const TYPE_ICON = {
  assignment: "document-text",
  quiz: "help-circle",
  exam: "school",
  project: "construct",
};
const FILTERS = ["All", "High", "Medium", "Low"];
const PENDING_UPDATES_KEY = (uid) => `pending_complete_${uid}`;
const normalizePendingUpdates = (queue = []) => {
  const deduped = new Map();
  for (const item of queue) {
    if (!item?.id || !item?.action) continue;
    deduped.set(`${item.action}:${item.id}`, {
      id: item.id,
      action: item.action,
      queuedAt: item.queuedAt || new Date().toISOString(),
    });
  }
  return Array.from(deduped.values());
};

export default function Assignments() {
  const { colors, isDark } = useTheme();
  const {
    isOnline,
    markSynced,
    refreshPendingSyncSummary,
    pendingSyncSummary,
  } = useOffline();
  const { rescheduleAll } = useNotifications();
  const insets = useSafeAreaInsets();

  const [assignments, setAssignments] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [filter, setFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [visiblePending, setVisiblePending] = useState(15);
  const [visibleHistory, setVisibleHistory] = useState(15);
  const PAGE_SIZE = 15;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flushingRef = useRef(false);
  const stripArchived = (items = []) =>
    items.filter((item) => !item?.plannerArchived);

  const readPendingQueue = async (uid) => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_UPDATES_KEY(uid));
      if (!raw) return [];
      return normalizePendingUpdates(JSON.parse(raw));
    } catch (err) {
      console.warn("Error reading pending queue:", err);
      return [];
    }
  };

  const writePendingQueue = async (uid, queue) => {
    if (!queue.length) {
      await AsyncStorage.removeItem(PENDING_UPDATES_KEY(uid));
      await refreshPendingSyncSummary(uid);
      return;
    }
    await AsyncStorage.setItem(PENDING_UPDATES_KEY(uid), JSON.stringify(queue));
    await refreshPendingSyncSummary(uid);
  };

  const refreshPendingCount = async (uid) => {
    const queue = await readPendingQueue(uid);
    await writePendingQueue(uid, queue);
    setPendingCount(queue.length);
    return queue;
  };

  const queueCompletionUpdate = async (
    uid,
    id,
    queuedAt = new Date().toISOString()
  ) => {
    const queue = await readPendingQueue(uid);
    const next = normalizePendingUpdates([
      ...queue,
      { id, action: "complete", queuedAt },
    ]);
    await writePendingQueue(uid, next);
    setPendingCount(next.length);
  };

  // FIX: auto-refresh list when navigating back from createAssignment
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        if (isOnline) {
          await flushPendingUpdates();
        }
        if (active) {
          await load();
        }
      };
      run();
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline])
  );

  // When back online, flush any queued "complete" actions
  useEffect(() => {
    if (isOnline) {
      flushPendingUpdates().then(() => {
        load();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const load = async () => {
    const user = auth.currentUser;
    if (!user) return;

    await refreshPendingCount(user.uid);

    if (!isOnline) {
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        const { pending, done } = cached.data;
        setAssignments(stripArchived(pending || []));
        setHistory(stripArchived(done || []));
      }
      setRefreshing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
      return;
    }

    try {
      const snap = await getDocs(
        query(collection(db, "assignments"), where("userId", "==", user.uid))
      );
      const now = new Date();
      const all = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        dueAt: d.data().dueAt?.toDate?.()?.toISOString() ?? null,
        completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null,
      }));
      const visible = stripArchived(all);
      const pending = visible
        .filter((a) => !a.completed)
        .sort((a, b) => {
          const aDue = new Date(a.dueAt),
            bDue = new Date(b.dueAt);
          const aOver = aDue < now,
            bOver = bDue < now;
          if (aOver !== bOver) return aOver ? -1 : 1;
          return (
            (PRIORITY_WEIGHT[a.priority] || 3) -
            (PRIORITY_WEIGHT[b.priority] || 3)
          );
        });
      const done = visible
        .filter((a) => a.completed)
        .sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt));

      setAssignments(pending);
      setHistory(done);
      setVisiblePending(PAGE_SIZE);
      setVisibleHistory(PAGE_SIZE);
      await saveToCache(CACHE_KEYS.assignments(user.uid), { pending, done });
      await markSynced();
    } catch (_err) {
      const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
      if (cached?.data) {
        setAssignments(stripArchived(cached.data.pending || []));
        setHistory(stripArchived(cached.data.done || []));
      }
    } finally {
      setRefreshing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  // FIX: haptic feedback + mark complete
  const markComplete = async (id) => {
    const user = auth.currentUser;
    if (!user) return;

    // FIX: Haptic feedback when tapping Done
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Optimistic UI update - save completed item BEFORE filtering
    const completed = assignments.find((a) => a.id === id);
    setAssignments((prev) => prev.filter((a) => a.id !== id));
    if (completed)
      setHistory((prev) => [{ ...completed, completed: true }, ...prev]);
    if (completed) await cancelAssignmentNotifications(completed);

    if (isOnline) {
      try {
        await updateDoc(doc(db, "assignments", id), {
          completed: true,
          completedAt: new Date(),
        });
        await markSynced();
        await rescheduleAll();
        const cached = await loadFromCache(CACHE_KEYS.assignments(user.uid));
        if (cached?.data) {
          const updated = {
            pending: (cached.data.pending || []).filter((a) => a.id !== id),
            done: [
              { ...completed, completed: true },
              ...(cached.data.done || []),
            ],
          };
          await saveToCache(CACHE_KEYS.assignments(user.uid), updated);
        }
      } catch (err) {
        console.warn("Failed to mark assignment complete:", err);
        await queueCompletionUpdate(user.uid, id);
        Alert.alert(
          "Saved Offline",
          "Couldn't reach the server. This update will sync automatically."
        );
      }
    } else {
      await queueCompletionUpdate(user.uid, id);
      Alert.alert(
        "Saved Offline",
        "Task marked as done. It will sync when you're back online.",
        [{ text: "OK" }]
      );
    }
  };

  const flushPendingUpdates = async () => {
    if (flushingRef.current || !isOnline) return false;
    const user = auth.currentUser;
    if (!user) return false;

    flushingRef.current = true;
    try {
      const queue = await refreshPendingCount(user.uid);
      if (queue.length === 0) return false;

      const remaining = [];
      let flushed = 0;

      for (const item of queue) {
        try {
          if (item.action === "complete") {
            await updateDoc(doc(db, "assignments", item.id), {
              completed: true,
              completedAt: new Date(item.queuedAt),
            });
            flushed++;
          } else {
            remaining.push(item);
          }
        } catch (_err) {
          console.warn("Flush error:", _err);
          remaining.push(item);
        }
      }

      await writePendingQueue(user.uid, remaining);
      setPendingCount(remaining.length);

      if (flushed > 0) {
        await markSynced();
        await rescheduleAll();
        return true;
      }
      return false;
    } finally {
      flushingRef.current = false;
    }
  };

  const allFiltered =
    filter === "All"
      ? assignments
      : assignments.filter(
          (a) => a.priority?.toLowerCase() === filter.toLowerCase()
        );
  // Apply search filter
  const searchLower = searchQuery.toLowerCase().trim();
  const finalFiltered = searchLower
    ? allFiltered.filter(
        (a) =>
          a.title?.toLowerCase().includes(searchLower) ||
          a.subject?.toLowerCase().includes(searchLower)
      )
    : allFiltered;
  const filtered = finalFiltered.slice(0, visiblePending);
  const hasMorePending = finalFiltered.length > visiblePending;
  const visibleHistoryItems = history.slice(0, visibleHistory);
  const hasMoreHistory = history.length > visibleHistory;

  const overdueCount = assignments.filter((a) => {
    const due = a.dueAt ? new Date(a.dueAt) : null;
    return due && due < new Date();
  }).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#f59e0b" />
      <OfflineBanner />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (isOnline) {
                setRefreshing(true);
                load();
              }
            }}
            colors={["#f59e0b"]}
            tintColor="#f59e0b"
            enabled={isOnline}
          />
        }
      >
        {/* Hero */}
        <View
          style={[
            styles.hero,
            { backgroundColor: "#f59e0b", paddingTop: insets.top + 16 },
          ]}
        >
          <View style={styles.heroCircle} />
          <View style={styles.heroCircle2} />
          <Text style={styles.heroSub}>Your tasks</Text>
          <Text style={styles.heroTitle}>Tasks</Text>
          <Text style={styles.heroMeta}>
            Assignment | Quiz | Exam | Project
          </Text>
          {pendingCount > 0 && (
            <View style={styles.syncPill}>
              <Ionicons name="cloud-upload-outline" size={13} color="#fff" />
              <Text style={styles.syncPillText}>
                {pendingCount} update{pendingCount > 1 ? "s" : ""} waiting to
                sync
              </Text>
            </View>
          )}
          {Number(pendingSyncSummary?.create || 0) > 0 && (
            <View
              style={[
                styles.syncPill,
                { backgroundColor: "rgba(14,165,233,0.28)", marginTop: 6 },
              ]}
            >
              <Ionicons name="add-circle-outline" size={13} color="#fff" />
              <Text style={styles.syncPillText}>
                {pendingSyncSummary.create} new task
                {pendingSyncSummary.create > 1 ? "s" : ""} saved offline
              </Text>
            </View>
          )}
          <View style={styles.statsRow}>
            {[
              { label: "Pending", value: assignments.length, color: "#fff" },
              { label: "Done", value: history.length, color: "#fff" },
              {
                label: "Overdue",
                value: overdueCount,
                color: overdueCount > 0 ? "#fecaca" : "#fff",
              },
            ].map((s) => (
              <View
                key={s.label}
                style={[
                  styles.statBox,
                  { backgroundColor: "rgba(255,255,255,0.2)" },
                ]}
              >
                <Text style={[styles.statValue, { color: s.color }]}>
                  {s.value}
                </Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Search input */}
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="search"
              size={18}
              color={colors.muted}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search tasks..."
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {FILTERS.map((f) => {
              const isActive = filter === f;
              const color =
                f === "High"
                  ? "#ef4444"
                  : f === "Medium"
                    ? "#f59e0b"
                    : f === "Low"
                      ? "#22c55e"
                      : "#6366f1";
              return (
                <TouchableOpacity
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isActive ? color : colors.card,
                      borderColor: isActive ? color : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      { color: isActive ? "#fff" : colors.muted },
                    ]}
                  >
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Task list */}
          {filtered.length === 0 ? (
            <EmptyStateCard
              title={
                searchQuery
                  ? `No results for "${searchQuery}"`
                  : filter === "All"
                    ? "No pending tasks"
                    : `No ${filter.toLowerCase()} priority tasks`
              }
              message={
                searchQuery
                  ? "Try a different search term"
                  : "You are all caught up."
              }
              icon="checkmark-circle"
              style={{ margin: 16 }}
            />
          ) : (
            filtered.map((a) => {
              const due = a.dueAt ? new Date(a.dueAt) : null;
              const over = due && due < new Date();
              const color = PRIORITY_COLOR[a.priority] || "#94a3b8";
              return (
                <View
                  key={a.id}
                  style={[
                    styles.taskCard,
                    { backgroundColor: colors.card, borderLeftColor: color },
                  ]}
                >
                  <View
                    style={[
                      styles.taskIconBox,
                      { backgroundColor: color + "15" },
                    ]}
                  >
                    <Ionicons
                      name={TYPE_ICON[a.type] || "document-text"}
                      size={18}
                      color={color}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.taskTitle, { color: colors.text }]}
                      numberOfLines={2}
                    >
                      {a.title}
                    </Text>
                    <Text style={[styles.taskSub, { color: colors.muted }]}>
                      {a.subject}
                    </Text>
                    {due && (
                      <View
                        style={[
                          styles.duePill,
                          {
                            backgroundColor: over
                              ? "#fef2f2"
                              : isDark
                                ? "#1e293b"
                                : "#f8fafc",
                          },
                        ]}
                      >
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color={over ? "#ef4444" : colors.muted}
                        />
                        <Text
                          style={[
                            styles.dueText,
                            { color: over ? "#ef4444" : colors.muted },
                          ]}
                        >
                          {over
                            ? "Overdue"
                            : due.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* FIX: haptic fires inside markComplete */}
                  <TouchableOpacity
                    style={[styles.doneBtn, { backgroundColor: color }]}
                    onPress={() => markComplete(a.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="checkmark" size={14} color="#fff" />
                    <Text style={styles.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
          {hasMorePending && (
            <TouchableOpacity
              style={[styles.loadMoreBtn, { borderColor: colors.border }]}
              onPress={() => setVisiblePending((prev) => prev + PAGE_SIZE)}
            >
              <Text style={[styles.loadMoreText, { color: colors.text }]}>
                Load more tasks
              </Text>
            </TouchableOpacity>
          )}

          {/* History */}
          {history.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.historyToggle}
                onPress={() => setShowHistory((v) => !v)}
              >
                <Text
                  style={[styles.historyToggleText, { color: colors.muted }]}
                >
                  {showHistory ? "Hide" : "Show"} Completed ({history.length})
                </Text>
              </TouchableOpacity>
              {showHistory &&
                visibleHistoryItems.map((a) => (
                  <View
                    key={a.id}
                    style={[
                      styles.historyRow,
                      { backgroundColor: isDark ? "#1e293b" : "#f8fafc" },
                    ]}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color="#22c55e"
                    />
                    <Text
                      style={[styles.historyText, { color: colors.muted }]}
                      numberOfLines={1}
                    >
                      {a.title}
                    </Text>
                  </View>
                ))}
              {showHistory && hasMoreHistory && (
                <TouchableOpacity
                  style={[styles.loadMoreBtn, { borderColor: colors.border }]}
                  onPress={() => setVisibleHistory((prev) => prev + PAGE_SIZE)}
                >
                  <Text style={[styles.loadMoreText, { color: colors.text }]}>
                    Load more completed
                  </Text>
                </TouchableOpacity>
              )}
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
  hero: {
    paddingTop: 56,
    paddingBottom: 24,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroCircle: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -40,
    right: -30,
  },
  heroCircle2: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 58,
  },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 4,
  },
  heroMeta: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 12,
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 10,
  },
  syncPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, borderRadius: 12, padding: 10, alignItems: "center" },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "800" },
  statLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  filters: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  filterText: { fontSize: 12, fontWeight: "700" },
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 16,
    padding: 12,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  taskIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  taskTitle: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  taskSub: { fontSize: 11, marginBottom: 5 },
  duePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dueText: { fontSize: 10, fontWeight: "600" },
  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  doneBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  historyToggle: {
    marginHorizontal: 16,
    marginVertical: 12,
    alignItems: "center",
  },
  historyToggleText: { fontSize: 13, fontWeight: "600" },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    padding: 10,
    borderRadius: 10,
  },
  historyText: { flex: 1, fontSize: 13 },
  emptyBox: { alignItems: "center", margin: 16, padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 14 },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 13, fontWeight: "700" },
});
