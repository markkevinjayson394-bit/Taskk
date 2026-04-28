import { Picker } from "@react-native-picker/picker";
import { Platform, StyleSheet, Text, View } from "react-native";

export default function ScheduleFiltersBar({
  colors,
  filterCollege,
  filterCourse,
  filterYear,
  collegeOptions,
  courseOptions,
  yearOptions,
  onCollegeChange,
  onCourseChange,
  onYearChange,
}) {
  return (
    <View
      style={[
        styles.filterRow,
        { backgroundColor: colors.card, borderBottomColor: colors.border },
      ]}
    >
      <View style={[styles.filterBox, { borderColor: colors.border }]}>
        <Text style={[styles.filterLabel, { color: colors.muted }]}>College</Text>
        <View style={styles.pickerWrap}>
          <Picker
            mode="dropdown"
            dropdownIconColor={colors.text}
            selectedValue={filterCollege}
            onValueChange={onCollegeChange}
            style={[styles.picker, { color: colors.text }]}
          >
            <Picker.Item label="All Colleges" value="All" />
            {collegeOptions.map((item) => (
              <Picker.Item key={item.value} label={item.label} value={item.value} />
            ))}
          </Picker>
        </View>
      </View>

      <View style={[styles.filterBox, { borderColor: colors.border }]}>
        <Text style={[styles.filterLabel, { color: colors.muted }]}>Course</Text>
        <View style={styles.pickerWrap}>
          <Picker
            mode="dropdown"
            dropdownIconColor={colors.text}
            selectedValue={filterCourse}
            onValueChange={onCourseChange}
            style={[styles.picker, { color: colors.text }]}
          >
            <Picker.Item label="All Courses" value="All" />
            {courseOptions.map((course) => (
              <Picker.Item key={course} label={course} value={course} />
            ))}
          </Picker>
        </View>
      </View>

      <View style={[styles.filterBox, { borderColor: colors.border }]}>
        <Text style={[styles.filterLabel, { color: colors.muted }]}>Year</Text>
        <View style={styles.pickerWrap}>
          <Picker
            mode="dropdown"
            dropdownIconColor={colors.text}
            selectedValue={filterYear}
            onValueChange={onYearChange}
            style={[styles.picker, { color: colors.text }]}
          >
            <Picker.Item label="All Years" value="All" />
            {yearOptions.map((yearValue) => (
              <Picker.Item
                key={yearValue}
                label={Number.isNaN(Number(yearValue)) ? yearValue : `Year ${yearValue}`}
                value={yearValue}
              />
            ))}
          </Picker>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  filterBox: {
    flex: 1,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === "android" ? 8 : 10,
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: 8,
    paddingLeft: 4,
  },
  pickerWrap: {
    borderRadius: 10,
    overflow: Platform.OS === "android" ? "visible" : "hidden",
  },
  picker: {
    width: "100%",
    height: Platform.OS === "android" ? 52 : 44,
    marginTop: 0,
  },
});
