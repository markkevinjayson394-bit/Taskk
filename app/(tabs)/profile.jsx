/**
 * profile.jsx - FIXED VERSION 2
 *
 * CHANGE: Now imports FileSystem from "expo-file-system/legacy" to support deprecated readAsStringAsync
 * Photo upload stores a compressed base64 avatar in Firestore (Spark/free friendly).
 * Offline support: profile, stats, and schedule meta are cached in AsyncStorage.
 * On network error, the screen loads from cache instead of showing an error.
 */

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy"; // ✅ FIX: Import from legacy API
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import LoadingState from "../../components/LoadingState";
import { auth, db } from "../../config/firebase";
import { getCollegeLabel } from "../../constants/academics";
import { CACHE_KEYS, loadFromCache } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { clearLocalClassSchedule } from "../../utils/classScheduleCache";
import { compressImageToBase64DataUri } from "../../utils/nativeImageCompression";
import { getTutorialRoute } from "../../utils/onboarding";
import { getTabBarContentBottomPadding } from "../../utils/tabBarLayout";
import { APP_VERSION } from "../../utils/version";

const AVATAR_PLACEHOLDER =
  "https://cdn-icons-png.flaticon.com/512/149/149071.png";
const PRIORITY_COLORS = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
const MAX_BASE64_KB = 80;

// Offline cache keys
const profileCacheKey = (uid) => `offline_profile_${uid}`;
const statsCacheKey = (uid) => `offline_stats_${uid}`;
const tasksCacheKey = (uid) => `offline_tasks_${uid}`;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function shouldIncludeInProfileTaskStats(task) {
  if (!task || typeof task !== "object") return false;
  if (task.source === "planner") return false;
  if (task.plannerArchived) return false;
  return true;
}

async function prepareProfilePhotoData(uri) {
  const maxBytes = MAX_BASE64_KB * 1024;

  try {
    // Try compression first
    const compressed = await compressImageToBase64DataUri(uri, maxBytes);

    // Validate the result
    if (
      compressed &&
      typeof compressed.dataUri === "string" &&
      compressed.dataUri.startsWith("data:")
    ) {
      return compressed;
    }
  } catch (compressionErr) {
    console.warn("Compression failed, trying fallback:", compressionErr);
  }

  // Fallback: manual base64 encoding using legacy API
  try {
    // ✅ FIX: Using legacy API which supports readAsStringAsync
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: "base64",
    });

    const sizeBytes = Math.round(base64.length * 0.75);
    if (sizeBytes > maxBytes) {
      throw new Error(
        "Photo is still too large. Try a tighter crop before uploading."
      );
    }

    const dataUri = `data:image/jpeg;base64,${base64}`;
    return { dataUri, sizeBytes };
  } catch (err) {
    throw new Error(
      `Failed to process photo: ${err.message || "Unknown error"}`
    );
  }
}

