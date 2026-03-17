// FIX: added useFocusEffect so announcements refresh when navigating back to this screen
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router"; // FIX
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { useCallback, useRef, useState } from "react"; // FIX: useCallback
import {
  Animated,
  Image,
  LayoutAnimation,
  Platform,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyStateCard from "../../components/EmptyStateCard";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import {
  CACHE_KEYS,
  loadFromCache,
  saveToCache,
  useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const AUDIENCE_CONFIG = {
  all: { icon: "people", color: "#6366f1", label: "All Students" },
  year: { icon: "calendar", color: "#0ea5e9", label: "Your Year" },
  course: { icon: "school", color: "#10b981", label: "Your Section" },
};

export default function AnnouncementsScreen() {
  const { colors } = useTheme();
  const { isOnline, markSynced } = useOffline();
  const insets = useSafeAreaInsets();

  const [announcements, setAnnouncements] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);
  const PAGE_SIZE = 15;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasLoaded = useRef(false);

  // FIX: refresh announcements each time the screen is focused
  useFocusEffect(
    useCallback(() => {
      if (!hasLoaded.current) {
        loadAnnouncements();
        hasLoaded.current = true;
      } else if (isOnline) {
        loadAnnouncements(true); // silent refresh
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline])
  );

  const loadAnnouncements = async (silent = false) => {
    const user = auth.currentUser;
    if (!user) return;

    if (!isOnline) {
      const cached = await loadFromCache(CACHE_KEYS.announcements(user.uid));
      if (cached?.data) {
        setAnnouncements(cached.data);
        setFromCache(true);
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
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) return;
      const { college, course, year, section } =
        userSnap.data()?.studentInfo || {};

      const snap = await getDocs(
        query(collection(db, "announcements"), orderBy("createdAt", "desc"))
      );
      const list = snap.docs
        .map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
        }))
        .filter((a) => {
          if (a.audience === "all") return true;
          if (
            a.audience === "year" &&
            a.year === year &&
            (!a.college || a.college === college)
          )
            return true;
          if (
            a.audience === "course" &&
            a.course === course &&
            a.year === year &&
            (!a.college || a.college === college) &&
            a.section === section
          )
            return true;
          return false;
        });

      setAnnouncements(list);
      setFromCache(false);
      setVisibleCount(PAGE_SIZE);
      await saveToCache(CACHE_KEYS.announcements(user.uid), list);
      await markSynced();
    } catch (_err) {
      console.warn("Failed to load announcements:", _err);
      const cached = await loadFromCache(CACHE_KEYS.announcements(user.uid));
      if (cached?.data) {
        setAnnouncements(cached.data);
        setFromCache(true);
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

  const toggleExpand = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => (prev === id ? null : id));
  };

  const formatDate = (iso) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#6366f1" />
      <OfflineBanner />

      {/* Hero */}
      <View
        style={[
          styles.hero,
          { backgroundColor: "#6366f1", paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.heroCircle} />
        <View style={styles.heroCircle2} />
        <Text style={styles.heroSub}>From your admin</Text>
        <Text style={styles.heroTitle}>Announcements</Text>
        <View style={styles.heroPills}>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="megaphone" size={11} color="#fff" />
            <Text style={styles.heroPillText}>
              {announcements.length} notices
            </Text>
          </View>
          {fromCache && (
            <View
              style={[
                styles.heroPill,
                { backgroundColor: "rgba(239,68,68,0.3)" },
              ]}
            >
              <Ionicons name="cloud-offline-outline" size={11} color="#fff" />
              <Text style={styles.heroPillText}>Cached data</Text>
            </View>
          )}
        </View>
      </View>

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (isOnline) {
                setRefreshing(true);
                loadAnnouncements();
              }
            }}
            colors={["#6366f1"]}
            tintColor="#6366f1"
            enabled={isOnline}
          />
        }
      >
        {announcements.length === 0 ? (
          <EmptyStateCard
            title="No announcements"
            message={
              fromCache
                ? "Nothing was saved in your cache."
                : "Your admin has not posted anything yet."
            }
            icon="megaphone-outline"
            style={{ marginTop: 10 }}
          />
        ) : (
          announcements.slice(0, visibleCount).map((ann) => {
            const cfg = AUDIENCE_CONFIG[ann.audience] || AUDIENCE_CONFIG.all;
            const isOpen = expanded === ann.id;
            return (
              <TouchableOpacity
                key={ann.id}
                style={[
                  styles.annCard,
                  { backgroundColor: colors.card, borderLeftColor: cfg.color },
                ]}
                onPress={() => toggleExpand(ann.id)}
                activeOpacity={0.85}
                accessibilityLabel={`Toggle details for ${ann.title}`}
                accessibilityHint="Expands or collapses the announcement"
              >
                <View style={styles.annHeader}>
                  <View
                    style={[
                      styles.audienceBadge,
                      { backgroundColor: cfg.color + "18" },
                    ]}
                  >
                    <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                    <Text style={[styles.audienceText, { color: cfg.color }]}>
                      {cfg.label}
                    </Text>
                  </View>
                  <Ionicons
                    name={isOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                </View>
                <Text style={[styles.annTitle, { color: colors.text }]}>
                  {ann.title}
                </Text>
                <Text style={[styles.annDate, { color: colors.muted }]}>
                  {formatDate(ann.createdAt)}
                </Text>
                {isOpen && (
                  <View
                    style={[styles.annBody, { borderTopColor: colors.border }]}
                  >
                    <Text style={[styles.annMsg, { color: colors.text }]}>
                      {ann.message}
                    </Text>
                    {ann.imageBase64 ? (
                      <>
                        <Image
                          source={{ uri: ann.imageBase64 }}
                          style={styles.annImage}
                          resizeMode="cover"
                        />
                        {!!ann.imageNote && (
                          <Text
                            style={[
                              styles.annImageNote,
                              { color: colors.muted },
                            ]}
                          >
                            {ann.imageNote}
                          </Text>
                        )}
                      </>
                    ) : null}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
        {announcements.length > visibleCount && (
          <TouchableOpacity
            style={[
              styles.loadMoreBtn,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
            onPress={() => setVisibleCount((v) => v + PAGE_SIZE)}
          >
            <Text style={[styles.loadMoreText, { color: "#6366f1" }]}>
              Load more ({announcements.length - visibleCount} remaining)
            </Text>
          </TouchableOpacity>
        )}
        <View style={{ height: 32 }} />
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingTop: 52,
    paddingBottom: 20,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
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
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  heroTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 12,
  },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  listContainer: { padding: 16 },
  annCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  annHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  audienceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  audienceText: { fontSize: 11, fontWeight: "700" },
  annTitle: { fontSize: 14, fontWeight: "800", marginBottom: 3 },
  annDate: { fontSize: 11 },
  annBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  annMsg: { fontSize: 13, lineHeight: 21 },
  annImage: {
    width: "100%",
    height: 170,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 6,
  },
  annImageNote: { fontSize: 12, lineHeight: 18 },
  emptyBox: {
    alignItems: "center",
    padding: 48,
    borderRadius: 20,
    marginTop: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  emptyMsg: { fontSize: 13, textAlign: "center" },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 13, fontWeight: "700" },
});
