import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatSyncTime, useOffline } from "../context/OfflineContext";

export default function OfflineBanner() {
  const { isOnline, lastSync, checkConnectivity } = useOffline();
  const slideAnim   = useRef(new Animated.Value(-60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isOnline) {
      Animated.parallel([
        Animated.spring(slideAnim,   { toValue: 0,   tension: 80, friction: 12, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1,   duration: 250,             useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim,   { toValue: -60, duration: 300, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0,   duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [isOnline]);

  return (
    <Animated.View style={[
      styles.banner,
      { transform: [{ translateY: slideAnim }], opacity: opacityAnim },
    ]}>
      <View style={styles.left}>
        <View style={styles.iconBox}>
          <Ionicons name="wifi" size={14} color="#fff" />
          <View style={styles.slash} />
        </View>
        <View>
          <Text style={styles.title}>You're offline</Text>
          <Text style={styles.sub}>
            Showing cached data · Synced {formatSyncTime(lastSync)}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.retryBtn} onPress={checkConnectivity}>
        <Ionicons name="refresh" size={14} color="#fff" />
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#1e293b",
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
  sub:       { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 1 },
  retryBtn:  {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  retryText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});