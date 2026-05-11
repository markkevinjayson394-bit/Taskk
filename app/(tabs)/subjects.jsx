import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import { useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { getTabBarContentBottomPadding } from "../../utils/tabBarLayout";

const SUBJECT_KEY = (uid) => `subject_catalog_${uid}`;
const SUBJECT_COLLECTION = "subjects";

const normalizeSubjectName = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);

const buildSubjectId = (name = "") => {
  const slug = normalizeSubjectName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug ? `subject_${slug}` : `subject_${Date.now()}`;
};

const normalizeSubjectItem = (item = {}) => {
  const name = normalizeSubjectName(item.name ?? item.subject ?? "");
  if (!name) return null;
  const id =
    typeof item.id === "string" && item.id.trim()
      ? item.id.trim().slice(0, 100)
      : buildSubjectId(name);
  return {
    id,
    name,
    updatedAt:
      typeof item.updatedAt === "string" && item.updatedAt
        ? item.updatedAt
        : new Date().toISOString(),
  };
};

const sortSubjects = (subjects = []) =>
  [...subjects].sort((a, b) => a.name.localeCompare(b.name));

const parseSubjectList = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortSubjects(
      parsed
        .map((item) => normalizeSubjectItem(item))
        .filter(Boolean)
    );
  } catch (err) {
    console.warn("Failed to parse local subjects:", err);
    return [];
  }
};

const mergeSubjects = (local = [], remote = []) => {
  const byName = new Map();
  for (const candidate of [...remote, ...local]) {
    const normalized = normalizeSubjectItem(candidate);
    if (!normalized) continue;
    byName.set(normalized.name.toLowerCase(), normalized);
  }
  return sortSubjects(Array.from(byName.values()));
};

const isPermissionDenied = (err) =>
  String(err?.code || "")
    .toLowerCase()
    .includes("permission-denied");

const saveSubjectsCache = async (uid, subjects) => {
  if (!uid) return;
  await AsyncStorage.setItem(SUBJECT_KEY(uid), JSON.stringify(subjects));
};

const loadSubjectsFromFirestore = async (uid) => {
  const snap = await getDocs(collection(db, "users", uid, SUBJECT_COLLECTION));
  return sortSubjects(
    snap.docs
      .map((docSnap) =>
        normalizeSubjectItem({ id: docSnap.id, ...docSnap.data() })
      )
      .filter(Boolean)
  );
};

