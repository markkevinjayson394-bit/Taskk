import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import {
  collection,
  getDocs,
  orderBy,
  query,
  updateDoc,
  doc,
} from "firebase/firestore";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../config/firebase";
import { getCollegeLabel } from "../../constants/academics";
import { warnIfDev } from "../../utils/logger";
import { useTheme } from "../../context/ThemeContext";

function formatDate(ts) {
  if (!ts) return "";
  try {
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (err) {
    warnIfDev("AdminReviews: failed to format review date:", err);
    return "";
  }
}

function renderStars(count, colors) {
  const list = [1, 2, 3, 4, 5];
  return (
    <View style={styles.starRow}>
      {list.map((value) => (
        <Ionicons
          key={value}
          name={value <= count ? "star" : "star-outline"}
          size={14}
          color={value <= count ? "#f59e0b" : colors.muted}
        />
      ))}
    </View>
  );
}

export default function AdminReviews() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingId, setMarkingId] = useState(null);

  const fetchReviews = async () => {
    try {
      const snap = await getDocs(
        query(collection(db, "reviews"), orderBy("createdAt", "desc"))
      );
      setReviews(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    } catch (err) {
      console.warn("Failed to load reviews:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchReviews();
    }, [])
  );

  const markRead = async (item) => {
    if (markingId) return; // prevent concurrent taps
    setMarkingId(item.id);
    try {
      await updateDoc(doc(db, "reviews", item.id), { status: "read" });
      setReviews((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, status: "read" } : r))
      );
    } catch (_err) {
      warnIfDev("AdminReviews: failed to mark review as read:", _err);
      Alert.alert("Update Failed", "Unable to update the review status.");
    } finally {
      setMarkingId(null);
    }
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
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.background}
      />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: 40 + insets.bottom,
          paddingTop: 16 + insets.top,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchReviews();
            }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <View style={[styles.header, { backgroundColor: colors.card }]}>
          <View
            style={[
              styles.headerIcon,
              { backgroundColor: `${colors.primary}1a` },
            ]}
          >
            <Ionicons name="chatbubble-ellipses" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Reviews
            </Text>
            <Text style={[styles.headerSub, { color: colors.muted }]}>
              {reviews.length} total
            </Text>
          </View>
        </View>

        {reviews.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={32}
              color={colors.muted}
            />
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              No reviews yet
            </Text>
          </View>
        ) : (
          reviews.map((item) => {
            const info = item.studentInfo || {};
            const metaParts = [
              info.course || "",
              info.year ? `Year ${info.year}` : "",
              info.section ? `Sec ${info.section}` : "",
            ].filter(Boolean);
            const collegeLabel = info.college
              ? getCollegeLabel(info.college)
              : "";
            const metaLabel = metaParts.join(" • ");
            return (
              <View
                key={item.id}
                style={[styles.card, { backgroundColor: colors.card }]}
              >
                <View style={styles.cardTop}>
                  <View>
                    <Text style={[styles.name, { color: colors.text }]}>
                      {item.fullName || "Student"}
                    </Text>
                    {metaLabel ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {metaLabel}
                      </Text>
                    ) : null}
                    {collegeLabel ? (
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {collegeLabel}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.statusBox}>
                    {renderStars(item.rating || 0, colors)}
                    <Text style={[styles.date, { color: colors.muted }]}>
                      {formatDate(item.createdAt)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.message, { color: colors.text }]}>
                  {item.message}
                </Text>
                {item.status !== "read" ? (
                  <TouchableOpacity
                    style={[
                      styles.markBtn,
                      { borderColor: colors.border, opacity: markingId === item.id ? 0.5 : 1 },
                    ]}
                    onPress={() => markRead(item)}
                    disabled={markingId === item.id}
                  >
                    <Text style={[styles.markText, { color: colors.muted }]}>
                      Mark as read
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.readBadge}>
                    <Text style={styles.readText}>Read</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  headerSub: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  emptyBox: {
    marginHorizontal: 16,
    padding: 30,
    borderRadius: 16,
    alignItems: "center",
    gap: 8,
  },
  emptyText: { fontSize: 14, fontWeight: "600" },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { fontSize: 14, fontWeight: "800" },
  meta: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  message: { fontSize: 13, lineHeight: 19 },
  starRow: { flexDirection: "row", gap: 2, alignSelf: "flex-end" },
  date: { fontSize: 10, fontWeight: "600", marginTop: 4 },
  statusBox: { alignItems: "flex-end" },
  markBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  markText: { fontSize: 11, fontWeight: "700" },
  readBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(34,197,94,0.15)",
  },
  readText: { fontSize: 11, fontWeight: "700", color: "#16a34a" },
});
