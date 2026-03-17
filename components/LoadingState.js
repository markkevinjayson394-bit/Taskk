import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";

export default function LoadingState({ label = "Loading...", fullScreen = false, style }) {
  const { colors } = useTheme();

  return (
    <View style={[fullScreen ? styles.full : styles.inline, style]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.text, { color: colors.muted }]}>{label}</Text>
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
  text: { marginTop: 10, fontSize: 13, fontWeight: "600" },
});
