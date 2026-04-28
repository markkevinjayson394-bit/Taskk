import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

function formatYearOptionLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const suffix = text === "1" ? "st" : text === "2" ? "nd" : text === "3" ? "rd" : "th";
  return `${text}${suffix} Year`;
}

export default function ScheduleDetailsSection({
  colors,
  college,
  course,
  year,
  section,
  semester,
  academicYear,
  scheduleType,
  collegeOptions,
  courseOptions,
  yearOptions,
  sectionOptions,
  semesterOptions,
  academicYearOptions,
  onCollegeChange,
  onCourseChange,
  onYearChange,
  onSectionChange,
  onSemesterChange,
  onScheduleTypeChange,
  onAcademicYearChange,
  onShiftAcademicYear,
}) {
  const surfaceColor = colors.surface || colors.background;

  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Schedule Details</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Set the section, term, and school-year metadata before adding classes.</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: `${colors.primary}18` }]}>
          <Text style={[styles.badgeText, { color: colors.primary }]}>ADMIN</Text>
        </View>
      </View>

      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: colors.text }]}>College</Text>
        <View style={[styles.pickerShell, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
          <Picker selectedValue={college} onValueChange={onCollegeChange} style={{ color: colors.text }}>
            {collegeOptions.map((item) => (
              <Picker.Item key={item.value} label={item.label} value={item.value} />
            ))}
          </Picker>
        </View>
      </View>

      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: colors.text }]}>Course</Text>
        <View style={[styles.pickerShell, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
          <Picker selectedValue={course} onValueChange={onCourseChange} style={{ color: colors.text }}>
            {courseOptions.length === 0 ? (
              <Picker.Item label="No courses available" value="" />
            ) : (
              courseOptions.map((item) => <Picker.Item key={item} label={item} value={item} />)
            )}
          </Picker>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.fieldBlock, styles.rowField]}>
          <Text style={[styles.label, { color: colors.text }]}>Year</Text>
          <View style={[styles.pickerShell, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
            <Picker selectedValue={year} onValueChange={onYearChange} style={{ color: colors.text }}>
              {yearOptions.map((item) => (
                <Picker.Item key={item} label={formatYearOptionLabel(item)} value={item} />
              ))}
            </Picker>
          </View>
        </View>

        <View style={[styles.fieldBlock, styles.rowField]}>
          <Text style={[styles.label, { color: colors.text }]}>Section</Text>
          <View style={[styles.pickerShell, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
            <Picker selectedValue={section} onValueChange={onSectionChange} style={{ color: colors.text }}>
              {sectionOptions.map((item) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.fieldBlock, styles.rowField]}>
          <Text style={[styles.label, { color: colors.text }]}>Schedule Type</Text>
          <View style={[styles.pickerShell, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
            <Picker selectedValue={scheduleType} onValueChange={onScheduleTypeChange} style={{ color: colors.text }}>
              <Picker.Item label="Day" value="Day" />
              <Picker.Item label="Night" value="Night" />
            </Picker>
          </View>
        </View>

        <View style={[styles.fieldBlock, styles.rowField]}>
          <Text style={[styles.label, { color: colors.text }]}>Semester</Text>
          <View style={[styles.pickerShell, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
            <Picker selectedValue={semester} onValueChange={onSemesterChange} style={{ color: colors.text }}>
              {semesterOptions.map((item) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>
        </View>
      </View>

      <View style={[styles.schoolYearCard, { borderColor: colors.border, backgroundColor: surfaceColor }]}>
        <View style={styles.schoolYearHeader}>
          <Text style={[styles.label, { color: colors.text }]}>School Year</Text>
          <View style={[styles.schoolYearBadge, { backgroundColor: `${colors.primary}18` }]}>
            <Text style={[styles.schoolYearBadgeText, { color: colors.primary }]}>SY</Text>
          </View>
        </View>

        <View style={styles.schoolYearRow}>
          <TouchableOpacity
            style={[styles.yearNavBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => onShiftAcademicYear(-1)}
            accessibilityLabel="Previous school year"
          >
            <Ionicons name="chevron-back" size={16} color={colors.text} />
          </TouchableOpacity>

          <View style={[styles.schoolYearValueBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.schoolYearValue, { color: colors.text }]}>{academicYear}</Text>
            <Text style={[styles.schoolYearSub, { color: colors.muted }]}>Select the school year</Text>
          </View>

          <TouchableOpacity
            style={[styles.yearNavBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => onShiftAcademicYear(1)}
            accessibilityLabel="Next school year"
          >
            <Ionicons name="chevron-forward" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.schoolYearChips}>
          {academicYearOptions.map((yearValue) => {
            const selected = yearValue === academicYear;
            return (
              <TouchableOpacity
                key={yearValue}
                style={[
                  styles.schoolYearChip,
                  {
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? `${colors.primary}22` : colors.card,
                  },
                ]}
                onPress={() => onAcademicYearChange(yearValue)}
              >
                <Text style={[styles.schoolYearChipText, { color: selected ? colors.primary : colors.text }]}>
                  {yearValue}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 260,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  rowField: {
    flex: 1,
  },
  fieldBlock: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
  },
  pickerShell: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  schoolYearCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  schoolYearHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  schoolYearBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  schoolYearBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  schoolYearRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  yearNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  schoolYearValueBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  schoolYearValue: {
    fontSize: 16,
    fontWeight: "800",
  },
  schoolYearSub: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  schoolYearChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  schoolYearChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  schoolYearChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
