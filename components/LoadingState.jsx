import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";

export default function LoadingState({ label = "Loading...", fullScreen = false, style }) {
  const { colors, isDark } = useTheme();

  return (
    <View
      style={[
        fullScreen ? styles.full : styles.inline,
        { backgroundColor: fullScreen ? colors.background : "transparent" },
        style,
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowColor: colors.shadow,
          },
        ]}
      >
        <View
          style={[
            styles.spinnerWrap,
            { backgroundColor: isDark ? "rgba(59,130,246,0.18)" : "#eaf2ff" },
          ]}
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <Text style={[styles.text, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.subtext, { color: colors.muted }]}>
          Preparing your workspace
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  inline: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  card: {
    minWidth: 180,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderRadius: 20,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 4,
  },
  spinnerWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  text: { fontSize: 14, fontWeight: "700" },
  subtext: { marginTop: 4, fontSize: 12, fontWeight: "500" },
});
