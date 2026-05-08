import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

function InlineHint({ visible, children, colors }) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [render, setRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRender(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRender(false);
      });
    }
  }, [opacity, visible]);

  if (!render) return null;

  return (
    <Animated.Text
      style={[styles.inlineHint, { opacity, color: colors.muted }]}
    >
      {children}
    </Animated.Text>
  );
}

function getTimeParts(dateString) {
  if (!dateString) return { time: "", suffix: "" };
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return { time: "", suffix: "" };
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return { time: `${hours12}:${minutes}`, suffix };
}

function formatDuration(totalMinutes) {
  const mins = Math.max(0, totalMinutes || 0);
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function getDurationLabel(cls) {
  if (!cls?.start || !cls?.end) return "";
  const startDate = new Date(cls.start);
  const endDate = new Date(cls.end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "";
  }
  let startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  let endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
  if (endMinutes <= startMinutes) return "";
  return formatDuration(endMinutes - startMinutes);
}

export default function ScheduleDaySection({
  colors,
  day,
  classes,
  dayValidation,
  copiedDay,
  repeatEditor,
  repeatTargets,
  daysOfWeek,
  onAddClass,
  onCopyDay,
  onPasteDay,
  onUpdateClass,
  onDeleteClass,
  onOpenTimePicker,
  onStartRepeatClass,
  onToggleRepeatTarget,
  onCancelRepeatClass,
  onApplyRepeatClass,
}) {
  const dayIssueCount = Object.keys(dayValidation || {}).length;

  return (
    <View>
      <View style={styles.dayHeader}>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => onAddClass(day)}
        >
          <Text style={styles.buttonText}>+ Add {day}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.copyButton, { backgroundColor: "#f59e0b" }]}
          onPress={() => onCopyDay(day)}
        >
          <Text style={styles.buttonText}>Copy</Text>
        </TouchableOpacity>

        {copiedDay && copiedDay !== day ? (
          <TouchableOpacity
            style={[styles.pasteButton, { backgroundColor: colors.success }]}
            onPress={() => onPasteDay(day)}
          >
            <Text style={styles.buttonText}>Paste from {copiedDay}</Text>
          </TouchableOpacity>
        ) : null}

        {dayIssueCount > 0 ? (
          <View
            style={[styles.dayIssuePill, { backgroundColor: `${colors.danger}18` }]}
          >
            <Ionicons
              name="alert-circle-outline"
              size={13}
              color={colors.danger}
            />
            <Text style={[styles.dayIssueText, { color: colors.danger }]}>
              {dayIssueCount} issue{dayIssueCount === 1 ? "" : "s"}
            </Text>
          </View>
        ) : null}
      </View>

      {(classes || []).map((cls, index) => {
        const startParts = getTimeParts(cls.start);
        const endParts = getTimeParts(cls.end);
        const durationLabel = getDurationLabel(cls);
        const classValidation = dayValidation[index] || {};
        const timeHasIssue =
          classValidation.timeMissing ||
          classValidation.invalidRange ||
          classValidation.overlap;
        const isRepeatOpen =
          repeatEditor?.day === day && repeatEditor?.stableId === cls.id;

        return (
          <View
            key={cls.id || `${day}-${index}`}
            style={[styles.card, { backgroundColor: colors.card }]}
          >
            <TextInput
              placeholder="Subject"
              placeholderTextColor={colors.muted}
              value={cls.subject}
              onChangeText={(text) => onUpdateClass(day, index, "subject", text)}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: classValidation.subjectMissing
                    ? colors.danger
                    : colors.border,
                },
              ]}
            />
            <InlineHint
              visible={Boolean(classValidation.subjectMissing)}
              colors={colors}
            >
              Add a subject
            </InlineHint>

            <TextInput
              placeholder="Teacher"
              placeholderTextColor={colors.muted}
              value={cls.teacher}
              onChangeText={(text) => onUpdateClass(day, index, "teacher", text)}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: classValidation.teacherMissing
                    ? colors.danger
                    : colors.border,
                },
              ]}
            />
            <InlineHint
              visible={Boolean(classValidation.teacherMissing)}
              colors={colors}
            >
              Add a teacher
            </InlineHint>

            <View style={styles.timeRow}>
              <TouchableOpacity
                style={[
                  styles.timeTile,
                  {
                    borderColor: timeHasIssue ? colors.danger : colors.border,
                    backgroundColor: cls.start
                      ? `${colors.primary}18`
                      : colors.surface || colors.background,
                  },
                ]}
                onPress={() =>
                  onOpenTimePicker({ day, index, field: "start" })
                }
              >
                <View style={styles.timeTileHeader}>
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color={colors.muted}
                  />
                  <Text style={[styles.timeLabel, { color: colors.muted }]}>
                    Start
                  </Text>
                </View>
                {cls.start ? (
                  <View style={styles.timeValueRow}>
                    <Text style={[styles.timeValue, { color: colors.text }]}>
                      {startParts.time}
                    </Text>
                    <View
                      style={[
                        styles.ampmPill,
                        {
                          backgroundColor:
                            startParts.suffix === "AM"
                              ? `${colors.success}22`
                              : `${colors.primary}22`,
                          borderColor:
                            startParts.suffix === "AM"
                              ? colors.success
                              : colors.primary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.ampmText,
                          {
                            color:
                              startParts.suffix === "AM"
                                ? colors.success
                                : colors.primary,
                          },
                        ]}
                      >
                        {startParts.suffix}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    Set time
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.timeTile,
                  {
                    borderColor: timeHasIssue ? colors.danger : colors.border,
                    backgroundColor: cls.end
                      ? `${colors.primary}18`
                      : colors.surface || colors.background,
                  },
                ]}
                onPress={() =>
                  onOpenTimePicker({ day, index, field: "end" })
                }
              >
                <View style={styles.timeTileHeader}>
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color={colors.muted}
                  />
                  <Text style={[styles.timeLabel, { color: colors.muted }]}>
                    End
                  </Text>
                </View>
                {cls.end ? (
                  <View style={styles.timeValueRow}>
                    <Text style={[styles.timeValue, { color: colors.text }]}>
                      {endParts.time}
                    </Text>
                    <View
                      style={[
                        styles.ampmPill,
                        {
                          backgroundColor:
                            endParts.suffix === "AM"
                              ? `${colors.success}22`
                              : `${colors.primary}22`,
                          borderColor:
                            endParts.suffix === "AM"
                              ? colors.success
                              : colors.primary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.ampmText,
                          {
                            color:
                              endParts.suffix === "AM"
                                ? colors.success
                                : colors.primary,
                          },
                        ]}
                      >
                        {endParts.suffix}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    Set time
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <InlineHint
              visible={Boolean(classValidation.timeMissing)}
              colors={colors}
            >
              Set start and end time
            </InlineHint>
            {classValidation.invalidRange ? (
              <Text style={[styles.validationText, { color: colors.danger }]}>
                End time must be after start time.
              </Text>
            ) : null}
            {classValidation.overlap ? (
              <Text style={[styles.validationText, { color: colors.danger }]}>
                Time overlaps another class in {day}.
              </Text>
            ) : null}

            {durationLabel ? (
              <Text style={[styles.durationText, { color: colors.muted }]}> 
                Duration: {durationLabel}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.repeatBtn,
                {
                  backgroundColor: colors.highlight || `${colors.primary}20`,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => onStartRepeatClass(day, index)}
            >
              <Ionicons
                name="repeat-outline"
                size={14}
                color={colors.primary}
              />
              <Text style={[styles.repeatBtnText, { color: colors.primary }]}>
                {isRepeatOpen ? "Close Repeat" : "Repeat to Days"}
              </Text>
            </TouchableOpacity>

            {isRepeatOpen ? (
              <View
                style={[
                  styles.repeatPanel,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface || colors.background,
                  },
                ]}
              >
                <Text style={[styles.repeatPanelTitle, { color: colors.text }]}>
                  Copy this class to:
                </Text>
                <View style={styles.repeatChipRow}>
                  {daysOfWeek
                    .filter((dayName) => dayName !== day)
                    .map((dayName) => {
                      const selected = Boolean(repeatTargets[dayName]);
                      return (
                        <TouchableOpacity
                          key={`${day}-${index}-${dayName}`}
                          style={[
                            styles.repeatChip,
                            {
                              borderColor: selected
                                ? colors.primary
                                : colors.border,
                              backgroundColor: selected
                                ? `${colors.primary}20`
                                : colors.card,
                            },
                          ]}
                          onPress={() => onToggleRepeatTarget(dayName)}
                        >
                          <Text
                            style={[
                              styles.repeatChipText,
                              {
                                color: selected ? colors.primary : colors.text,
                              },
                            ]}
                          >
                            {dayName.slice(0, 3)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                </View>
                <View style={styles.repeatActionRow}>
                  <TouchableOpacity
                    style={[
                      styles.repeatActionBtn,
                      { borderColor: colors.border, backgroundColor: colors.card },
                    ]}
                    onPress={onCancelRepeatClass}
                  >
                    <Text style={[styles.repeatActionText, { color: colors.text }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.repeatActionBtn,
                      styles.repeatApplyBtn,
                      { backgroundColor: colors.primary },
                    ]}
                    onPress={onApplyRepeatClass}
                  >
                    <Text style={[styles.repeatActionText, { color: "#fff" }]}>
                      Apply
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.deleteBtn, { backgroundColor: colors.danger }]}
              onPress={() => onDeleteClass(day, index)}
            >
              <Text style={styles.buttonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dayHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
  },
  addButton: {
    padding: 8,
    borderRadius: 8,
    marginTop: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
  },
  copyButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  pasteButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  dayIssuePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dayIssueText: {
    fontSize: 11,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 5,
  },
  timeRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  timeTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timeTileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  timeValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  timeValue: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    alignSelf: "center",
  },
  ampmPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ampmText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  inlineHint: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
  validationText: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  durationText: {
    fontSize: 12,
    marginTop: 2,
  },
  repeatBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  repeatBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  repeatPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  repeatPanelTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  repeatChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  repeatChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  repeatChipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  repeatActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  repeatActionBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  repeatApplyBtn: {
    borderWidth: 0,
  },
  repeatActionText: {
    fontSize: 12,
    fontWeight: "700",
  },
  deleteBtn: {
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    alignItems: "center",
  },
});




