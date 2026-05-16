import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScheduleBrowseCard from "../../components/admin-schedule/ScheduleBrowseCard";
import ScheduleBrowseHeader from "../../components/admin-schedule/ScheduleBrowseHeader";
import ScheduleFiltersBar from "../../components/admin-schedule/ScheduleFiltersBar";
import { auth, db } from "../../config/firebase";
import { COLLEGES } from "../../constants/academics";
import { CACHE_KEYS, useOffline } from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import {
  readCacheContract,
  saveCacheContract,
} from "../../utils/cacheContracts";
import {
  buildCourseOptions,
  buildYearOptions,
  countClasses,
  COURSE_COLORS,
  deleteScheduleRecord,
  filterSchedules,
  mapScheduleRecord,
  sortSchedules,
} from "../../utils/adminScheduleBrowse";

export default function ViewSchedules() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isOnline } = useOffline();
  const [schedules, setSchedules] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const [filterCollege, setFilterCollege] = useState("All");
  const [filterCourse, setFilterCourse] = useState("All");
  const [filterYear, setFilterYear] = useState("All");
  const [search, setSearch] = useState("");

  const collegeOptions = useMemo(
    () => COLLEGES.map((college) => ({ value: college.value, label: college.label })),
    []
  );

  const courseOptions = useMemo(
    () => buildCourseOptions(schedules, filterCollege),
    [schedules, filterCollege]
  );

  const yearOptions = useMemo(() => buildYearOptions(schedules), [schedules]);

  const filtered = useMemo(
    () =>
      filterSchedules(schedules, {
        filterCollege,
        filterCourse,
        filterYear,
        search,
      }),
    [schedules, filterCollege, filterCourse, filterYear, search]
  );

  useEffect(() => {
    void fetchSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  useEffect(() => {
    if (
      filterCollege !== "All" &&
      !collegeOptions.some((college) => college.value === filterCollege)
    ) {
      setFilterCollege("All");
    }
  }, [collegeOptions, filterCollege]);

  useEffect(() => {
    if (filterCourse !== "All" && !courseOptions.includes(filterCourse)) {
      setFilterCourse("All");
    }
  }, [courseOptions, filterCourse]);

  useEffect(() => {
    if (filterYear !== "All" && !yearOptions.includes(filterYear)) {
      setFilterYear("All");
    }
  }, [yearOptions, filterYear]);

  const fetchSchedules = async () => {
    const uid = auth.currentUser?.uid;
    if (!isOnline) {
      const cached = uid
        ? await readCacheContract(CACHE_KEYS.adminSchedules(uid), {
            defaultData: [],
          })
        : null;
      if (cached?.hasCache) {
        setSchedules(sortSchedules(Array.isArray(cached.data) ? cached.data : []));
        setFromCache(true);
        setOfflineUnavailable(false);
      } else {
        setSchedules([]);
        setFromCache(false);
        setOfflineUnavailable(true);
      }
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const snap = await getDocs(collection(db, "schedules"));
      const data = sortSchedules(snap.docs.map(mapScheduleRecord));
      setSchedules(data);
      setFromCache(false);
      setOfflineUnavailable(false);
      if (uid) {
        await saveCacheContract(CACHE_KEYS.adminSchedules(uid), data);
      }
    } catch (err) {
      console.warn("Failed to fetch schedules:", err);
      if (uid) {
        const cached = await readCacheContract(CACHE_KEYS.adminSchedules(uid), {
          defaultData: [],
        });
        if (cached?.hasCache) {
          setSchedules(sortSchedules(Array.isArray(cached.data) ? cached.data : []));
          setFromCache(true);
          setOfflineUnavailable(false);
        } else {
          setOfflineUnavailable(true);
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = (id, label) => {
    if (!isOnline) {
      Alert.alert("Offline", "Admin schedule changes require an internet connection.");
      return;
    }

    Alert.alert("Delete Schedule", `Delete schedule for "${label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteScheduleRecord({
              id,
              dbRef: db,
              deleteDocFn: deleteDoc,
              docFn: doc,
              reload: () => void fetchSchedules(),
            });
          } catch (err) {
            console.warn("Failed to delete schedule:", err);
            Alert.alert(
              "Delete Failed",
              "Could not delete this schedule. Please try again."
            );
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0ea5e9" />

      <ScheduleBrowseHeader
        topInset={insets.top}
        search={search}
        onSearchChange={setSearch}
        schedulesCount={schedules.length}
        filteredCount={filtered.length}
        onCreate={() => router.push("/(admin)/createSchedule")}
      />

      <ScheduleFiltersBar
        colors={colors}
        filterCollege={filterCollege}
        filterCourse={filterCourse}
        filterYear={filterYear}
        collegeOptions={collegeOptions}
        courseOptions={courseOptions}
        yearOptions={yearOptions}
        onCollegeChange={setFilterCollege}
        onCourseChange={setFilterCourse}
        onYearChange={setFilterYear}
      />

      {(fromCache || offlineUnavailable) && (
        <View style={[styles.offlineNotice, { backgroundColor: colors.card }]}>
          <Ionicons
            name={fromCache ? "cloud-done-outline" : "cloud-offline-outline"}
            size={16}
            color={colors.muted}
          />
          <Text style={[styles.offlineNoticeText, { color: colors.muted }]}>
            {fromCache
              ? "Showing cached schedules. Admin changes are disabled offline."
              : "Schedules are unavailable offline until loaded once online."}
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchSchedules();
            }}
            colors={["#0ea5e9"]}
            tintColor="#0ea5e9"
          />
        }
      >
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card }]}>
            <Ionicons
              name="calendar-clear-outline"
              size={34}
              color={colors.muted}
              style={{ marginBottom: 8 }}
            />
            <Text style={[styles.emptyText, { color: colors.muted }]}>No schedules found</Text>
          </View>
        ) : (
          filtered.map((item) => {
            const courseColor = COURSE_COLORS[item.course] || colors.primary;
            const classCount = countClasses(item.weekSchedule);
            const label = `${item.course} - Y${item.year} - Sec ${item.section}`;
            return (
              <ScheduleBrowseCard
                key={item.id}
                colors={colors}
                isDark={isDark}
                item={item}
                courseColor={courseColor}
                classCount={classCount}
                onEdit={() => {
                  console.log("Editing item:", JSON.stringify(item, null, 2));
                  router.push({
                    pathname: "/(admin)/createSchedule",
                    params: { scheduleData: JSON.stringify(item) },
                  });
                }}
                onDelete={() => handleDelete(item.id, label)}
              />
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContainer: { padding: 14 },
  offlineNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 14,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  offlineNoticeText: { flex: 1, fontSize: 12, fontWeight: "600" },
  emptyBox: { alignItems: "center", padding: 40, borderRadius: 20 },
  emptyText: { fontSize: 15, marginTop: 4 },
});
