/**
 * profile.js
 *
 * Photo upload uses base64 in Firestore (Spark/free friendly).
 */
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { signOut } from "firebase/auth";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    updateDoc,
    where,
} from "firebase/firestore";
import { useCallback, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Image,
    Modal,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
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

const AVATAR_PLACEHOLDER =
  "https://cdn-icons-png.flaticon.com/512/149/149071.png";
const PRIORITY_COLORS = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const MAX_BASE64_KB = 80; // safety limit before saving to Firestore

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function ProfileScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const insets = useSafeAreaInsets();
  const { toggleTheme, colors, isDark } = useTheme();

  const [stats, setStats] = useState({ completed: 0, pending: 0, overdue: 0 });
  const [recentTasks, setRecentTasks] = useState([]);
  const [profile, setProfile] = useState({
    fullName: "",
    photoBase64: "",
    role: "student",
    studentInfo: null,
  });
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const hasLoaded = useRef(false);

  //  Auto-refresh on tab focus
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      if (!hasLoaded.current) {
        loadAll(true);
        hasLoaded.current = true;
      } else {
        fetchProfile();
        fetchStats();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const loadAll = async (animate = false) => {
    await Promise.all([fetchProfile(), fetchStats()]);
    setLoading(false);
    if (animate) {
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
    }
  };

  const fetchProfile = async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        setProfile(data);
        setEditName(data.fullName || "");
      }
    } catch (_err) {}
  };

  const fetchStats = async () => {
    if (!user) return;
    try {
      const q = query(
        collection(db, "assignments"),
        where("userId", "==", user.uid)
      );
      const snap = await getDocs(q);
      const now = new Date();
      let completed = 0,
        pending = 0,
        overdue = 0;
      const pending_tasks = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.completed) {
          completed++;
        } else {
          pending++;
          const due = data.dueAt?.toDate();
          if (due && due < now) overdue++;
          if (pending_tasks.length < 3)
            pending_tasks.push({ id: d.id, ...data });
        }
      });
      setStats({ completed, pending, overdue });
      setRecentTasks(pending_tasks);
    } catch (_err) {}
  };

  //  Photo picker  saves base64 to Firestore
  const pickFromGallery = async () => {
    if (!user) {
      Alert.alert("Session Expired", "Please log in again.");
      router.replace("/(auth)/login");
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Please allow access to your photo library."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4, // compress heavily so it fits in Firestore
      exif: false,
    });

    if (result.canceled) return;

    try {
      setUploading(true);

      // Read the picked image as base64
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Reject if too large for Firestore
      const sizeKB = (base64.length * 0.75) / 1024;
      if (sizeKB > MAX_BASE64_KB) {
        Alert.alert(
          "Photo Too Large",
          `Image is ${Math.round(sizeKB)} KB. Please crop more tightly or choose a smaller photo.`
        );
        return;
      }

      const dataUri = `data:image/jpeg;base64,${base64}`;

      await updateDoc(doc(db, "users", user.uid), { photoBase64: dataUri });
      setProfile((p) => ({ ...p, photoBase64: dataUri }));
      Alert.alert("Photo Updated", "Your profile picture has been saved.");
    } catch (_err) {
      Alert.alert("Failed", "Could not save photo. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  //  Save name
  const saveProfile = async () => {
    if (!user) {
      Alert.alert("Session Expired", "Please log in again.");
      router.replace("/(auth)/login");
      return;
    }

    if (!editName.trim()) {
      Alert.alert("Error", "Full name cannot be empty");
      return;
    }
    try {
      await updateDoc(doc(db, "users", user.uid), {
        fullName: editName.trim(),
      });
      setProfile((p) => ({ ...p, fullName: editName.trim() }));
      setEditVisible(false);
      Alert.alert("Saved", "Profile updated successfully");
    } catch (err) {
      console.warn("Failed to update profile:", err);
      Alert.alert("Error", "Failed to update profile");
    }
  };

  const logout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await signOut(auth);
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const progress =
    stats.completed + stats.pending === 0
      ? 0
      : Math.round((stats.completed / (stats.completed + stats.pending)) * 100);
  const si = profile.studentInfo;

  // Use base64 data URI if saved, otherwise show placeholder
  const avatarSource = profile.photoBase64
    ? { uri: profile.photoBase64 }
    : { uri: AVATAR_PLACEHOLDER };

  const updateId = Updates.updateId?.slice(0, 8) || "dev";
  const channel = Updates.channel || "local";

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.muted, marginTop: 10 }}>
          Loading profile...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
      {/*  HEADER BANNER  */}
      <View style={[styles.banner, { backgroundColor: colors.primary }]}>
        <View style={styles.bannerCircle} />
        <View style={styles.bannerCircle2} />
        <View style={styles.bannerTopRow}>
          <Text style={styles.greetingText}>{getGreeting()},</Text>
          <View style={styles.themeToggleRow}>
            <Text
              style={{
                color: "rgba(255,255,255,0.8)",
                fontSize: 12,
                marginRight: 6,
              }}
            >
              {isDark ? "Dark" : "Light"}
            </Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{
                false: "rgba(255,255,255,0.3)",
                true: "rgba(255,255,255,0.5)",
              }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={pickFromGallery}
            activeOpacity={0.85}
            disabled={uploading}
          >
            <View style={styles.avatarWrapper}>
              <Image source={avatarSource} style={styles.avatar} />
              <View
                style={[styles.editBadge, { backgroundColor: colors.card }]}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons
                    name="camera-outline"
                    size={14}
                    color={colors.primary}
                  />
                )}
              </View>
            </View>
          </TouchableOpacity>

          {uploading && (
            <Text
              style={{
                color: "rgba(255,255,255,0.8)",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Saving photo...
            </Text>
          )}

          <Text style={styles.nameText}>
            {profile.fullName || "CTU Danao Student"}
          </Text>
          <Text style={styles.emailText}>{user?.email}</Text>
          <View
            style={[
              styles.roleBadge,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Text style={styles.roleText}>
              {profile.role === "admin" ? "Admin" : "Student"}
            </Text>
          </View>
        </View>
      </View>

      <Animated.View
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
      >
        {/*  STUDENT INFO  */}
        {si && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Student Info
            </Text>
            <View style={styles.infoGrid}>
              <InfoChip label="ID" value={si.idNumber} colors={colors} />
              <InfoChip label="Course" value={si.course} colors={colors} />
              <InfoChip
                label="Year"
                value={`Year ${si.year}`}
                colors={colors}
              />
              <InfoChip
                label="Section"
                value={`Section ${si.section}`}
                colors={colors}
              />
              <InfoChip
                label="Semester"
                value={si.semester || ""}
                colors={colors}
              />
              <InfoChip
                label="Academic Year"
                value={si.academicYear || ""}
                colors={colors}
              />
              <InfoChip
                label="Schedule"
                value={si.scheduleType}
                colors={colors}
              />
              <InfoChip
                label="College"
                value={si.college ? getCollegeLabel(si.college) : ""}
                colors={colors}
              />
            </View>
          </View>
        )}

        {/*  PROGRESS  */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Task Progress
          </Text>
          <View style={styles.progressLabelRow}>
            <Text style={[styles.progressPercent, { color: colors.primary }]}>
              {progress}%
            </Text>
            <Text style={[styles.progressSub, { color: colors.muted }]}>
              completed
            </Text>
          </View>
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: isDark ? "#1e293b" : "#e2e8f0" },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress}%`,
                  backgroundColor:
                    progress === 100
                      ? "#22c55e"
                      : progress > 50
                        ? colors.primary
                        : "#ef4444",
                },
              ]}
            />
          </View>
          <View style={styles.statRow}>
            <StatBox
              value={stats.completed}
              label="Done"
              color="#22c55e"
              bg={isDark ? "#052e16" : "#f0fdf4"}
            />
            <StatBox
              value={stats.pending}
              label="Pending"
              color={colors.primary}
              bg={isDark ? "#0c1a3a" : "#eff6ff"}
            />
            <StatBox
              value={stats.overdue}
              label="Overdue"
              color="#ef4444"
              bg={isDark ? "#2d0a0a" : "#fef2f2"}
            />
          </View>
        </View>

        {/*  RECENT TASKS  */}
        {recentTasks.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Pending Tasks
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/(tabs)/assignments")}
              >
                <Text style={{ color: colors.primary, fontSize: 13 }}>
                  See all -&gt;
                </Text>
              </TouchableOpacity>
            </View>
            {recentTasks.map((task) => (
              <View
                key={task.id}
                style={[
                  styles.taskRow,
                  {
                    borderLeftColor:
                      PRIORITY_COLORS[task.priority] || colors.primary,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.taskTitle, { color: colors.text }]}>
                    {task.title}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {task.subject}
                  </Text>
                </View>
                <View
                  style={[
                    styles.priorityTag,
                    {
                      backgroundColor:
                        (PRIORITY_COLORS[task.priority] || colors.primary) +
                        "22",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: PRIORITY_COLORS[task.priority] || colors.muted,
                      fontSize: 11,
                      fontWeight: "bold",
                    }}
                  >
                    {(task.priority || "medium").toUpperCase()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/*  ACTIONS  */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Account
          </Text>
          <ActionRow
            icon="create-outline"
            label="Edit Name"
            onPress={() => setEditVisible(true)}
            colors={colors}
          />
          <ActionRow
            icon="camera-outline"
            label="Change Photo"
            onPress={pickFromGallery}
            colors={colors}
          />
          <ActionRow
            icon="notifications-outline"
            label="Notifications"
            onPress={() => router.push("/(tabs)/NotificationSettings")}
            colors={colors}
            highlight
          />
          <ActionRow
            icon="bar-chart-outline"
            label="App Usage Insights"
            onPress={() => router.push("/(tabs)/appUsage")}
            colors={colors}
          />
          <ActionRow
            icon="megaphone-outline"
            label="Announcements"
            onPress={() => router.push("/(tabs)/AnnouncementsScreen")}
            colors={colors}
          />
          <ActionRow
            icon="school-outline"
            label="Exam Prep Planner"
            onPress={() => router.push("/(tabs)/ExamPrepPlanner")}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ActionRow
            icon="log-out-outline"
            label="Logout"
            onPress={logout}
            colors={colors}
            danger
          />
        </View>

        {/*  VERSION CARD  */}
        <View
          style={[
            styles.versionCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.versionRow}>
            <View
              style={[
                styles.versionIconBox,
                { backgroundColor: colors.primary + "15" },
              ]}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.versionTitle, { color: colors.text }]}>
                CTU Time Manager
              </Text>
              <Text style={[styles.versionSub, { color: colors.muted }]}>
                Version {APP_VERSION}
              </Text>
            </View>
            <View
              style={[
                styles.versionBadge,
                {
                  backgroundColor:
                    channel === "production" ? "#22c55e20" : "#f59e0b20",
                },
              ]}
            >
              <Text
                style={[
                  styles.versionBadgeText,
                  {
                    color: channel === "production" ? "#16a34a" : "#b45309",
                  },
                ]}
              >
                {channel === "production"
                  ? "PROD"
                  : channel === "preview"
                    ? "PREVIEW"
                    : "DEV"}
              </Text>
            </View>
          </View>
          <View
            style={[styles.versionDivider, { backgroundColor: colors.border }]}
          />
          <View style={styles.versionDetailRow}>
            <View style={styles.versionDetail}>
              <Text
                style={[styles.versionDetailLabel, { color: colors.muted }]}
              >
                UPDATE ID
              </Text>
              <Text style={[styles.versionDetailValue, { color: colors.text }]}>
                {updateId}
              </Text>
            </View>
            <View style={styles.versionDetail}>
              <Text
                style={[styles.versionDetailLabel, { color: colors.muted }]}
              >
                CHANNEL
              </Text>
              <Text style={[styles.versionDetailValue, { color: colors.text }]}>
                {channel}
              </Text>
            </View>
            <View style={styles.versionDetail}>
              <Text
                style={[styles.versionDetailLabel, { color: colors.muted }]}
              >
                RUNTIME
              </Text>
              <Text style={[styles.versionDetailValue, { color: colors.text }]}>
                {APP_VERSION}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.footer, { color: colors.muted }]}>
          Cebu Technological University - Danao Campus
        </Text>
      </Animated.View>

      {/*  EDIT NAME MODAL  */}
      <Modal visible={editVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                paddingBottom: 40 + insets.bottom,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Edit Name
            </Text>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>
              Full Name
            </Text>
            <TextInput
              placeholder="Enter full name"
              placeholderTextColor={colors.muted}
              value={editName}
              onChangeText={setEditName}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              onPress={saveProfile}
            >
              <Text style={{ color: "#fff", fontWeight: "bold" }}>
                Save Changes
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setEditVisible(false)}
            >
              <Text style={{ color: colors.muted }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

//  Sub-components
function StatBox({ value, label, color, bg }) {
  return (
    <View style={[styles.statBox, { backgroundColor: bg }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </View>
  );
}
function InfoChip({ label, value, colors }) {
  if (!value) return null;
  return (
    <View style={[styles.infoChip, { backgroundColor: colors.background }]}>
      <Text
        style={{
          color: colors.muted,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.text,
          fontWeight: "600",
          fontSize: 13,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
function ActionRow({ icon, label, onPress, colors, danger, highlight }) {
  const iconColor = danger
    ? "#ef4444"
    : highlight
      ? colors.primary
      : colors.muted;
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon}
        size={18}
        color={iconColor}
        style={{ marginRight: 12 }}
      />
      <Text
        style={[
          styles.actionLabel,
          {
            color: danger
              ? "#ef4444"
              : highlight
                ? colors.primary
                : colors.text,
          },
          highlight && { fontWeight: "700" },
        ]}
      >
        {label}
      </Text>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={colors.muted}
        style={{ marginLeft: "auto" }}
      />
    </TouchableOpacity>
  );
}

//  Styles
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  banner: {
    paddingTop: 50,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },
  bannerCircle: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.08)",
    top: -44,
    right: -36,
  },
  bannerCircle2: {
    position: "absolute",
    width: 98,
    height: 98,
    borderRadius: 49,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 10,
    right: 64,
  },
  bannerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  greetingText: { color: "rgba(255,255,255,0.85)", fontSize: 15 },
  themeToggleRow: { flexDirection: "row", alignItems: "center" },
  avatarSection: { alignItems: "center" },
  avatarWrapper: { position: "relative", marginBottom: 12 },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.6)",
  },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    elevation: 3,
  },
  nameText: { color: "#fff", fontSize: 22, fontWeight: "bold" },
  emailText: { color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2 },
  roleBadge: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
  },
  roleText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  card: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 18,
    padding: 18,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 14 },
  cardTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: "46%",
    flex: 1,
  },

  progressLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 10,
  },
  progressPercent: { fontSize: 36, fontWeight: "800" },
  progressSub: { fontSize: 14, marginLeft: 6 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressFill: { height: "100%", borderRadius: 5 },
  statRow: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, borderRadius: 12, padding: 12, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textTransform: "uppercase",
  },

  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingLeft: 12,
    borderLeftWidth: 3,
    marginBottom: 8,
  },
  taskTitle: { fontWeight: "600", fontSize: 14 },
  priorityTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },

  divider: { height: 1, marginVertical: 8 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  actionLabel: { fontSize: 15 },

  versionCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },
  versionRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  versionIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  versionTitle: { fontSize: 14, fontWeight: "700" },
  versionSub: { fontSize: 12, marginTop: 2 },
  versionBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  versionBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  versionDivider: { height: 1, marginVertical: 12 },
  versionDetailRow: { flexDirection: "row", justifyContent: "space-between" },
  versionDetail: { alignItems: "center", flex: 1 },
  versionDetailLabel: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  versionDetailValue: { fontSize: 12, fontWeight: "600" },

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  inputLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    fontSize: 15,
  },
  saveBtn: {
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  cancelBtn: {
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
  },

  footer: { textAlign: "center", fontSize: 12, marginTop: 24, marginBottom: 8 },
});
