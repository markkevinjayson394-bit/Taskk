import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ScheduleBrowseCard({
  colors,
  isDark,
  item,
  courseColor,
  classCount,
  onEdit,
  onDelete,
}) {
  const label = `${item.course} - Y${item.year} - Sec ${item.section}`;

  return (
    <TouchableOpacity
      style={[
        styles.scheduleCard,
        {
          backgroundColor: colors.card,
          borderLeftColor: courseColor,
        },
      ]}
      onPress={onEdit}
      activeOpacity={0.8}
      accessibilityLabel={`Edit schedule for ${label}`}
      accessibilityHint="Opens the schedule editor"
    >
      <View style={styles.cardTop}>
        <View
          style={[
            styles.cardIconBox,
            { backgroundColor: `${courseColor}18` },
          ]}
        >
          <Ionicons name="calendar" size={20} color={courseColor} />
        </View>
        <View style={styles.cardTextWrap}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            {item.course}
          </Text>
          <Text style={[styles.cardSub, { color: colors.muted }]}>
            Year {item.year} - Section {item.section}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.deleteBtn, { backgroundColor: `${colors.danger}15` }]}
          onPress={onDelete}
          accessibilityLabel={`Delete schedule for ${label}`}
          accessibilityHint="Deletes this schedule permanently"
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        </TouchableOpacity>
      </View>

      <View style={styles.cardMeta}>
        {item.collegeLabel ? (
          <View
            style={[
              styles.metaPill,
              { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
            ]}
          >
            <Ionicons name="business-outline" size={11} color={colors.muted} />
            <Text style={[styles.metaPillText, { color: colors.muted }]}>
              {item.collegeLabel}
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.metaPill,
            { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
          ]}
        >
          <Ionicons name="school-outline" size={11} color={colors.muted} />
          <Text style={[styles.metaPillText, { color: colors.muted }]}>
            Year {item.year}
          </Text>
        </View>

        <View
          style={[
            styles.metaPill,
            { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
          ]}
        >
          <Ionicons name="time-outline" size={11} color={colors.muted} />
          <Text style={[styles.metaPillText, { color: colors.muted }]}>
            {item.scheduleType || "-"}
          </Text>
        </View>

        <View
          style={[
            styles.metaPill,
            { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
          ]}
        >
          <Ionicons name="book-outline" size={11} color={colors.muted} />
          <Text style={[styles.metaPillText, { color: colors.muted }]}>
            {classCount} class{classCount !== 1 ? "es" : ""}/week
          </Text>
        </View>

        {item.semester ? (
          <View
            style={[
              styles.metaPill,
              { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
            ]}
          >
            <Ionicons name="school-outline" size={11} color={colors.muted} />
            <Text style={[styles.metaPillText, { color: colors.muted }]}>
              {item.semester}
            </Text>
          </View>
        ) : null}

        {item.academicYear ? (
          <View
            style={[
              styles.metaPill,
              { backgroundColor: isDark ? "#1e293b" : "#f1f5f9" },
            ]}
          >
            <Ionicons name="calendar-outline" size={11} color={colors.muted} />
            <Text style={[styles.metaPillText, { color: colors.muted }]}>
              {item.academicYear}
            </Text>
          </View>
        ) : null}

        <View style={styles.editHint}>
          <Text style={[styles.editHintText, { color: courseColor }]}>Tap to edit</Text>
          <Ionicons name="pencil" size={11} color={courseColor} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scheduleCard: {
    borderRadius: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    paddingBottom: 8,
  },
  cardIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTextWrap: {
    flex: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  cardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metaPillText: { fontSize: 11 },
  editHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  editHintText: { fontSize: 11, fontWeight: "600" },
});
