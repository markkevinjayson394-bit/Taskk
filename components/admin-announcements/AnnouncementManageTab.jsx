import { Ionicons } from "@expo/vector-icons";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  buildAudienceLabel,
  formatAnnouncementDateTime,
  getSelectedAudience,
  MANAGE_AUDIENCE_OPTIONS,
} from "../../utils/adminAnnouncements";

export default function AnnouncementManageTab({
  colors,
  announcements,
  filteredAnnouncements,
  visibleCount,
  manageSearch,
  manageAudience,
  refreshing,
  onRefresh,
  onManageSearchChange,
  onManageAudienceChange,
  onClearSearch,
  onEdit,
  onDelete,
  onLoadMore,
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={["#f59e0b"]}
          tintColor="#f59e0b"
        />
      }
    >
      <View
        style={[
          styles.manageTools,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={16} color={colors.muted} />
          <TextInput
            placeholder="Search title, message, course, year..."
            placeholderTextColor={colors.muted}
            value={manageSearch}
            onChangeText={onManageSearchChange}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {!!(manageSearch || "").trim() ? (
            <TouchableOpacity onPress={onClearSearch} style={styles.searchClearBtn}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.filterChipsRow}>
          {MANAGE_AUDIENCE_OPTIONS.map((option) => {
            const isActive = manageAudience === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isActive ? `${option.color}22` : "transparent",
                    borderColor: isActive ? option.color : colors.border,
                  },
                ]}
                onPress={() => onManageAudienceChange(option.value)}
              >
                <Ionicons
                  name={option.icon}
                  size={13}
                  color={isActive ? option.color : colors.muted}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    { color: isActive ? option.color : colors.muted },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.filterResultText, { color: colors.muted }]}> 
          {filteredAnnouncements.length} result
          {filteredAnnouncements.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {announcements.length === 0 ? (
        <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
          <Ionicons
            name="megaphone-outline"
            size={32}
            color={colors.muted}
            style={{ marginBottom: 8 }}
          />
          <Text style={[styles.emptyText, { color: colors.muted }]}>No announcements yet</Text>
        </View>
      ) : filteredAnnouncements.length === 0 ? (
        <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
          <Ionicons
            name="search-outline"
            size={30}
            color={colors.muted}
            style={{ marginBottom: 8 }}
          />
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            No announcements match your filters
          </Text>
        </View>
      ) : (
        filteredAnnouncements.slice(0, visibleCount).map((item) => {
          const audience = getSelectedAudience(item.audience);
          return (
            <View
              key={item.id}
              style={[
                styles.annCard,
                { backgroundColor: colors.card, borderLeftColor: audience.color },
              ]}
            >
              <View style={styles.annCardHeader}>
                <View style={[styles.annBadge, { backgroundColor: `${audience.color}18` }]}>
                  <Ionicons name={audience.icon} size={11} color={audience.color} />
                  <Text style={[styles.annBadgeText, { color: audience.color }]}>
                    {buildAudienceLabel(item)}
                  </Text>
                </View>
                <View style={styles.annActions}>
                  <TouchableOpacity
                    onPress={() => onEdit(item)}
                    style={[styles.editBtn, { backgroundColor: `${colors.primary}15` }]}
                    accessibilityLabel={`Edit announcement: ${item.title}`}
                    accessibilityHint="Opens this announcement in edit mode"
                  >
                    <Ionicons name="create-outline" size={15} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDelete(item.id, item.title)}
                    style={[styles.deleteBtn, { backgroundColor: `${colors.danger}15` }]}
                    accessibilityLabel={`Delete announcement: ${item.title}`}
                    accessibilityHint="Deletes this announcement permanently"
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={[styles.annTitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.annMessage, { color: colors.muted }]} numberOfLines={2}>
                {item.message}
              </Text>
              {item.imageBase64 ? (
                <View style={styles.annMediaBox}>
                  <Image source={{ uri: item.imageBase64 }} style={styles.annImage} resizeMode="cover" />
                  {!!item.imageNote ? (
                    <Text style={[styles.annImageNote, { color: colors.muted }]}>
                      {item.imageNote}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Text style={[styles.annDate, { color: colors.muted }]}>
                {formatAnnouncementDateTime(item.createdAt)}
              </Text>
            </View>
          );
        })
      )}

      {filteredAnnouncements.length > visibleCount ? (
        <TouchableOpacity
          style={[
            styles.loadMoreBtn,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
          onPress={onLoadMore}
        >
          <Text style={[styles.loadMoreText, { color: "#f59e0b" }]}>
            Load more ({filteredAnnouncements.length - visibleCount} remaining)
          </Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  listContainer: { padding: 16 },
  manageTools: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    marginBottom: 12,
    gap: 10,
  },
  searchBox: {
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 9,
  },
  searchClearBtn: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipText: { fontSize: 11, fontWeight: "700" },
  filterResultText: { fontSize: 11, fontWeight: "600" },
  emptyBox: {
    alignItems: "center",
    padding: 48,
    borderRadius: 20,
    marginTop: 10,
  },
  emptyText: { fontSize: 15 },
  annCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  annCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  annBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    flexShrink: 1,
  },
  annBadgeText: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  annActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  editBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  annTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  annMessage: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  annMediaBox: { marginBottom: 8 },
  annImage: { width: "100%", height: 160, borderRadius: 12 },
  annImageNote: { fontSize: 11, marginTop: 6 },
  annDate: { fontSize: 11, marginTop: 2 },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 13, fontWeight: "700" },
});

