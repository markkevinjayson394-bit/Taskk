import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { doc, getDoc, serverTimestamp, addDoc, collection } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { auth, db } from "../../config/firebase";
import { getCollegeLabel } from "../../constants/academics";
import { useTheme } from "../../context/ThemeContext";
import { APP_VERSION } from "../../utils/version";

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);

  const loadProfile = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        setProfile(snap.data());
      }
    } catch (_err) {
      // silently fail; review can still be sent
    } finally {
      setLoadingProfile(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Session Expired", "Please log in again.");
      router.replace("/(auth)/login");
      return;
    }
    if (!rating) {
      Alert.alert("Missing Rating", "Please select a rating.");
      return;
    }
    if (!message.trim()) {
      Alert.alert("Missing Review", "Please write a short review.");
      return;
    }

    const studentInfo = profile?.studentInfo || {};
    try {
      setSubmitting(true);
      await addDoc(collection(db, "reviews"), {
        userId: user.uid,
        fullName: profile?.fullName || "",
        email: user.email || "",
        rating,
        message: message.trim(),
        createdAt: serverTimestamp(),
        status: "new",
        appVersion: APP_VERSION,
        studentInfo: {
          college: studentInfo.college || "",
          course: studentInfo.course || "",
          year: studentInfo.year || "",
          section: studentInfo.section || "",
        },
      });
      Alert.alert("Thank You!", "Your review was sent to the admin.");
      setRating(0);
      setMessage("");
    } catch (_err) {
      Alert.alert("Send Failed", "Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  const starRow = useMemo(() => [1, 2, 3, 4, 5], []);

  if (loadingProfile) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const studentInfo = profile?.studentInfo || {};
  const studentLabel = [
    studentInfo.course ? studentInfo.course : "",
    studentInfo.year ? `Year ${studentInfo.year}` : "",
    studentInfo.section ? `Sec ${studentInfo.section}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadProfile();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: colors.card }]}>
          <View
            style={[
              styles.heroIcon,
              { backgroundColor: `${colors.primary}1a` },
            ]}
          >
            <Ionicons name="chatbubble-ellipses" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.text }]}>
              Send a Review
            </Text>
            <Text style={[styles.heroSub, { color: colors.muted }]}>
              Your feedback goes directly to the admin.
            </Text>
            {studentLabel ? (
              <Text style={[styles.heroMeta, { color: colors.muted }]}>
                {studentLabel}
              </Text>
            ) : null}
            {studentInfo.college ? (
              <Text style={[styles.heroMeta, { color: colors.muted }]}>
                {getCollegeLabel(studentInfo.college)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.text }]}>Rating</Text>
          <View style={styles.starsRow}>
            {starRow.map((value) => {
              const filled = value <= rating;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setRating(value)}
                  style={styles.starBtn}
                  accessibilityLabel={`Rate ${value} star`}
                >
                  <Ionicons
                    name={filled ? "star" : "star-outline"}
                    size={28}
                    color={filled ? "#f59e0b" : colors.muted}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.helper, { color: colors.muted }]}>
            Tap a star to rate the app.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.text }]}>Your Review</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Tell us what you like or what needs improvement..."
            placeholderTextColor={colors.muted}
            multiline
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
          <Text style={[styles.helper, { color: colors.muted }]}>
            Keep it short and clear.
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 },
          ]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitText}>Send Review</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  hero: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontSize: 18, fontWeight: "800" },
  heroSub: { fontSize: 12, marginTop: 2, fontWeight: "600" },
  heroMeta: { fontSize: 11, marginTop: 2, fontWeight: "600" },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 14,
  },
  label: { fontSize: 13, fontWeight: "700", marginBottom: 10 },
  starsRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  starBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  helper: { fontSize: 11, fontWeight: "600", marginTop: 8 },
  submitBtn: {
    marginHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
