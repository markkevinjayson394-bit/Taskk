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
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Alert, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AnnouncementComposerTab from "../../components/admin-announcements/AnnouncementComposerTab";
import AnnouncementHeader from "../../components/admin-announcements/AnnouncementHeader";
import AnnouncementManageTab from "../../components/admin-announcements/AnnouncementManageTab";
import { auth, db } from "../../config/firebase";
import { useTheme } from "../../context/ThemeContext";
import {
  buildAnnouncementPayload,
  filterAnnouncements,
  MAX_IMAGE_KB,
  validateAnnouncementForm,
} from "../../utils/adminAnnouncements";

export default function AdminAnnouncements() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

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
  const [editingId, setEditingId] = useState("");

  const [announcements, setAnnouncements] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("post");
  const [visibleCount, setVisibleCount] = useState(15);
  const [manageSearch, setManageSearch] = useState("");
  const [manageAudience, setManageAudience] = useState("any");
  const PAGE_SIZE = 15;
  const isEditMode = Boolean(editingId);

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const loadAnnouncements = async () => {
    try {
      const snap = await getDocs(
        query(collection(db, "announcements"), orderBy("createdAt", "desc"))
      );
      setAnnouncements(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
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

      // Check file size before reading into memory to avoid OOM on low-RAM devices
      const fileInfo = await FileSystem.getInfoAsync(pickedUri);
      const estimatedKB = (fileInfo.size ?? 0) / 1024;
      if (estimatedKB > MAX_IMAGE_KB * 1.4) {
        // 1.4× because base64 is ~33% larger than raw bytes
        Alert.alert(
          "Image Too Large",
          `This image is too large (${Math.round(estimatedKB)} KB). Please choose a smaller image (max ${MAX_IMAGE_KB} KB after compression).`
        );
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(pickedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

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

  const resetForm = () => {
    setTitle("");
    setMessage("");
    setCourse("");
    setYear("");
    setSection("");
    setCollege("");
    setAudience("all");
    setImageBase64("");
    setImageNote("");
    setEditingId("");
  };

  const beginEditAnnouncement = (item) => {
    if (!item?.id) return;
    setEditingId(item.id);
    setTitle(String(item.title || ""));
    setMessage(String(item.message || ""));
    setAudience(["all", "year", "course"].includes(item.audience) ? item.audience : "all");
    setCollege(String(item.college || ""));
    setCourse(String(item.course || ""));
    setYear(String(item.year || ""));
    setSection(String(item.section || ""));
    setImageBase64(String(item.imageBase64 || ""));
    setImageNote(String(item.imageNote || ""));
    setTab("post");
  };

  const cancelEditAnnouncement = () => {
    resetForm();
  };

  const postAnnouncement = async () => {
    const validation = validateAnnouncementForm({
      title,
      message,
      audience,
      course,
      year,
      section,
      currentUid: auth.currentUser?.uid,
    });
    if (!validation.ok) {
      Alert.alert(validation.title, validation.message);
      return;
    }

    try {
      setPosting(true);
      const payload = buildAnnouncementPayload({
        title,
        message,
        audience,
        college,
        course,
        year,
        section,
        imageBase64,
        imageNote,
      });

      if (isEditMode) {
        await updateDoc(doc(db, "announcements", editingId), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        Alert.alert("Updated", "Announcement updated successfully.");
      } else {
        await addDoc(collection(db, "announcements"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
        Alert.alert("Posted", "Announcement sent successfully.");
      }

      resetForm();
      loadAnnouncements();
      setTab("list");
    } catch (err) {
      console.warn("Failed to post announcement:", err);
      Alert.alert(
        "Error",
        isEditMode ? "Failed to update announcement." : "Failed to post."
      );
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

  const filteredAnnouncements = useMemo(
    () => filterAnnouncements(announcements, manageAudience, manageSearch),
    [announcements, manageAudience, manageSearch]
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [manageSearch, manageAudience]);

  return (
    <View style={[{ flex: 1 }, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#f59e0b" />

      <AnnouncementHeader
        topInset={insets.top}
        tab={tab}
        announcementsCount={announcements.length}
        onChangeTab={setTab}
      />

      {tab === "post" ? (
        <AnnouncementComposerTab
          colors={colors}
          isEditMode={isEditMode}
          audience={audience}
          college={college}
          course={course}
          year={year}
          section={section}
          title={title}
          message={message}
          imageBase64={imageBase64}
          imageNote={imageNote}
          pickingImage={pickingImage}
          posting={posting}
          onAudienceChange={setAudience}
          onCollegeChange={setCollege}
          onYearChange={setYear}
          onCourseChange={setCourse}
          onSectionChange={setSection}
          onTitleChange={setTitle}
          onMessageChange={setMessage}
          onPickImage={pickAnnouncementImage}
          onRemoveImage={removeAnnouncementImage}
          onImageNoteChange={setImageNote}
          onSubmit={postAnnouncement}
          onCancelEdit={cancelEditAnnouncement}
        />
      ) : (
        <AnnouncementManageTab
          colors={colors}
          announcements={announcements}
          filteredAnnouncements={filteredAnnouncements}
          visibleCount={visibleCount}
          manageSearch={manageSearch}
          manageAudience={manageAudience}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadAnnouncements();
          }}
          onManageSearchChange={setManageSearch}
          onManageAudienceChange={setManageAudience}
          onClearSearch={() => setManageSearch("")}
          onEdit={beginEditAnnouncement}
          onDelete={deleteAnnouncement}
          onLoadMore={() => setVisibleCount((value) => value + PAGE_SIZE)}
        />
      )}
    </View>
  );
}
