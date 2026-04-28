import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatSyncTime, useOffline } from "../context/OfflineContext";
import { useTheme } from "../context/ThemeContext";
import { warnIfDev } from "../utils/logger";

export default function OfflineBanner({ uid }) {
  const {
    isOnline,
    lastSync,
    checkConnectivity,
    pendingSyncSummary,
    refreshPendingSyncSummary,
  } = useOffline();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (isOnline) return null;

  const pendingTotal = Number(pendingSyncSummary?.total || 0);
  const pendingText = pendingTotal > 0
    ? `${pendingTotal} pending sync update${pendingTotal > 1 ? "s" : ""}`
    : `Cached mode - last sync ${formatSyncTime(lastSync)}`;

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: isDark ? "#0f172a" : "#1f2937",
          borderBottomColor: isDark ? "#1e293b" : "#374151",
          top: insets.top,
        },
      ]}
    >
      <View style={styles.left}>
        <View style={styles.iconBox}>
          <Ionicons name="wifi-outline" size={14} color="#fff" />
          <View style={styles.slash} />
        </View>
        <View>
          <Text style={styles.title}>You are offline</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{pendingText}</Text>
        </View>
      </View>
      <TouchableOpacity
        style={[
          styles.retryBtn,
          {
            backgroundColor: isDark
              ? "rgba(59,130,246,0.26)"
              : "rgba(59,130,246,0.22)",
          },
        ]}
        onPress={async () => {
          try {
            await checkConnectivity();
            const activeUid = uid || null;
            if (activeUid) {
              await refreshPendingSyncSummary(activeUid);
            }
          } catch (error) {
            warnIfDev("OfflineBanner: retry action failed:", error);
          }
        }}
      >
        <Ionicons name="refresh" size={14} color="#fff" />
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "#1e293b",
    borderBottomWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", zIndex: 999,
  },
  left:    { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  iconBox: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: "#ef4444",
    justifyContent: "center", alignItems: "center",
  },
  slash: {
    position: "absolute", width: 18, height: 2,
    backgroundColor: "#fff", borderRadius: 1,
    transform: [{ rotate: "45deg" }],
  },
  title:     { color: "#fff", fontSize: 13, fontWeight: "700" },
  sub:       { fontSize: 11, marginTop: 1 },
  retryBtn:  {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  retryText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