const syncSubjectsToFirestore = async (uid, subjects) => {
  if (!uid) return;
  const normalized = sortSubjects(
    subjects.map((subject) => normalizeSubjectItem(subject)).filter(Boolean)
  );
  const subjectIds = new Set(normalized.map((subject) => subject.id));
  const existingSnap = await getDocs(
    collection(db, "users", uid, SUBJECT_COLLECTION)
  );

  await Promise.all(
    normalized.map((subject) =>
      setDoc(
        doc(db, "users", uid, SUBJECT_COLLECTION, subject.id),
        {
          name: subject.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );

  const deletions = [];
  existingSnap.forEach((docSnap) => {
    if (!subjectIds.has(docSnap.id)) {
      deletions.push(
        deleteDoc(doc(db, "users", uid, SUBJECT_COLLECTION, docSnap.id))
      );
    }
  });

  if (deletions.length > 0) {
    await Promise.all(deletions);
  }
};

export default function SubjectsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { isOnline } = useOffline();

  const [subjects, setSubjects] = useState([]);
  const [subjectInput, setSubjectInput] = useState("");
  const [editVisible, setEditVisible] = useState(false);
  const [editSubjectId, setEditSubjectId] = useState("");
  const [editSubjectName, setEditSubjectName] = useState("");
  const [saving, setSaving] = useState(false);
  const subjectsPermissionDeniedRef = useRef(false);

  const persistSubjectCatalog = useCallback(
    async (nextSubjects, uid = auth.currentUser?.uid) => {
      if (!uid) return;
      const normalized = sortSubjects(
        nextSubjects
          .map((subjectItem) => normalizeSubjectItem(subjectItem))
          .filter(Boolean)
      );
      await saveSubjectsCache(uid, normalized);
      if (isOnline) {
        if (subjectsPermissionDeniedRef.current) return;
        try {
          await syncSubjectsToFirestore(uid, normalized);
        } catch (err) {
          if (isPermissionDenied(err)) {
            if (!subjectsPermissionDeniedRef.current) {
              console.warn(
                "Subjects cloud sync disabled: Firestore permission denied. Changes remain local."
              );
            }
            subjectsPermissionDeniedRef.current = true;
          } else {
            console.warn("Failed to sync subjects:", err);
          }
        }
      }
    },
    [isOnline]
  );

  const loadSubjects = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setSubjects([]);
      return;
    }

    let localSubjects = [];
    try {
      const raw = await AsyncStorage.getItem(SUBJECT_KEY(user.uid));
      localSubjects = parseSubjectList(raw);
    } catch (err) {
      console.warn("Failed to load local subjects:", err);
      localSubjects = [];
    }

    if (!isOnline) {
      setSubjects(localSubjects);
      return;
    }
    if (subjectsPermissionDeniedRef.current) {
      setSubjects(localSubjects);
      return;
    }

    try {
      const remoteSubjects = await loadSubjectsFromFirestore(user.uid);
      const merged = mergeSubjects(localSubjects, remoteSubjects);
      setSubjects(merged);
      await saveSubjectsCache(user.uid, merged);
      await syncSubjectsToFirestore(user.uid, merged);
      subjectsPermissionDeniedRef.current = false;
    } catch (err) {
      if (isPermissionDenied(err)) {
        if (!subjectsPermissionDeniedRef.current) {
          console.warn(
            "Subjects cloud sync disabled: Firestore permission denied. Using local subjects only."
          );
        }
        subjectsPermissionDeniedRef.current = true;
      } else {
        console.warn("Failed to load subjects from server:", err);
      }
      setSubjects(localSubjects);
    }
  }, [isOnline]);

  useFocusEffect(
    useCallback(() => {
      loadSubjects();
    }, [loadSubjects])
  );

  useEffect(() => {
    if (isOnline) {
      loadSubjects();
    }
  }, [isOnline, loadSubjects]);

  const addSubject = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "Not logged in.");
      return;
    }
    const normalized = normalizeSubjectName(subjectInput);
    if (!normalized) {
      Alert.alert("Missing Subject", "Enter a subject name.");
      return;
    }
    const exists = subjects.some(
      (subjectItem) =>
        subjectItem.name.toLowerCase() === normalized.toLowerCase()
    );
    if (exists) {
      Alert.alert("Already Added", `"${normalized}" is already in your list.`);
      return;
    }

    setSaving(true);
    try {
      const nextSubjects = mergeSubjects(subjects, [
        { id: buildSubjectId(normalized), name: normalized },
      ]);
      setSubjects(nextSubjects);
      await persistSubjectCatalog(nextSubjects, user.uid);
      setSubjectInput("");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (subjectItem) => {
    setEditSubjectId(subjectItem.id);
    setEditSubjectName(subjectItem.name);
    setEditVisible(true);
  };

  const saveEdit = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "Not logged in.");
      return;
    }
    const normalized = normalizeSubjectName(editSubjectName);
    if (!normalized) {
      Alert.alert("Missing Subject", "Subject name cannot be empty.");
      return;
    }
    const duplicate = subjects.some(
      (subjectItem) =>
        subjectItem.id !== editSubjectId &&
        subjectItem.name.toLowerCase() === normalized.toLowerCase()
    );
    if (duplicate) {
      Alert.alert("Duplicate Name", "A subject with that name already exists.");
      return;
    }

    setSaving(true);
    try {
      const nextSubjects = sortSubjects(
        subjects.map((subjectItem) =>
          subjectItem.id === editSubjectId
            ? { ...subjectItem, name: normalized, updatedAt: new Date().toISOString() }
            : subjectItem
        )
      );
      setSubjects(nextSubjects);
      await persistSubjectCatalog(nextSubjects, user.uid);
      setEditVisible(false);
      setEditSubjectId("");
      setEditSubjectName("");
    } finally {
      setSaving(false);
    }
  };

  const removeSubject = (subjectItem) => {
    Alert.alert(
      "Remove Subject",
      `Delete "${subjectItem.name}" from your subjects?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const user = auth.currentUser;
            if (!user) return;

            setSaving(true);
            try {
              const nextSubjects = subjects.filter(
                (entry) => entry.id !== subjectItem.id
              );
              setSubjects(nextSubjects);
              await persistSubjectCatalog(nextSubjects, user.uid);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />
      <OfflineBanner />

      <View
        style={[
          styles.header,
          { backgroundColor: colors.primary, paddingTop: insets.top + 14 },
        ]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={18} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Subjects</Text>
        <Text style={styles.headerSub}>
          Build your subject list for faster task creation.
        </Text>
      </View>

      <View
        style={[
          styles.addCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <TextInput
          placeholder="Add subject (e.g. Mathematics)"
          placeholderTextColor={colors.muted}
          value={subjectInput}
          onChangeText={setSubjectInput}
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
        <TouchableOpacity
          style={[
            styles.addBtn,
            {
              backgroundColor: colors.primary,
              opacity: saving ? 0.6 : 1,
            },
          ]}
          onPress={addSubject}
          disabled={saving}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addBtnText}>{saving ? "Saving..." : "Add Subject"}</Text>
        </TouchableOpacity>
        {!isOnline && (
          <Text style={[styles.offlineHint, { color: isDark ? "#fbbf24" : "#92400e" }]}>
            Offline mode: changes save locally and sync when online.
          </Text>
        )}
      </View>

      {subjects.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="library-outline" size={22} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No subjects yet
          </Text>
          <Text style={[styles.emptySub, { color: colors.muted }]}>
            Add your class subjects so task entry is faster and cleaner.
          </Text>
        </View>
      ) : (
        <FlatList
          data={subjects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: getTabBarContentBottomPadding(insets.bottom) },
          ]}
          renderItem={({ item }) => (
            <View
              style={[
                styles.subjectRow,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.subjectName, { color: colors.text }]}>
                  {item.name}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => openEdit(item)}
              >
                <Ionicons name="create-outline" size={17} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => removeSubject(item)}
              >
                <Ionicons name="trash-outline" size={17} color="#ef4444" />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={editVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Rename Subject
            </Text>
            <TextInput
              placeholder="Subject name"
              placeholderTextColor={colors.muted}
              value={editSubjectName}
              onChangeText={setEditSubjectName}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
            />
            <TouchableOpacity
              style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
              onPress={saveEdit}
            >
              <Text style={styles.modalPrimaryText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSecondaryBtn, { borderColor: colors.border }]}
              onPress={() => setEditVisible(false)}
            >
              <Text style={[styles.modalSecondaryText, { color: colors.muted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginBottom: 10,
  },
  backText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 24, fontWeight: "800" },
  headerSub: { color: "rgba(255,255,255,0.78)", fontSize: 12, marginTop: 4 },
  addCard: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 11,
  },
  addBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  offlineHint: { fontSize: 11, lineHeight: 16 },
  listContent: { padding: 16, paddingTop: 12, gap: 10, paddingBottom: 32 },
  subjectRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  subjectName: { fontSize: 14, fontWeight: "600" },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 18,
  },
  emptyTitle: { marginTop: 8, fontSize: 15, fontWeight: "700" },
  emptySub: {
    marginTop: 6,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 260,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  modalTitle: { fontSize: 15, fontWeight: "800", marginBottom: 10 },
  modalPrimaryBtn: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    marginTop: 4,
  },
  modalPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  modalSecondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 8,
  },
  modalSecondaryText: { fontSize: 12, fontWeight: "600" },
});
