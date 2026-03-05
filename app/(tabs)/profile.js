import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import {
  collection, doc, getDoc, getDocs,
  query, updateDoc, where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, Image,
  Modal, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { auth, db, storage } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";

const AVATAR_PLACEHOLDER = "https://cdn-icons-png.flaticon.com/512/149/149071.png";
const PRIORITY_COLORS = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function ProfileScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const { theme, toggleTheme, colors } = useTheme();
  const isDark = theme === "dark";

  const [stats,       setStats]       = useState({ completed: 0, pending: 0, overdue: 0 });
  const [recentTasks, setRecentTasks] = useState([]);
  const [profile,     setProfile]     = useState({ fullName: "", photoURL: "", role: "student", studentInfo: null });
  const [editVisible, setEditVisible] = useState(false);
  const [editForm,    setEditForm]    = useState({ fullName: "", photoURL: "" });
  const [uploading,   setUploading]   = useState(false);
  const [loading,     setLoading]     = useState(true);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, []);

  const loadAll = async () => {
    await Promise.all([fetchProfile(), fetchStats()]);
    setLoading(false);
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  };

  const fetchProfile = async () => {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      setProfile(data);
      setEditForm({ fullName: data.fullName || "", photoURL: data.photoURL || "" });
    }
  };

  const fetchStats = async () => {
    const q = query(collection(db, "assignments"), where("userId", "==", user.uid));
    const snap = await getDocs(q);
    const now = new Date();
    let completed = 0, pending = 0, overdue = 0;
    const pending_tasks = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.completed) {
        completed++;
      } else {
        pending++;
        const due = data.dueAt?.toDate();
        if (due && due < now) overdue++;
        if (pending_tasks.length < 3) pending_tasks.push({ id: d.id, ...data });
      }
    });
    setStats({ completed, pending, overdue });
    setRecentTasks(pending_tasks);
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled) return;
    try {
      setUploading(true);
      const response  = await fetch(result.assets[0].uri);
      const blob      = await response.blob();
      const storageRef = ref(storage, `profilePictures/${user.uid}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "users", user.uid), { photoURL: downloadURL });
      setProfile((p) => ({ ...p, photoURL: downloadURL }));
      setEditForm((f) => ({ ...f, photoURL: downloadURL }));
      Alert.alert("✅ Photo Updated", "Your profile picture has been changed.");
    } catch (err) {
      Alert.alert("Upload Failed", "Could not upload photo. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    if (!editForm.fullName.trim()) { Alert.alert("Error", "Full name cannot be empty"); return; }
    try {
      await updateDoc(doc(db, "users", user.uid), {
        fullName: editForm.fullName.trim(),
        photoURL: editForm.photoURL.trim(),
      });
      setProfile((p) => ({ ...p, fullName: editForm.fullName.trim(), photoURL: editForm.photoURL.trim() }));
      setEditVisible(false);
      Alert.alert("✅ Saved", "Profile updated successfully");
    } catch {
      Alert.alert("Error", "Failed to update profile");
    }
  };

  const logout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: async () => {
        await signOut(auth);
        router.replace("/(auth)/login");
      }},
    ]);
  };

  const progress = stats.completed + stats.pending === 0
    ? 0
    : Math.round((stats.completed / (stats.completed + stats.pending)) * 100);
  const si = profile.studentInfo;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.muted }}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* ── HEADER BANNER ── */}
      <View style={[styles.banner, { backgroundColor: colors.primary }]}>
        <View style={styles.bannerTopRow}>
          <Text style={styles.greetingText}>{getGreeting()},</Text>
          <View style={styles.themeToggleRow}>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginRight: 6 }}>
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

        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickFromGallery} activeOpacity={0.85} disabled={uploading}>
            <View style={styles.avatarWrapper}>
              <Image
                source={{ uri: profile.photoURL || AVATAR_PLACEHOLDER }}
                style={styles.avatar}
              />
              <View style={[styles.editBadge, { backgroundColor: colors.card }]}>
                {uploading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={{ fontSize: 13 }}>📷</Text>
                }
              </View>
            </View>
          </TouchableOpacity>

          {uploading && (
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginBottom: 6 }}>
              Uploading photo...
            </Text>
          )}

          <Text style={styles.nameText}>{profile.fullName || "CTU Danao Student"}</Text>
          <Text style={styles.emailText}>{user?.email}</Text>
          <View style={[styles.roleBadge, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Text style={styles.roleText}>
              {profile.role === "admin" ? "🛡️ Admin" : "🎓 Student"}
            </Text>
          </View>
        </View>
      </View>

      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

        {/* ── STUDENT INFO ── */}
        {si && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>🏫 Student Info</Text>
            <View style={styles.infoGrid}>
              <InfoChip label="ID"       value={si.idNumber}    colors={colors} />
              <InfoChip label="Course"   value={si.course}      colors={colors} />
              <InfoChip label="Year"     value={`Year ${si.year}`} colors={colors} />
              <InfoChip label="Section"  value={`Section ${si.section}`} colors={colors} />
              <InfoChip label="Schedule" value={si.scheduleType} colors={colors} />
              <InfoChip label="College"  value={si.college}     colors={colors} />
            </View>
          </View>
        )}

        {/* ── PROGRESS ── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>📊 Task Progress</Text>
          <View style={styles.progressLabelRow}>
            <Text style={[styles.progressPercent, { color: colors.primary }]}>{progress}%</Text>
            <Text style={[styles.progressSub, { color: colors.muted }]}>completed</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: isDark ? "#1e293b" : "#e2e8f0" }]}>
            <View style={[styles.progressFill, {
              width: `${progress}%`,
              backgroundColor: progress === 100 ? colors.success : progress > 50 ? colors.primary : colors.danger,
            }]} />
          </View>
          <View style={styles.statRow}>
            <StatBox value={stats.completed} label="Done"    color={colors.success} bg={isDark ? "#052e16" : "#f0fdf4"} />
            <StatBox value={stats.pending}   label="Pending" color={colors.primary} bg={isDark ? "#0c1a3a" : "#eff6ff"} />
            <StatBox value={stats.overdue}   label="Overdue" color={colors.danger}  bg={isDark ? "#2d0a0a" : "#fef2f2"} />
          </View>
        </View>

        {/* ── RECENT TASKS ── */}
        {recentTasks.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>⏳ Pending Tasks</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/assignments")}>
                <Text style={{ color: colors.primary, fontSize: 13 }}>See all →</Text>
              </TouchableOpacity>
            </View>
            {recentTasks.map((task) => (
              <View key={task.id}
                style={[styles.taskRow, { borderLeftColor: PRIORITY_COLORS[task.priority] || colors.primary }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.taskTitle, { color: colors.text }]}>{task.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{task.subject}</Text>
                </View>
                <View style={[styles.priorityTag, { backgroundColor: (PRIORITY_COLORS[task.priority] || colors.primary) + "22" }]}>
                  <Text style={{ color: PRIORITY_COLORS[task.priority] || colors.muted, fontSize: 11, fontWeight: "bold" }}>
                    {(task.priority || "medium").toUpperCase()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── ACTIONS ── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>⚙️ Account</Text>
          <ActionRow icon="✏️"  label="Edit Name"             onPress={() => setEditVisible(true)}                       colors={colors} />
          <ActionRow icon="📷"  label="Change Photo"           onPress={pickFromGallery}                                   colors={colors} />
          <ActionRow icon="📋"  label="View All Assignments"   onPress={() => router.push("/(tabs)/assignments")}          colors={colors} />
          <ActionRow icon="📅"  label="View Schedule"          onPress={() => router.push("/(tabs)/schedule")}             colors={colors} />

          {/* ── NOTIFICATION SETTINGS ROW — NEW ── */}
          <ActionRow
            icon="🔔"
            label="Notifications & Reminders"
            onPress={() => router.push("/(tabs)/NotificationSettings")}
            colors={colors}
            highlight
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ActionRow icon="🚪" label="Logout" onPress={logout} colors={colors} danger />
        </View>

        <Text style={[styles.footer, { color: colors.muted }]}>
          CTU Danao Time Manager • v1.0
        </Text>
      </Animated.View>

      {/* ── EDIT NAME MODAL ── */}
      <Modal visible={editVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Name</Text>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Full Name</Text>
            <TextInput
              placeholder="Enter full name"
              placeholderTextColor={colors.muted}
              value={editForm.fullName}
              onChangeText={(t) => setEditForm({ ...editForm, fullName: t })}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={saveProfile}>
              <Text style={{ color: "#fff", fontWeight: "bold" }}>Save Changes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={() => setEditVisible(false)}>
              <Text style={{ color: colors.muted }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────
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
      <Text style={{ color: colors.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress, colors, danger, highlight }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={{ fontSize: 18, marginRight: 12 }}>{icon}</Text>
      <Text style={[
        styles.actionLabel,
        { color: danger ? colors.danger : highlight ? colors.primary : colors.text },
        highlight && { fontWeight: "700" },
      ]}>
        {label}
      </Text>
      <Text style={{ color: colors.muted, marginLeft: "auto" }}>›</Text>
    </TouchableOpacity>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center:    { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { paddingBottom: 40 },

  banner: { paddingTop: 50, paddingBottom: 30, paddingHorizontal: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  bannerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  greetingText:  { color: "rgba(255,255,255,0.85)", fontSize: 15 },
  themeToggleRow:{ flexDirection: "row", alignItems: "center" },
  avatarSection: { alignItems: "center" },
  avatarWrapper: { position: "relative", marginBottom: 12 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: "rgba(255,255,255,0.6)" },
  editBadge: {
    position: "absolute", bottom: 0, right: 0,
    width: 30, height: 30, borderRadius: 15,
    justifyContent: "center", alignItems: "center", elevation: 3,
  },
  nameText:  { color: "#fff", fontSize: 22, fontWeight: "bold" },
  emailText: { color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2 },
  roleBadge: { marginTop: 8, paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20 },
  roleText:  { color: "#fff", fontSize: 13, fontWeight: "600" },

  card: { marginHorizontal: 16, marginTop: 16, borderRadius: 18, padding: 18, elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 6 },
  cardTitle:    { fontSize: 15, fontWeight: "700", marginBottom: 14 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },

  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, minWidth: "46%", flex: 1 },

  progressLabelRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 10 },
  progressPercent:  { fontSize: 36, fontWeight: "800" },
  progressSub:      { fontSize: 14, marginLeft: 6 },
  progressTrack:    { height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 16 },
  progressFill:     { height: "100%", borderRadius: 5 },
  statRow:          { flexDirection: "row", gap: 8 },
  statBox:          { flex: 1, borderRadius: 12, padding: 12, alignItems: "center" },
  statValue:        { fontSize: 22, fontWeight: "800" },
  statLabel:        { fontSize: 11, fontWeight: "600", marginTop: 2, textTransform: "uppercase" },

  taskRow:     { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingLeft: 12, borderLeftWidth: 3, marginBottom: 8 },
  taskTitle:   { fontWeight: "600", fontSize: 14 },
  priorityTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },

  divider:     { height: 1, marginVertical: 8 },
  actionRow:   { flexDirection: "row", alignItems: "center", paddingVertical: 13 },
  actionLabel: { fontSize: 15 },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  modalCard:    { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle:   { fontSize: 20, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  inputLabel:   { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input:        { borderWidth: 1, padding: 12, borderRadius: 10, marginBottom: 16, fontSize: 15 },
  saveBtn:      { padding: 14, borderRadius: 12, alignItems: "center", marginBottom: 10 },
  cancelBtn:    { padding: 12, borderRadius: 12, alignItems: "center", borderWidth: 1 },

  footer: { textAlign: "center", fontSize: 12, marginTop: 24, marginBottom: 8 },
});