import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

export default function ScheduleValidationAlerts({
  colors,
  missingHeaderFields,
  scheduleValidation,
}) {
  return (
    <>
      {missingHeaderFields ? (
        <View
          style={[
            styles.validationBanner,
            {
              borderColor: colors.danger,
              backgroundColor: `${colors.danger}14`,
            },
          ]}
        >
          <Ionicons name="warning-outline" size={16} color={colors.danger} />
          <Text style={[styles.validationBannerText, { color: colors.danger }]}>
            Fill all schedule details before saving.
          </Text>
        </View>
      ) : null}

      {scheduleValidation?.hasErrors ? (
        <View
          style={[
            styles.validationBanner,
            {
              borderColor: colors.danger,
              backgroundColor: `${colors.danger}14`,
            },
          ]}
        >
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={colors.danger}
          />
          <Text style={[styles.validationBannerText, { color: colors.danger }]}>
            Fix {scheduleValidation.totalIssues} class issue
            {scheduleValidation.totalIssues === 1 ? "" : "s"} before saving.
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  validationBanner: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  validationBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
});
