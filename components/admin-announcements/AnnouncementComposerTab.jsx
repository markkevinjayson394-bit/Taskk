import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  ALL_COURSES,
  COLLEGES,
  getCollegeLabel,
  getCoursesForCollege,
} from "../../constants/academics";
import {
  AUDIENCE_OPTIONS,
  getSelectedAudience,
  MAX_IMAGE_KB,
  SECTION_OPTIONS,
  YEAR_OPTIONS,
} from "../../utils/adminAnnouncements";

export default function AnnouncementComposerTab({
  colors,
  isEditMode,
  audience,
  college,
  course,
  year,
  section,
  title,
  message,
  imageBase64,
  imageNote,
  pickingImage,
  posting,
  onAudienceChange,
  onCollegeChange,
  onYearChange,
  onCourseChange,
  onSectionChange,
  onTitleChange,
  onMessageChange,
  onPickImage,
  onRemoveImage,
  onImageNoteChange,
  onSubmit,
  onCancelEdit,
}) {
  const selectedAudience = getSelectedAudience(audience);
  const courseOptions = college ? getCoursesForCollege(college) : ALL_COURSES;

  return (
    <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
      {isEditMode ? (
        <View
          style={[
            styles.editingBar,
            {
              backgroundColor: `${colors.primary}12`,
              borderColor: `${colors.primary}40`,
            },
          ]}
        >
          <View style={styles.editingBarTextWrap}>
            <Ionicons name="create-outline" size={15} color={colors.primary} />
            <Text style={[styles.editingBarText, { color: colors.text }]}>
              Editing announcement
            </Text>
          </View>
          <TouchableOpacity
            onPress={onCancelEdit}
            style={[styles.cancelEditBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.cancelEditBtnText, { color: colors.muted }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={[styles.label, { color: colors.muted }]}>Send To</Text>
      <View style={styles.audienceRow}>
        {AUDIENCE_OPTIONS.map((option) => {
          const isActive = audience === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => onAudienceChange(option.value)}
              style={[
                styles.audienceCard,
                {
                  backgroundColor: isActive ? option.color : colors.card,
                  borderColor: isActive ? option.color : colors.border,
                },
              ]}
            >
              <Ionicons
                name={option.icon}
                size={18}
                color={isActive ? "#fff" : option.color}
              />
              <Text
                style={[styles.audienceLabel, { color: isActive ? "#fff" : colors.text }]}
                numberOfLines={2}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {(audience === "year" || audience === "course") && (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>College</Text>
          <View
            style={[
              styles.pickerBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Picker selectedValue={college} onValueChange={onCollegeChange} style={{ color: colors.text }}>
              <Picker.Item label="All Colleges" value="" />
              {COLLEGES.map((item) => (
                <Picker.Item key={item.value} label={item.label} value={item.value} />
              ))}
            </Picker>
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>Year Level</Text>
          <View
            style={[
              styles.pickerBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Picker selectedValue={year} onValueChange={onYearChange} style={{ color: colors.text }}>
              <Picker.Item label="Select Year" value="" />
              {YEAR_OPTIONS.map((item) => (
                <Picker.Item key={item} label={`Year ${item}`} value={item} />
              ))}
            </Picker>
          </View>
        </>
      )}

      {audience === "course" ? (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>Course</Text>
          <View
            style={[
              styles.pickerBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Picker selectedValue={course} onValueChange={onCourseChange} style={{ color: colors.text }}>
              <Picker.Item label="Select Course" value="" />
              {courseOptions.map((item) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>Section</Text>
          <View
            style={[
              styles.pickerBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Picker selectedValue={section} onValueChange={onSectionChange} style={{ color: colors.text }}>
              <Picker.Item label="Select Section" value="" />
              {SECTION_OPTIONS.map((item) => (
                <Picker.Item key={item} label={`Section ${item}`} value={item} />
              ))}
            </Picker>
          </View>
        </>
      ) : null}

      <Text style={[styles.label, { color: colors.muted }]}>Title *</Text>
      <TextInput
        placeholder="Announcement title"
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={onTitleChange}
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            borderColor: title ? "#f59e0b" : colors.border,
            color: colors.text,
          },
        ]}
      />

      <Text style={[styles.label, { color: colors.muted }]}>Message *</Text>
      <TextInput
        placeholder="Write your announcement here..."
        placeholderTextColor={colors.muted}
        value={message}
        onChangeText={onMessageChange}
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

      <Text style={[styles.label, { color: colors.muted }]}>Attach Image (Optional)</Text>
      <View
        style={[
          styles.imageCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {imageBase64 ? (
          <>
            <Image source={{ uri: imageBase64 }} style={styles.imagePreview} resizeMode="cover" />
            <View style={styles.imageActionsRow}>
              <TouchableOpacity
                style={[styles.imageBtn, { backgroundColor: "#f59e0b20" }]}
                onPress={onPickImage}
                disabled={pickingImage}
              >
                <Ionicons name="image-outline" size={15} color="#f59e0b" />
                <Text style={[styles.imageBtnText, { color: "#f59e0b" }]}>
                  {pickingImage ? "Processing..." : "Change"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.imageBtn, { backgroundColor: `${colors.danger}20` }]}
                onPress={onRemoveImage}
              >
                <Ionicons name="trash-outline" size={15} color={colors.danger} />
                <Text style={[styles.imageBtnText, { color: colors.danger }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.imagePickerBtn, { borderColor: colors.border }]}
            onPress={onPickImage}
            disabled={pickingImage}
          >
            <Ionicons name="image-outline" size={18} color="#f59e0b" />
            <Text style={[styles.imagePickerBtnText, { color: colors.text }]}>
              {pickingImage ? "Attaching image..." : "Choose image"}
            </Text>
            <Text style={[styles.imageHint, { color: colors.muted }]}>JPG/PNG up to {MAX_IMAGE_KB} KB</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.label, { color: colors.muted }]}>Image Note (Optional)</Text>
      <TextInput
        placeholder="Add a short note for this image..."
        placeholderTextColor={colors.muted}
        value={imageNote}
        onChangeText={onImageNoteChange}
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
      />

      {(title || message || imageBase64) ? (
        <View
          style={[
            styles.preview,
            {
              backgroundColor: colors.card,
              borderLeftColor: selectedAudience.color || "#f59e0b",
            },
          ]}
        >
          <Text style={[styles.previewLabel, { color: colors.muted }]}>Preview</Text>
          <Text style={[styles.previewTitle, { color: colors.text }]}>{title || "Title..."}</Text>
          <Text style={[styles.previewMessage, { color: colors.muted }]} numberOfLines={3}>
            {message || "Message..."}
          </Text>
          {imageBase64 ? (
            <View style={styles.previewMediaBox}>
              <Image source={{ uri: imageBase64 }} style={styles.previewImage} resizeMode="cover" />
              {!!(imageNote || "").trim() ? (
                <Text style={[styles.previewImageNote, { color: colors.muted }]}>
                  {(imageNote || "").trim()}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View
            style={[
              styles.previewBadge,
              { backgroundColor: `${selectedAudience.color || "#f59e0b"}20` },
            ]}
          >
            <Ionicons
              name={selectedAudience.icon || "people"}
              size={11}
              color={selectedAudience.color || "#f59e0b"}
            />
            <Text
              style={[
                styles.previewBadgeText,
                { color: selectedAudience.color || "#f59e0b" },
              ]}
            >
              {selectedAudience.label}
              {(audience === "year" || audience === "course") && college
                ? ` - ${getCollegeLabel(college)}`
                : ""}
              {audience === "year" && year ? ` - Year ${year}` : ""}
              {audience === "course" && course ? ` - ${course}` : ""}
            </Text>
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.postBtn, { backgroundColor: posting ? colors.muted : "#f59e0b" }]}
        onPress={onSubmit}
        disabled={posting}
        accessibilityLabel={isEditMode ? "Save announcement changes" : "Post announcement"}
        accessibilityHint={
          isEditMode
            ? "Updates this announcement"
            : "Sends the announcement to selected audience"
        }
      >
        <Ionicons
          name={posting ? "hourglass-outline" : isEditMode ? "save-outline" : "send"}
          size={18}
          color="#fff"
        />
        <Text style={styles.postBtnText}>
          {posting
            ? isEditMode
              ? "Saving..."
              : "Posting..."
            : isEditMode
              ? "Save Changes"
              : "Post Announcement"}
        </Text>
      </TouchableOpacity>
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 18 },
  editingBar: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editingBarTextWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  editingBarText: { fontSize: 12, fontWeight: "700" },
  cancelEditBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cancelEditBtnText: { fontSize: 11, fontWeight: "700" },
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
  previewMediaBox: { marginBottom: 10 },
  previewImage: { width: "100%", height: 140, borderRadius: 10 },
  previewImageNote: { fontSize: 11, marginTop: 6 },
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
});