function resolvePhotoUploadError(err) {
  const code =
    typeof err?.code === "string" ? err.code.trim().toLowerCase() : "";
  const message =
    typeof err?.message === "string" ? err.message.trim().toLowerCase() : "";
  if (code.includes("permission-denied")) {
    return {
      title: "Permission Denied",
      body: "Profile updates are blocked by Firestore rules. Deploy the latest rules, then try again.",
    };
  }
  if (message.includes("too large")) {
    return {
      title: "Photo Too Large",
      body: "Try a tighter crop or choose a simpler photo.",
    };
  }
  return {
    title: "Failed",
    body: "Could not save photo. Please try again.",
  };
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
  const [scheduleMeta, setScheduleMeta] = useState({
    semester: "",
    academicYear: "",
  });
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const hasLoaded = useRef(false);

  // fetchProfile: try Firestore -> cache on success, fallback to cache offline
  const fetchProfile = useCallback(async () => {
    if (!user) return;
    const cacheKey = profileCacheKey(user.uid);
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        setProfile(data);
        setEditName(data.fullName || "");
        // Persist for offline use
        await AsyncStorage.setItem(cacheKey, JSON.stringify(data));
        setIsOffline(false);
      }
    } catch (_err) {
      // Network error - try cached data
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const data = JSON.parse(raw);
          setProfile(data);
          setEditName(data.fullName || "");
          setIsOffline(true);
        }
      } catch {
        // Cache also unavailable - silently keep defaults
      }
    }
  }, [user]);

  // fetchScheduleMeta: already uses loadFromCache, keep as-is
  const fetchScheduleMeta = useCallback(async () => {
    if (!user) return;
    try {
      const cached = await loadFromCache(
        CACHE_KEYS.schedule(user.uid) + "_meta"
      );
      if (cached?.data) {
        setScheduleMeta({
          semester: String(cached.data.semester || "").trim(),
          academicYear: String(cached.data.academicYear || "").trim(),
        });
      }
    } catch {
      // Silently ignore - schedule meta is non-critical
    }
  }, [user]);

  // fetchStats: try Firestore -> cache on success, fallback to cache offline
  const fetchStats = useCallback(async () => {
    if (!user) return;
    const sCacheKey = statsCacheKey(user.uid);
    const tCacheKey = tasksCacheKey(user.uid);
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
        if (!shouldIncludeInProfileTaskStats(data)) return;
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
      const newStats = { completed, pending, overdue };
      setStats(newStats);
      setRecentTasks(pending_tasks);
      // Persist for offline use
      await AsyncStorage.setItem(sCacheKey, JSON.stringify(newStats));
      await AsyncStorage.setItem(tCacheKey, JSON.stringify(pending_tasks));
    } catch (_err) {
      // Network error - try cached data
      try {
        const rawStats = await AsyncStorage.getItem(sCacheKey);
        const rawTasks = await AsyncStorage.getItem(tCacheKey);
        if (rawStats) setStats(JSON.parse(rawStats));
        if (rawTasks) setRecentTasks(JSON.parse(rawTasks));
        setIsOffline(true);
      } catch {
        // Cache also unavailable - keep defaults
      }
    }
  }, [user]);

  const loadAll = useCallback(
    async (animate = false) => {
      await Promise.all([fetchProfile(), fetchStats(), fetchScheduleMeta()]);
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
    },
    [fadeAnim, fetchProfile, fetchScheduleMeta, fetchStats, slideAnim]
  );

  // Auto-refresh on tab focus
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      if (!hasLoaded.current) {
        loadAll(true);
        hasLoaded.current = true;
      } else {
        fetchProfile();
        fetchStats();
        fetchScheduleMeta();
      }
    }, [user, loadAll, fetchProfile, fetchStats, fetchScheduleMeta])
  );

  // Photo picker - saves base64 to Firestore
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
      quality: 0.4,
      exif: false,
    });

    if (result.canceled) return;

    try {
      setUploading(true);

      // Prepare photo with full error handling
      const photoData = await prepareProfilePhotoData(result.assets[0].uri);

      // Validate before uploading
      if (!photoData?.dataUri || typeof photoData.dataUri !== "string") {
        throw new Error("Invalid photo data");
      }

      // Upload to Firestore
      await setDoc(
        doc(db, "users", user.uid),
        { photoBase64: photoData.dataUri },
        { merge: true }
      );

      // Update local state and cache
      setProfile((p) => {
        const updated = { ...p, photoBase64: photoData.dataUri };
        AsyncStorage.setItem(
          profileCacheKey(user.uid),
          JSON.stringify(updated)
        ).catch((cacheErr) => {
          console.warn("Failed to cache photo:", cacheErr);
        });
        return updated;
      });
      Alert.alert("Photo Updated", "Your profile picture has been saved.");
    } catch (err) {
      console.error("Failed to save profile photo:", err);
      const errorInfo = resolvePhotoUploadError(err);
      Alert.alert(errorInfo.title, errorInfo.body);
    } finally {
      setUploading(false);
    }
  };

  // Save name
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
      await setDoc(
        doc(db, "users", user.uid),
        { fullName: editName.trim() },
        { merge: true }
      );
      setProfile((p) => {
        const updated = { ...p, fullName: editName.trim() };
        AsyncStorage.setItem(
          profileCacheKey(user.uid),
          JSON.stringify(updated)
        );
        return updated;
      });
      setEditVisible(false);
      Alert.alert("Saved", "Profile updated successfully");
    } catch (err) {
      console.warn("Failed to update profile:", err);
      Alert.alert("Error", "Failed to update profile. Check your connection.");
    }
  };

  const logout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
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

  const progress =
    stats.completed + stats.pending === 0
      ? 0
      : Math.round((stats.completed / (stats.completed + stats.pending)) * 100);

  const si = profile.studentInfo;
  const semesterValue = si?.semester || scheduleMeta.semester || "";
  const academicYearValue = si?.academicYear || scheduleMeta.academicYear || "";

  const avatarSource = profile.photoBase64
    ? { uri: profile.photoBase64 }
    : { uri: AVATAR_PLACEHOLDER };

  if (loading) {
    return (
      <LoadingState
        fullScreen
        label="Loading profile..."
        style={{ backgroundColor: colors.background }}
      />
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingBottom: getTabBarContentBottomPadding(insets.bottom),
      }}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />

      {/* Offline banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons
            name="cloud-offline-outline"
            size={14}
            color="#fff"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.offlineBannerText}>
            You&apos;re offline &ndash; showing cached data
          </Text>
        </View>
      )}

      {/* HEADER BANNER */}
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
          <View style={styles.bannerMetaRow}>
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
            <View style={styles.bannerMetaPill}>
              <Ionicons
                name="sparkles-outline"
                size={13}
                color="rgba(255,255,255,0.92)"
              />
              <Text style={styles.bannerMetaText}>Research Prototype</Text>
            </View>
          </View>
        </View>
      </View>

      <Animated.View
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
      >
        <View style={[styles.summaryRow, { marginTop: 16 }]}>
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>
              Completion
            </Text>
            <Text style={[styles.summaryValue, { color: colors.primary }]}>
              {progress}%
            </Text>
            <Text style={[styles.summaryHint, { color: colors.muted }]}>
              tasks finished
            </Text>
          </View>
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>
              Current load
            </Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {stats.pending}
            </Text>
            <Text style={[styles.summaryHint, { color: colors.muted }]}>
              active tasks
            </Text>
          </View>
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>
              Risk watch
            </Text>
            <Text
              style={[
                styles.summaryValue,
                { color: stats.overdue > 0 ? "#ef4444" : "#16a34a" },
              ]}
            >
              {stats.overdue}
            </Text>
            <Text style={[styles.summaryHint, { color: colors.muted }]}>
              overdue
            </Text>
          </View>
        </View>

        {/* STUDENT INFO */}
        {si && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <SectionHeader
              eyebrow="Academic profile"
              title="Student information"
              subtitle="Identity and schedule context used by the prototype."
              colors={colors}
            />
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
                value={semesterValue}
                colors={colors}
              />
              <InfoChip
                label="Academic Year"
                value={academicYearValue}
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

        {/* PROGRESS */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader
            eyebrow="Performance snapshot"
            title="Task progress"
            subtitle="A quick read of your current academic workload."
            colors={colors}
          />
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
                  flexGrow: progress / 100,
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

        {/* RECENT TASKS */}
        {recentTasks.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardTitleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.sectionEyebrow, { color: colors.muted }]}>
                  Focus queue
                </Text>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Pending tasks
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push("/(tabs)/assignments")}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  Open all
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

        {/* ACTIONS */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader
            eyebrow="Presentation controls"
            title="Account and tools"
            subtitle="Shortcuts for the main demo flows."
            colors={colors}
          />
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
            icon="play-circle-outline"
            label="Replay Tutorial"
            onPress={() =>
              router.push(
                getTutorialRoute(profile.role === "admin" ? "admin" : "student")
              )
            }
            colors={colors}
          />
          <ActionRow
            icon="chatbubble-ellipses-outline"
            label="Send Review"
            onPress={() => router.push("/(tabs)/review")}
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

        {/* VERSION CARD */}
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
                CTU Academic Task Manager
              </Text>
              <Text style={[styles.versionSub, { color: colors.muted }]}>
                Version {APP_VERSION}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.footer, { color: colors.muted }]}>
          Cebu Technological University - Danao Campus
        </Text>
      </Animated.View>

      {/* EDIT NAME MODAL */}
      <Modal visible={editVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
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
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScrollView>
  );
}

// Sub-components
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

function SectionHeader({ eyebrow, title, subtitle, colors }) {
  return (
    <View style={styles.sectionHeader}>
      {eyebrow ? (
        <Text style={[styles.sectionEyebrow, { color: colors.muted }]}>
          {eyebrow}
        </Text>
      ) : null}
      <Text
        style={[styles.cardTitle, styles.sectionTitle, { color: colors.text }]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f59e0b",
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
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
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
  },
  bannerMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  bannerMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  bannerMetaText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "600",
  },
  roleText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  summaryRow: {
    marginHorizontal: 16,
    flexDirection: "row",
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "800",
    marginTop: 8,
  },
  summaryHint: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
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
  sectionHeader: { marginBottom: 14 },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 14 },
  sectionTitle: { marginBottom: 4 },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
  },
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
    flex: 1,
    flexDirection: "row",
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
