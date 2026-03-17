import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Linking,
  NativeModules,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyStateCard from "../../components/EmptyStateCard";
import LoadingState from "../../components/LoadingState";
import { useNotifications } from "../../context/NotificationContext";
import { useTheme } from "../../context/ThemeContext";

const RANGE_OPTIONS = [
  { label: "Today", days: 1 },
  { label: "7 Days", days: 7 },
];

const AppUsageModule = NativeModules.AppUsageModule;

function formatDuration(ms) {
  const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
  if (hours > 0) return `${hours}h`;
  return `${rem}m`;
}

function formatLastUsed(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return "No recent activity";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "No recent activity";
  return `Last used ${date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export default function AppUsageScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { appUsageMin, weekUsageMin } = useNotifications();

  const [rangeDays, setRangeDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [apps, setApps] = useState([]);
  const [error, setError] = useState("");

  const moduleAvailable =
    Platform.OS === "android" &&
    typeof AppUsageModule?.isUsagePermissionGranted === "function" &&
    typeof AppUsageModule?.getUsageStats === "function";

  if (__DEV__) {
    console.log(
      "AppUsage module available:",
      moduleAvailable,
      "AppUsageModule:",
      AppUsageModule
    );
  }
  const canOpenUsageSettings =
    typeof AppUsageModule?.openUsageAccessSettings === "function";
  const openAppSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn("Failed to open app settings:", err);
    }
  };
  const openUsageAccess = async () => {
    if (canOpenUsageSettings) {
      try {
        await AppUsageModule.openUsageAccessSettings();
        return;
      } catch (err) {
        console.warn("Failed to open usage access settings:", err);
      }
    }
    await openAppSettings();
  };

  const loadUsage = useCallback(
    async (showLoader = true, isActive = () => true) => {
      if (showLoader && isActive()) setLoading(true);

      if (!moduleAvailable) {
        if (isActive()) {
          setPermissionGranted(false);
          setApps([]);
          setError(
            "Device app usage data is unavailable on this device or build."
          );
          if (showLoader) setLoading(false);
        }
        return;
      }

      try {
        const granted = Boolean(
          await AppUsageModule.isUsagePermissionGranted()
        );
        console.log("AppUsage permission granted:", granted);
        if (!isActive()) return;
        setPermissionGranted(granted);

        if (!granted) {
          setApps([]);
          setError("Enable Usage Access to show device-wide app usage.");
          if (showLoader) setLoading(false);
          return;
        }

        const raw = await AppUsageModule.getUsageStats(rangeDays, 60);
        console.log("AppUsage raw data:", raw);
        if (!isActive()) return;
        const normalized = Array.isArray(raw)
          ? raw
              .map((item) => ({
                appName: String(
                  item?.appName || item?.packageName || "Unknown App"
                ),
                packageName: String(item?.packageName || ""),
                totalTimeForegroundMs: Number(item?.totalTimeForegroundMs || 0),
                lastTimeUsed: Number(item?.lastTimeUsed || 0),
                isCurrentApp: Boolean(item?.isCurrentApp),
              }))
              .filter(
                (item) =>
                  item.totalTimeForegroundMs > 0 || item.lastTimeUsed > 0
              )
              .sort((a, b) => b.totalTimeForegroundMs - a.totalTimeForegroundMs)
          : [];

        console.log("AppUsage normalized:", normalized);

        setApps(normalized);
        setError("");
      } catch (e) {
        if (!isActive()) return;
        setApps([]);
        setError(e?.message || "Failed to load app usage data.");
      } finally {
        if (showLoader && isActive()) setLoading(false);
      }
    },
    [moduleAvailable, rangeDays]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadUsage(true, () => active);
      return () => {
        active = false;
      };
    }, [loadUsage])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadUsage(false);
    setRefreshing(false);
  }, [loadUsage]);

  const totalTrackedMs = useMemo(
    () => apps.reduce((sum, item) => sum + item.totalTimeForegroundMs, 0),
    [apps]
  );
  const topMs = apps.length ? apps[0].totalTimeForegroundMs : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />

      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.primary,
            paddingTop: insets.top + 14,
          },
        ]}
      >
        <View style={styles.headerCircle} />
        <View style={styles.headerCircle2} />
        <Text style={styles.headerSub}>Device usage overview</Text>
        <Text style={styles.headerTitle}>Device App Usage</Text>
        <Text style={styles.headerMeta}>
          Shows other apps on your phone. Separate from in-app focus time.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 24 + insets.bottom,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.thisAppCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.thisAppTopRow}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: `${colors.primary}18` },
              ]}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                This App Focus Time
              </Text>
              <Text style={[styles.cardSub, { color: colors.muted }]}>
                Tracked by your session timer
              </Text>
            </View>
          </View>
          <View style={styles.thisAppStatsRow}>
            <View
              style={[
                styles.thisAppPill,
                { backgroundColor: isDark ? "#0f172a" : "#eff6ff" },
              ]}
            >
              <Text style={[styles.thisAppPillLabel, { color: colors.muted }]}>
                Today
              </Text>
              <Text style={[styles.thisAppPillValue, { color: colors.text }]}>
                {formatDuration(appUsageMin * 60000)}
              </Text>
            </View>
            <View
              style={[
                styles.thisAppPill,
                { backgroundColor: isDark ? "#052e16" : "#ecfdf3" },
              ]}
            >
              <Text style={[styles.thisAppPillLabel, { color: colors.muted }]}>
                Last 7 days
              </Text>
              <Text style={[styles.thisAppPillValue, { color: colors.text }]}>
                {formatDuration(weekUsageMin * 60000)}
              </Text>
            </View>
          </View>
        </View>
        <View
          style={[
            styles.infoNote,
            {
              backgroundColor: isDark ? "#0f172a" : "#eff6ff",
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.infoNoteText, { color: colors.muted }]}>
            Device usage below comes from Usage Access and updates every few
            minutes.
          </Text>
        </View>

        {!permissionGranted && (
          <View
            style={[
              styles.permissionCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.permissionTitleRow}>
              <Ionicons name="lock-open-outline" size={18} color="#f59e0b" />
              <Text style={[styles.permissionTitle, { color: colors.text }]}>
                Usage Permission Required
              </Text>
            </View>
            <Text style={[styles.permissionBody, { color: colors.muted }]}>
              Allow Usage Access to show device-wide app usage (Android only).
            </Text>
            <Text style={[styles.permissionNote, { color: colors.muted }]}>
              If this app is missing in the Usage Access list, install the full
              APK build and reopen Usage Access.
            </Text>
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={openUsageAccess}
              accessibilityLabel="Open usage access settings"
              accessibilityHint="Opens the settings to grant usage access permission"
            >
              <Ionicons name="open-outline" size={14} color="#fff" />
              <Text style={styles.permissionBtnText}>
                Open Usage Access Settings
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.permissionBtn, { backgroundColor: "#111827" }]}
              onPress={openAppSettings}
              accessibilityLabel="Open app settings"
              accessibilityHint="Opens the general app settings"
            >
              <Ionicons name="settings-outline" size={14} color="#fff" />
              <Text style={styles.permissionBtnText}>Open App Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>
            Other Apps on Device
          </Text>
          <View
            style={[
              styles.rangeWrap,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {RANGE_OPTIONS.map((opt) => {
              const active = opt.days === rangeDays;
              return (
                <TouchableOpacity
                  key={opt.days}
                  onPress={() => setRangeDays(opt.days)}
                  style={[
                    styles.rangeChip,
                    {
                      backgroundColor: active ? colors.primary : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.rangeChipText,
                      { color: active ? "#fff" : colors.muted },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View
          style={[
            styles.summaryRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>
              Apps shown
            </Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {apps.length}
            </Text>
          </View>
          <View
            style={[styles.summaryDivider, { backgroundColor: colors.border }]}
          />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>
              Total tracked
            </Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {formatDuration(totalTrackedMs)}
            </Text>
          </View>
        </View>

        {loading ? (
          <LoadingState label="Loading app usage..." />
        ) : !moduleAvailable ? (
          <EmptyStateCard
            title="Usage unavailable"
            message="Device app usage data is unavailable on this device or build."
            icon="phone-portrait-outline"
            tone="warn"
            actionLabel="Open App Settings"
            onAction={openAppSettings}
          />
        ) : !permissionGranted ? (
          <EmptyStateCard
            title="Usage Access Required"
            message="Enable Usage Access to view device-wide app usage."
            icon="lock-open-outline"
            actionLabel={
              canOpenUsageSettings ? "Open Usage Access" : "Open Settings"
            }
            onAction={openUsageAccess}
          />
        ) : apps.length > 0 ? (
          apps.map((item, index) => {
            const percent =
              topMs > 0
                ? Math.max(
                    4,
                    Math.round((item.totalTimeForegroundMs / topMs) * 100)
                  )
                : 0;
            return (
              <View
                key={`${item.packageName}_${index}`}
                style={[
                  styles.appCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.appTopRow}>
                  <View
                    style={[
                      styles.rankBubble,
                      { backgroundColor: `${colors.primary}1a` },
                    ]}
                  >
                    <Text style={[styles.rankText, { color: colors.primary }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.appName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.appName}
                    </Text>
                    <Text
                      style={[styles.appPackage, { color: colors.muted }]}
                      numberOfLines={1}
                    >
                      {item.packageName}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.appDuration, { color: colors.text }]}>
                      {formatDuration(item.totalTimeForegroundMs)}
                    </Text>
                    {item.isCurrentApp && (
                      <Text style={styles.currentBadge}>Current app</Text>
                    )}
                  </View>
                </View>
                <View
                  style={[
                    styles.track,
                    { backgroundColor: isDark ? "#1e293b" : "#e2e8f0" },
                  ]}
                >
                  <View
                    style={[
                      styles.fill,
                      { width: `${percent}%`, backgroundColor: colors.primary },
                    ]}
                  />
                </View>
                <Text style={[styles.lastUsed, { color: colors.muted }]}>
                  {formatLastUsed(item.lastTimeUsed)}
                </Text>
              </View>
            );
          })
        ) : (
          <EmptyStateCard
            title="No app usage data yet"
            message={
              error || "Open a few apps first, then pull down to refresh."
            }
            icon="stats-chart-outline"
          />
        )}

        {error && apps.length > 0 && (
          <Text style={[styles.inlineError, { color: "#dc2626" }]}>
            {error}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },
  headerCircle: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: "rgba(255,255,255,0.08)",
    top: -38,
    right: -26,
  },
  headerCircle2: {
    position: "absolute",
    width: 102,
    height: 102,
    borderRadius: 51,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 6,
    right: 60,
  },
  headerSub: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
  headerTitle: { color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 2 },
  headerMeta: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    marginTop: 4,
    fontWeight: "600",
  },

  thisAppCard: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  infoNote: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  infoNoteText: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  thisAppTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  thisAppStatsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  thisAppPill: { flex: 1, borderRadius: 12, padding: 10 },
  thisAppPillLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  thisAppPillValue: { fontSize: 16, fontWeight: "800", marginTop: 2 },

  permissionCard: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  permissionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  permissionTitle: { fontSize: 14, fontWeight: "800" },
  permissionBody: {
    fontSize: 12,
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 18,
  },
  permissionNote: {
    fontSize: 11,
    marginTop: -4,
    marginBottom: 12,
    lineHeight: 16,
  },
  permissionBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#0f766e",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  permissionBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  rangeWrap: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  rangeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rangeChipText: { fontSize: 11, fontWeight: "700" },

  summaryRow: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderRadius: 14,
    marginBottom: 10,
  },
  summaryItem: { flex: 1, alignItems: "center", paddingVertical: 10 },
  summaryLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  summaryDivider: { width: 1 },

  loadingWrap: { paddingVertical: 30, alignItems: "center" },

  appCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  appTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rankBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { fontSize: 12, fontWeight: "800" },
  appName: { fontSize: 14, fontWeight: "700" },
  appPackage: { fontSize: 11, marginTop: 2 },
  appDuration: { fontSize: 13, fontWeight: "800" },
  currentBadge: {
    marginTop: 4,
    color: "#0284c7",
    fontSize: 10,
    fontWeight: "700",
  },
  track: {
    marginTop: 10,
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 4 },
  lastUsed: { marginTop: 8, fontSize: 11 },

  emptyCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 22,
    alignItems: "center",
    marginTop: 4,
  },
  emptyTitle: { marginTop: 8, fontSize: 14, fontWeight: "800" },
  emptySub: { marginTop: 6, fontSize: 12, textAlign: "center", lineHeight: 18 },
  inlineError: { marginTop: 8, fontSize: 12, fontWeight: "600" },
});
