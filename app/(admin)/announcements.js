import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    Alert,
    Image,
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
import {
    ALL_COURSES,
    COLLEGES,
    getCollegeLabel,
} from "../../constants/academics";
import { useTheme } from "../../context/ThemeContext";

const AUDIENCE_OPTIONS = [
  { value: "all", label: "All Students", icon: "people", color: "#6366f1" },
  { value: "year", label: "Specific Year", icon: "calendar", color: "#0ea5e9" },
  {
    value: "course",
    label: "Specific Section",
    icon: "school",
    color: "#10b981",
  },
];
const MAX_IMAGE_KB = 180;

export default function AdminAnnouncements() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Form state
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("all");
  const [college, setCollege] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [section, setSection] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [imageNote, setImageNote] = useState("");
  const [pickingImage, setPickingImage] = useState(false);
  const [posting, setPosting] = useState(false);

  // List state
  const [announcements, setAnnouncements] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("post"); // "post" | "list"
  const [visibleCount, setVisibleCount] = useState(15);
  const PAGE_SIZE = 15;

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const loadAnnouncements = async () => {
    try {
      const snap = await getDocs(
        query(collection(db, "announcements"), orderBy("createdAt", "desc"))
      );
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      console.warn("Failed to load announcements:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const pickAnnouncementImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Please allow photo access to attach images."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.45,
      exif: false,
    });

    if (result.canceled) return;

    try {
      setPickingImage(true);
      const pickedUri = result.assets[0].uri;
      const base64 = await FileSystem.readAsStringAsync(pickedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const sizeKB = (base64.length * 0.75) / 1024;

      if (sizeKB > MAX_IMAGE_KB) {
        Alert.alert(
          "Image Too Large",
          `Image is about ${Math.round(sizeKB)} KB. Please crop or choose a smaller image (max ${MAX_IMAGE_KB} KB).`
        );
        return;
      }

      setImageBase64(`data:image/jpeg;base64,${base64}`);
    } catch (err) {
      console.warn("Failed to process image:", err);
      Alert.alert(
        "Image Error",
        "Could not attach the image. Please try again."
      );
    } finally {
      setPickingImage(false);
    }
  };

  const removeAnnouncementImage = () => {
    setImageBase64("");
    setImageNote("");
  };

  const postAnnouncement = async () => {
    if (!title.trim() || !message.trim()) {
      Alert.alert("Missing Fields", "Please fill in both title and message.");
      return;
    }
    if (audience === "course" && (!course || !year || !section)) {
      Alert.alert("Missing Fields", "Please select course, year, and section.");
      return;
    }
    if (audience === "year" && !year) {
      Alert.alert("Missing Fields", "Please select a year.");
      return;
    }
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) {
      Alert.alert("Session Expired", "Please log in again.");
      return;
    }
    try {
      setPosting(true);
      await addDoc(collection(db, "announcements"), {
        title: title.trim(),
        message: message.trim(),
        audience,
        college: audience === "all" ? "" : college || "",
        course: audience === "course" ? course : "",
        year: audience !== "all" ? year : "",
        section: audience === "course" ? section : "",
        imageBase64: imageBase64 || "",
        imageNote: imageNote.trim(),
        createdAt: serverTimestamp(),
        createdBy: currentUid,
      });
      Alert.alert(" Posted", "Announcement sent successfully.");
      setTitle("");
      setMessage("");
      setCourse("");
      setYear("");
      setSection("");
      setCollege("");
      setAudience("all");
      setImageBase64("");
      setImageNote("");
      loadAnnouncements();
      setTab("list");
    } catch (err) {
      console.warn("Failed to post announcement:", err);
      Alert.alert("Error", "Failed to post.");
    } finally {
      setPosting(false);
    }
  };

  const deleteAnnouncement = (id, titleStr) => {
    Alert.alert("Delete", `Delete "${titleStr}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "announcements", id));
            loadAnnouncements();
          } catch (err) {
            console.warn("Failed to delete announcement:", err);
            Alert.alert(
              "Delete Failed",
              "Could not delete announcement. Please try again."
            );
          }
        },
      },
    ]);
  };

  const selectedAudience = AUDIENCE_OPTIONS.find((a) => a.value === audience);

  const formatDate = (ts) => {
    try {
      return ts.toDate().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (err) {
      console.warn("Failed to format date:", err);
      return "";
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#f59e0b" />
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: "#f59e0b", paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.headerCircle} />
        <View style={styles.headerCircle2} />
        <Text style={styles.headerSub}>Broadcast to students</Text>
        <Text style={styles.headerTitle}>Announcements</Text>

        {/* Tab switcher */}
        <View style={[styles.tabBar, { backgroundColor: "rgba(0,0,0,0.15)" }]}>
          {[
            { key: "post", label: "Post New", icon: "add-circle-outline" },
            {
              key: "list",
              label: `Manage (${announcements.length})`,
              icon: "list",
            },
          ].map((t) => (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            >
              <Ionicons
                name={t.icon}
                size={14}
                color={tab === t.key ? "#f59e0b" : "rgba(255,255,255,0.7)"}
              />
              <Text
                style={[
                  styles.tabBtnText,
                  {
                    color: tab === t.key ? "#f59e0b" : "rgba(255,255,255,0.7)",
                  },
                ]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === "post" ? (
        <ScrollView
          contentContainerStyle={styles.form}
          showsVerticalScrollIndicator={false}
        >
          {/* Audience picker */}
          <Text style={[styles.label, { color: colors.muted }]}>Send To</Text>
          <View style={styles.audienceRow}>
            {AUDIENCE_OPTIONS.map((opt) => {
              const isActive = audience === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setAudience(opt.value)}
                  style={[
                    styles.audienceCard,
                    {
                      backgroundColor: isActive ? opt.color : colors.card,
                      borderColor: isActive ? opt.color : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={opt.icon}
                    size={18}
                    color={isActive ? "#fff" : opt.color}
                  />
                  <Text
                    style={[
                      styles.audienceLabel,
                      { color: isActive ? "#fff" : colors.text },
                    ]}
                    numberOfLines={2}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Year picker */}
          {(audience === "year" || audience === "course") && (
            <>
              <Text style={[styles.label, { color: colors.muted }]}>
                College
              </Text>
              <View
                style={[
                  styles.pickerBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Picker
                  selectedValue={college}
                  onValueChange={setCollege}
                  style={{ color: colors.text }}
                >
                  <Picker.Item label="All Colleges" value="" />
                  {COLLEGES.map((c) => (
                    <Picker.Item
                      key={c.value}
                      label={c.label}
                      value={c.value}
                    />
                  ))}
                </Picker>
              </View>

              <Text style={[styles.label, { color: colors.muted }]}>
                Year Level
              </Text>
              <View
                style={[
                  styles.pickerBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Picker
                  selectedValue={year}
                  onValueChange={setYear}
                  style={{ color: colors.text }}
                >
                  <Picker.Item label="Select Year" value="" />
                  {["1", "2", "3", "4"].map((y) => (
                    <Picker.Item key={y} label={`Year ${y}`} value={y} />
                  ))}
                </Picker>
              </View>
            </>
          )}

          {/* Course + Section */}
          {audience === "course" && (
            <>
              <Text style={[styles.label, { color: colors.muted }]}>
                Course
              </Text>
              <View
                style={[
                  styles.pickerBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Picker
                  selectedValue={course}
                  onValueChange={setCourse}
                  style={{ color: colors.text }}
                >
                  <Picker.Item label="Select Course" value="" />
                  {ALL_COURSES.map((c) => (
                    <Picker.Item key={c} label={c} value={c} />
                  ))}
                </Picker>
              </View>
              <Text style={[styles.label, { color: colors.muted }]}>
                Section
              </Text>
              <View
                style={[
                  styles.pickerBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Picker
                  selectedValue={section}
                  onValueChange={setSection}
                  style={{ color: colors.text }}
                >
                  <Picker.Item label="Select Section" value="" />
                  {["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map(
                    (s) => (
                      <Picker.Item key={s} label={`Section ${s}`} value={s} />
                    )
                  )}
                </Picker>
              </View>
            </>
          )}

          {/* Title */}
          <Text style={[styles.label, { color: colors.muted }]}>Title *</Text>
          <TextInput
            placeholder="Announcement title"
            placeholderTextColor={colors.muted}
            value={title}
            onChangeText={setTitle}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: title ? "#f59e0b" : colors.border,
                color: colors.text,
              },
            ]}
          />

          {/* Message */}
          <Text style={[styles.label, { color: colors.muted }]}>Message *</Text>
          <TextInput
            placeholder="Write your announcement here..."
            placeholderTextColor={colors.muted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            style={[
              styles.textArea,
              {
                backgroundColor: colors.card,
                borderColor: message ? "#f59e0b" : colors.border,
                color: colors.text,
              },
            ]}
          />

          {/* Optional image */}
          <Text style={[styles.label, { color: colors.muted }]}>
            Attach Image (Optional)
          </Text>
          <View
            style={[
              styles.imageCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {imageBase64 ? (
              <>
                <Image
                  source={{ uri: imageBase64 }}
                  style={styles.imagePreview}
                  resizeMode="cover"
                />
                <View style={styles.imageActionsRow}>
                  <TouchableOpacity
                    style={[styles.imageBtn, { backgroundColor: "#f59e0b20" }]}
                    onPress={pickAnnouncementImage}
                    disabled={pickingImage}
                  >
                    <Ionicons name="image-outline" size={15} color="#f59e0b" />
                    <Text style={[styles.imageBtnText, { color: "#f59e0b" }]}>
                      {pickingImage ? "Processing..." : "Change"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.imageBtn,
                      { backgroundColor: colors.danger + "20" },
                    ]}
                    onPress={removeAnnouncementImage}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={15}
                      color={colors.danger}
                    />
                    <Text
                      style={[styles.imageBtnText, { color: colors.danger }]}
                    >
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.imagePickerBtn, { borderColor: colors.border }]}
                onPress={pickAnnouncementImage}
                disabled={pickingImage}
              >
                <Ionicons name="image-outline" size={18} color="#f59e0b" />
                <Text
                  style={[styles.imagePickerBtnText, { color: colors.text }]}
                >
                  {pickingImage ? "Attaching image..." : "Choose image"}
                </Text>
                <Text style={[styles.imageHint, { color: colors.muted }]}>
                  JPG/PNG up to {MAX_IMAGE_KB} KB
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>
            Image Note (Optional)
          </Text>
          <TextInput
            placeholder="Add a short note for this image..."
            placeholderTextColor={colors.muted}
            value={imageNote}
            onChangeText={setImageNote}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
          />

          {/* Preview */}
          {(title || message || imageBase64) && (
            <View
              style={[
                styles.preview,
                {
                  backgroundColor: colors.card,
                  borderLeftColor: selectedAudience?.color || "#f59e0b",
                },
              ]}
            >
              <Text style={[styles.previewLabel, { color: colors.muted }]}>
                Preview
              </Text>
              <Text style={[styles.previewTitle, { color: colors.text }]}>
                {title || "Title..."}
              </Text>
              <Text
                style={[styles.previewMessage, { color: colors.muted }]}
                numberOfLines={3}
              >
                {message || "Message..."}
              </Text>
              {imageBase64 ? (
                <View style={styles.previewMediaBox}>
                  <Image
                    source={{ uri: imageBase64 }}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />
                  {!!imageNote.trim() && (
                    <Text
                      style={[styles.previewImageNote, { color: colors.muted }]}
                    >
                      {imageNote.trim()}
                    </Text>
                  )}
                </View>
              ) : null}
              <View
                style={[
                  styles.previewBadge,
                  {
                    backgroundColor:
                      (selectedAudience?.color || "#f59e0b") + "20",
                  },
                ]}
              >
                <Ionicons
                  name={selectedAudience?.icon || "people"}
                  size={11}
                  color={selectedAudience?.color || "#f59e0b"}
                />
                <Text
                  style={[
                    styles.previewBadgeText,
                    { color: selectedAudience?.color || "#f59e0b" },
                  ]}
                >
                  {selectedAudience?.label}
                  {(audience === "year" || audience === "course") && college
                    ? ` - ${getCollegeLabel(college)}`
                    : ""}
                  {audience === "year" && year ? ` - Year ${year}` : ""}
                  {audience === "course" && course ? ` - ${course}` : ""}
                </Text>
              </View>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.postBtn,
              { backgroundColor: posting ? colors.muted : "#f59e0b" },
            ]}
            onPress={postAnnouncement}
            disabled={posting}
            accessibilityLabel="Post announcement"
            accessibilityHint="Sends the announcement to selected audience"
          >
            <Ionicons
              name={posting ? "hourglass-outline" : "send"}
              size={18}
              color="#fff"
            />
            <Text style={styles.postBtnText}>
              {posting ? "Posting..." : "Post Announcement"}
            </Text>
          </TouchableOpacity>
          <View style={{ height: 32 }} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadAnnouncements();
              }}
              colors={["#f59e0b"]}
              tintColor="#f59e0b"
            />
          }
        >
          {announcements.length === 0 ? (
            <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
              <Ionicons
                name="megaphone-outline"
                size={32}
                color={colors.muted}
                style={{ marginBottom: 8 }}
              />
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                No announcements yet
              </Text>
            </View>
          ) : (
            announcements.slice(0, visibleCount).map((item) => {
              const ac =
                AUDIENCE_OPTIONS.find((a) => a.value === item.audience) ||
                AUDIENCE_OPTIONS[0];
              return (
                <View
                  key={item.id}
                  style={[
                    styles.annCard,
                    { backgroundColor: colors.card, borderLeftColor: ac.color },
                  ]}
                >
                  <View style={styles.annCardHeader}>
                    <View
                      style={[
                        styles.annBadge,
                        { backgroundColor: ac.color + "18" },
                      ]}
                    >
                      <Ionicons name={ac.icon} size={11} color={ac.color} />
                      <Text style={[styles.annBadgeText, { color: ac.color }]}>
                        {ac.label}
                        {(item.audience === "year" ||
                          item.audience === "course") &&
                        item.college
                          ? ` - ${getCollegeLabel(item.college)}`
                          : ""}
                        {item.audience === "year" && item.year
                          ? ` - Y${item.year}`
                          : ""}
                        {item.audience === "course" && item.course
                          ? ` - ${item.course}`
                          : ""}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => deleteAnnouncement(item.id, item.title)}
                      style={[
                        styles.deleteBtn,
                        { backgroundColor: colors.danger + "15" },
                      ]}
                      accessibilityLabel={`Delete announcement: ${item.title}`}
                      accessibilityHint="Deletes this announcement permanently"
                    >
                      <Ionicons
                        name="trash-outline"
                        size={15}
                        color={colors.danger}
                      />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.annTitle, { color: colors.text }]}>
                    {item.title}
                  </Text>
                  <Text
                    style={[styles.annMessage, { color: colors.muted }]}
                    numberOfLines={2}
                  >
                    {item.message}
                  </Text>
                  {item.imageBase64 ? (
                    <View style={styles.annMediaBox}>
                      <Image
                        source={{ uri: item.imageBase64 }}
                        style={styles.annImage}
                        resizeMode="cover"
                      />
                      {!!item.imageNote && (
                        <Text
                          style={[styles.annImageNote, { color: colors.muted }]}
                        >
                          {item.imageNote}
                        </Text>
                      )}
                    </View>
                  ) : null}
                  <Text style={[styles.annDate, { color: colors.muted }]}>
                    {formatDate(item.createdAt)}
                  </Text>
                </View>
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
              <Text style={[styles.loadMoreText, { color: "#f59e0b" }]}>
                Load more ({announcements.length - visibleCount} remaining)
              </Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingTop: 52,
    paddingBottom: 18,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerCircle: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -30,
    right: -20,
  },
  headerCircle2: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
  },

  tabBar: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabBtnActive: { backgroundColor: "#fff" },
  tabBtnText: { fontSize: 13, fontWeight: "600" },

  form: { padding: 18 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },

  audienceRow: { flexDirection: "row", gap: 8 },
  audienceCard: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 6,
  },
  audienceLabel: { fontSize: 11, fontWeight: "600", textAlign: "center" },

  pickerBox: {
    borderWidth: 1.5,
    borderRadius: 12,
    marginBottom: 4,
    overflow: "hidden",
  },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 13, fontSize: 15 },
  textArea: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 13,
    fontSize: 15,
    height: 120,
  },
  imageCard: { borderWidth: 1.5, borderRadius: 12, padding: 10 },
  imagePickerBtn: {
    borderWidth: 1.2,
    borderStyle: "dashed",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 18,
    gap: 4,
  },
  imagePickerBtnText: { fontSize: 14, fontWeight: "600" },
  imageHint: { fontSize: 11 },
  imagePreview: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    marginBottom: 10,
  },
  imageActionsRow: { flexDirection: "row", gap: 8 },
  imageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  imageBtnText: { fontSize: 12, fontWeight: "700" },

  preview: {
    marginTop: 18,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  previewTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  previewMessage: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  previewBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  previewBadgeText: { fontSize: 11, fontWeight: "700" },

  postBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 15,
    borderRadius: 14,
    marginTop: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  postBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  listContainer: { padding: 16 },
  emptyBox: {
    alignItems: "center",
    padding: 48,
    borderRadius: 20,
    marginTop: 10,
  },
  emptyText: { fontSize: 15 },
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

  annCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  annCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  annBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  annBadgeText: { fontSize: 11, fontWeight: "700" },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  annTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  annMessage: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  annMediaBox: { marginBottom: 8 },
  annImage: { width: "100%", height: 140, borderRadius: 10, marginBottom: 6 },
  annImageNote: { fontSize: 12, lineHeight: 17 },
  annDate: { fontSize: 11 },
});
