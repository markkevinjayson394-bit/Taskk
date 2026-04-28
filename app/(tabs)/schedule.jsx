/**
 * schedule.js - weekly timetable grid orchestration
 * Modularized: logic → helpers.js, UI → components.js
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EmptyStateCard from "../../components/EmptyStateCard";
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import {
  CACHE_KEYS,
  loadFromCache,
  saveToCache,
  useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { buildSubjectIdFromName } from "../../utils/academicTaskModel";
import { findBestScheduleDoc } from "../../utils/scheduleMatcher";

// Local imports
import {
  ColorPickerModal,
  ScheduleHero,
  StatusCard,
  TableHeaderRow,
  TableRow,
  TodayListCard,
  WeekStrip,
} from "../../features/tab-modules/schedule.components";
import {
  buildTimetableMatrix,
  DAY_COLORS,
  DAY_COLUMN_WIDTH,
  DAYS,
  getCurrentWeekDates,
  getSlotRangeFromKey,
  getSubjectColor,
  getTodayName,
  getTodayStatus,
  normalizeSubjectKey,
  sortClassesByStart,
  TABLE_SCROLL_PADDING,
  TIME_COLUMN_WIDTH,
} from "../../features/tab-modules/schedule.helpers";

const scheduleMetaKey = (uid) => `${CACHE_KEYS.schedule(uid)}_meta`;
const SUBJECT_COLOR_KEY = (uid) => `schedule_subject_colors_${uid}`;

export default function ViewSchedule() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isOnline, markSynced } = useOffline();
  const insets = useSafeAreaInsets();

  // State
  const [weekSchedule, setWeekSchedule] = useState({});
  const [semesterLabel, setSemesterLabel] = useState("");
  const [academicYearLabel, setAcademicYearLabel] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [needsAcademicInfo, setNeedsAcademicInfo] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [subjectColors, setSubjectColors] = useState({});
  const [colorPicker, setColorPicker] = useState({
    visible: false,
    subject: "",
  });

  // Refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasLoaded = useRef(false);
  const timetableScrollRef = useRef(null);
  const hasAutoSnappedToday = useRef(false);

  const textPrimary = colors.text;
  const textMuted = colors.muted;
  const colorsSurface = colors.surface || colors.background;
  const colorsPrimary = colors.primary;

  // Callbacks
  const openSubjectTasks = useCallback(
    (subjectName) => {
      const subject = String(subjectName || "").trim();
      if (!subject) {
        router.push("/(tabs)/TaskManagerScreen");
        return;
      }
      router.push({
        pathname: "/(tabs)/TaskManagerScreen",
        params: {
          subject,
          subjectId: buildSubjectIdFromName(subject),
        },
      });
    },
    [router]
  );

  const saveSubjectColors = async (next) => {
    setSubjectColors(next);
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await AsyncStorage.setItem(
          SUBJECT_COLOR_KEY(uid),
          JSON.stringify(next)
        );
      }
    } catch (err) {
      console.warn("Failed to persist subject colors:", err);
    }
  };

  const openColorPickerLocal = (subject) => {
    const key = normalizeSubjectKey(subject);
    if (!key) return;
    setColorPicker({ visible: true, subject });
  };

  const applySubjectColor = async (subject, color) => {
    const key = normalizeSubjectKey(subject);
    if (!key) return;
    const next = { ...subjectColors, [key]: color };
    await saveSubjectColors(next);
    setColorPicker({ visible: false, subject: "" });
  };

  const resetSubjectColor = async (subject) => {
    const key = normalizeSubjectKey(subject);
    if (!key) return;
    const next = { ...subjectColors };
    delete next[key];
    await saveSubjectColors(next);
    setColorPicker({ visible: false, subject: "" });
  };

  const resolveSubjectColor = useCallback(
    (subject, fallback) => {
      const key = normalizeSubjectKey(subject);
      if (key && subjectColors[key]) return subjectColors[key];
      return getSubjectColor(subject, fallback);
    },
    [subjectColors]
  );

  // Effects
  useFocusEffect(
    useCallback(() => {
      hasAutoSnappedToday.current = false;
    }, [])
  );

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    AsyncStorage.getItem(SUBJECT_COLOR_KEY(uid))
      .then((raw) => {
        if (!active || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") setSubjectColors(parsed);
        } catch (err) {
          console.warn("Failed to parse saved subject colors:", err);
        }
      })
      .catch(console.warn);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60000);
    return () => clearInterval(id);
  }, []);

  const todayName = getTodayName();

  useEffect(() => {
    hasAutoSnappedToday.current = false;
  }, [todayName]);

  // Core data/memo
  const todayNameLocal = getTodayName();
  const heroColorLocal = DAY_COLORS[todayNameLocal] || colors.primary;

  const weekDates = useMemo(() => getCurrentWeekDates(new Date()), []);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];
  const semesterTextLocal = semesterLabel
    ? academicYearLabel
      ? `Semester: ${semesterLabel} • SY ${academicYearLabel}`
      : `Semester: ${semesterLabel}`
    : academicYearLabel
      ? `School Year: ${academicYearLabel}`
      : "Semester: Not set";

  const weekItems = useMemo(
    () =>
      DAYS.map((day, index) => ({
        day,
        date: weekDates[index],
        classes: sortClassesByStart(weekSchedule[day] || []),
        color: DAY_COLORS[day] || colors.primary,
        isToday: day === todayNameLocal,
      })),
    [weekDates, weekSchedule, colors.primary, todayNameLocal]
  );

  const totalClasses = weekItems.reduce(
    (sum, item) => sum + item.classes.length,
    0
  );
  const daysWithClasses = weekItems.filter(
    (item) => item.classes.length > 0
  ).length;
  const todayColumnIndexLocal = useMemo(
    () => weekItems.findIndex((item) => item.isToday),
    [weekItems]
  );

  const timetable = useMemo(() => buildTimetableMatrix(weekItems), [weekItems]);
  const numTimeSlots = timetable?.slots?.length || 0;

  useEffect(() => {
    if (!weekItems.length) return;
    const todayColumnIndexLocal = weekItems.findIndex((item) => item.isToday);
    if (
      todayColumnIndexLocal < 0 ||
      hasAutoSnappedToday.current ||
      !timetableScrollRef.current
    )
      return;

    const offsetX = Math.max(
      0,
      TIME_COLUMN_WIDTH + todayColumnIndexLocal * DAY_COLUMN_WIDTH - 24
    );
    const timer = setTimeout(() => {
      timetableScrollRef.current?.scrollTo({ x: offsetX, animated: true });
      hasAutoSnappedToday.current = true;
    }, 180);
    return () => clearTimeout(timer);
  }, [weekItems, numTimeSlots]);

  const todayStatusLocal = useMemo(
    () => getTodayStatus(weekItems, nowMinutes),
    [weekItems, nowMinutes]
  );

  const todayClassesList = useMemo(() => {
    const todayItem = weekItems.find((item) => item.isToday);
    return todayItem ? todayItem.classes : [];
  }, [weekItems]);
  const todayLabelLocal = useMemo(() => {
    const todayItem = weekItems.find((item) => item.isToday);
    return todayItem
      ? todayItem.date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "";
  }, [weekItems]);

  const scrollToDayIndexLocal = useCallback((index) => {
    if (!timetableScrollRef.current || index < 0) return;
    const offsetX = Math.max(
      0,
      TIME_COLUMN_WIDTH + index * DAY_COLUMN_WIDTH - TABLE_SCROLL_PADDING
    );
    timetableScrollRef.current.scrollTo({ x: offsetX, animated: true });
    hasAutoSnappedToday.current = true;
  }, []);

  // Load schedule
  const loadScheduleLocal = useCallback(async (_silent = false) => {
    const user = auth.currentUser;
    if (!user) return;

    if (!isOnline) {
      const cached = await loadFromCache(
        CACHE_KEYS.schedule(user.uid) + "_week"
      );
      const metaCache = await loadFromCache(scheduleMetaKey(user.uid));
      if (cached?.data) {
        setWeekSchedule(cached.data);
        setFromCache(true);
        setNeedsAcademicInfo(false);
      }
      if (metaCache?.data?.semester)
        setSemesterLabel(String(metaCache.data.semester || "").trim());
      if (metaCache?.data?.academicYear)
        setAcademicYearLabel(String(metaCache.data.academicYear || "").trim());
      setRefreshing(false);
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
      return;
    }

    setRefreshing(true);
    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) {
        setWeekSchedule({});
        setFromCache(false);
        setSemesterLabel("");
        setAcademicYearLabel("");
        setNeedsAcademicInfo(true);
        return;
      }

      const userData = userSnap.data();
      const studentInfo = userData.studentInfo || {};
      const { college, course, year, section, scheduleType } = studentInfo;

      if (!course || !year || !section) {
        setWeekSchedule({});
        setFromCache(false);
        setSemesterLabel("");
        setAcademicYearLabel("");
        setNeedsAcademicInfo(true);
        return;
      }

      const scheduleMatch = await findBestScheduleDoc(db, {
        college,
        course,
        year,
        section,
        scheduleType,
      });

      if (scheduleMatch?.doc) {
        const raw = scheduleMatch.doc.data() || {};
        const ws = raw.weekSchedule || {};
        const semester = String(raw.semester || "").trim();
        const academicYear = String(raw.academicYear || "").trim();
        setWeekSchedule(ws);
        await saveToCache(CACHE_KEYS.schedule(user.uid) + "_week", ws);
        await saveToCache(scheduleMetaKey(user.uid), {
          semester,
          academicYear,
        });
        setSemesterLabel(semester);
        setAcademicYearLabel(academicYear);
        await markSynced(user.uid);
        setFromCache(false);
        setNeedsAcademicInfo(false);
      } else {
        setSemesterLabel("");
        setAcademicYearLabel("");
        setNeedsAcademicInfo(false);
      }
    } catch (err) {
      console.warn("Load schedule error:", err);
      // Fallback to cache (already handled above)
    } finally {
      setRefreshing(false);
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  }, [isOnline, fadeAnim, markSynced]);

  useEffect(() => {
    if (!hasLoaded.current && auth.currentUser) {
      loadScheduleLocal();
      hasLoaded.current = true;
    }
  }, [loadScheduleLocal]);

  useEffect(() => {
    if (isOnline && hasLoaded.current) {
      loadScheduleLocal(true);
    }
  }, [isOnline, loadScheduleLocal]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={heroColorLocal} />
      <OfflineBanner />
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              if (isOnline) {
                setRefreshing(true);
                await loadScheduleLocal();
              }
            }}
            colors={[heroColorLocal]}
            tintColor={heroColorLocal}
            enabled={isOnline}
          />
        }
      >
        <ScheduleHero
          heroColor={heroColorLocal}
          semesterText={semesterTextLocal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          totalClasses={totalClasses}
          daysWithClasses={daysWithClasses}
          fromCache={fromCache}
          insets={insets}
        />

        <View style={styles.content}>
          <WeekStrip
            weekItems={weekItems}
            todayColumnIndex={todayColumnIndexLocal}
            scrollToDayIndex={scrollToDayIndexLocal}
            colors={colors}
            textPrimary={textPrimary}
            textMuted={textMuted}
          />

          <StatusCard
            todayStatus={todayStatusLocal}
            colors={colors}
            textPrimary={textPrimary}
            textMuted={textMuted}
          />

          <TodayListCard
            todayClassesList={todayClassesList}
            todayStatus={todayStatusLocal}
            todayLabel={todayLabelLocal}
            openSubjectTasks={openSubjectTasks}
            colors={colors}
            textPrimary={textPrimary}
            textMuted={textMuted}
            colorsPrimary={colorsPrimary}
          />

          {needsAcademicInfo ? (
            <EmptyStateCard
              title="Academic info required"
              message="Set your course, year, and section in Profile to load your class timetable."
              icon="school-outline"
              tone="warn"
              actionLabel="Open Profile"
              onAction={() => router.push("/(tabs)/profile")}
              style={{ marginHorizontal: 16, marginTop: 12 }}
            />
          ) : totalClasses === 0 ? (
            <EmptyStateCard
              title="No classes this week"
              message="Ask your admin to publish a weekly schedule."
              icon="calendar-clear-outline"
              style={{ marginHorizontal: 16, marginTop: 12 }}
            />
          ) : (
            <ScrollView
              ref={timetableScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              <View
                style={[
                  styles.table,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                <TableHeaderRow
                  weekItems={weekItems}
                  colors={colors}
                  textPrimary={textPrimary}
                  textMuted={textMuted}
                />
                {timetable.slots.map((slot, rowIndex) => {
                  const range = getSlotRangeFromKey(slot.key);
                  const isNowSlot =
                    range &&
                    nowMinutes >= range.start &&
                    nowMinutes < range.end;
                  const zebraTint = rowIndex % 2 === 0 ? colorsSurface : null;
                  const isLunchSlot = slot.isLunch === true;
                  return (
                    <TableRow
                      key={slot.key}
                      slot={slot}
                      rowIndex={rowIndex}
                      nowMinutes={nowMinutes}
                      heroColor={heroColorLocal}
                      weekItems={weekItems}
                      timetable={timetable}
                      colors={colors}
                      textPrimary={textPrimary}
                      textMuted={textMuted}
                      colorsSurface={colorsSurface}
                      isLunch={isLunchSlot}
                      zebraTint={zebraTint}
                      isNowSlot={isNowSlot}
                      openColorPicker={openColorPickerLocal}
                      openSubjectTasks={openSubjectTasks}
                      resolveSubjectColor={resolveSubjectColor}
                    />
                  );
                })}
              </View>
            </ScrollView>
          )}

          <View style={{ height: 28 }} />
        </View>
      </Animated.ScrollView>

      <ColorPickerModal
        colorPicker={colorPicker}
        setColorPicker={setColorPicker}
        colors={colors}
        textPrimary={textPrimary}
        textMuted={textMuted}
        applySubjectColor={applySubjectColor}
        resetSubjectColor={resetSubjectColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingBottom: 32 },
  content: { paddingTop: 14, paddingHorizontal: 14 },
});



