import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function AnnouncementHeader({
  topInset,
  tab,
  announcementsCount,
  onChangeTab,
}) {
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: "#f59e0b", paddingTop: topInset + 16 },
      ]}
    >
      <View style={styles.headerCircle} />
      <View style={styles.headerCircle2} />
      <Text style={styles.headerSub}>Broadcast to students</Text>
      <Text style={styles.headerTitle}>Announcements</Text>

      <View style={[styles.tabBar, { backgroundColor: "rgba(0,0,0,0.15)" }]}>
        {[
          { key: "post", label: "Post New", icon: "add-circle-outline" },
          {
            key: "list",
            label: `Manage (${announcementsCount})`,
            icon: "list",
          },
        ].map((item) => (
          <TouchableOpacity
            key={item.key}
            onPress={() => onChangeTab(item.key)}
            style={[styles.tabBtn, tab === item.key && styles.tabBtnActive]}
          >
            <Ionicons
              name={item.icon}
              size={14}
              color={tab === item.key ? "#f59e0b" : "rgba(255,255,255,0.7)"}
            />
            <Text
              style={[
                styles.tabBtnText,
                {
                  color:
                    tab === item.key ? "#f59e0b" : "rgba(255,255,255,0.7)",
                },
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 18,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerCircle: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -30,
    right: -20,
  },
  headerCircle2: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
  },
  tabBar: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabBtnActive: { backgroundColor: "#fff" },
  tabBtnText: { fontSize: 13, fontWeight: "600" },
});
