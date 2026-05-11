import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ScheduleClonePanel({
  colors,
  cloneYear,
  cloneSection,
  yearOptions,
  sectionOptions,
  sourceYear,
  sourceSection,
  onCloneYearChange,
  onCloneSectionChange,
  onClone,
}) {
  const disabled =
    String(cloneYear) === String(sourceYear) &&
    String(cloneSection) === String(sourceSection);

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.cloneHeader}>
        <Text style={[styles.cloneTitle, { color: colors.text }]}>
          Clone Schedule
        </Text>
        <Text style={[styles.cloneSub, { color: colors.muted }]}>
          Copy this schedule to another year or section.
        </Text>
      </View>

      <View style={styles.clonePickerRow}>
        <View style={[styles.cloneField, { borderColor: colors.border }]}>
          <Text style={[styles.cloneLabel, { color: colors.muted }]}>Year</Text>
          <Picker
            selectedValue={cloneYear}
            onValueChange={(value) => onCloneYearChange(String(value))}
            style={{ color: colors.text }}
          >
            {yearOptions.map((yearValue) => (
              <Picker.Item
                key={`clone-year-${yearValue}`}
                label={`Year ${yearValue}`}
                value={yearValue}
              />
            ))}
          </Picker>
        </View>

        <View style={[styles.cloneField, { borderColor: colors.border }]}>
          <Text style={[styles.cloneLabel, { color: colors.muted }]}>Section</Text>
          <Picker
            selectedValue={cloneSection}
            onValueChange={(value) => onCloneSectionChange(String(value))}
            style={{ color: colors.text }}
          >
            {sectionOptions.map((sectionValue) => (
              <Picker.Item
                key={`clone-section-${sectionValue}`}
                label={sectionValue}
                value={sectionValue}
              />
            ))}
          </Picker>
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.cloneBtn,
          {
            backgroundColor: colors.primary,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
        onPress={onClone}
        disabled={disabled}
      >
        <Ionicons name="copy-outline" size={15} color="#fff" />
        <Text style={styles.cloneBtnText}>Clone to Target</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  cloneHeader: {
    marginBottom: 8,
  },
  cloneTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  cloneSub: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  clonePickerRow: {
    flexDirection: "row",
    gap: 8,
  },
  cloneField: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  cloneLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  cloneBtn: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  cloneBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
});

