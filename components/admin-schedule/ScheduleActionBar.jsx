import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ScheduleActionBar({
  colors,
  canSaveSchedule,
  showDelete,
  onSave,
  onDelete,
}) {
  return (
    <View style={styles.actions}>
      <TouchableOpacity
        style={[
          styles.saveBtn,
          {
            backgroundColor: colors.success,
            opacity: canSaveSchedule ? 1 : 0.55,
          },
        ]}
        onPress={onSave}
        disabled={!canSaveSchedule}
      >
        <Text style={styles.primaryText}>
          {canSaveSchedule ? "Save Schedule" : "Fix Issues to Save"}
        </Text>
      </TouchableOpacity>

      {showDelete ? (
        <TouchableOpacity
          style={[styles.deleteBtn, { backgroundColor: colors.danger }]}
          onPress={onDelete}
        >
          <Text style={styles.primaryText}>Delete Schedule</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: 20,
    gap: 10,
  },
  saveBtn: {
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  deleteBtn: {
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
