/**
 * schedule.js - weekly timetable grid (time x day)
 */
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Animated,
    Modal,
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
import OfflineBanner from "../../components/OfflineBanner";
import { auth, db } from "../../config/firebase";
import {
    CACHE_KEYS,
    loadFromCache,
    saveToCache,
    useOffline,
} from "../../context/OfflineContext";
import { useTheme } from "../../context/ThemeContext";
import { findBestScheduleDoc } from "../../utils/scheduleMatcher";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DAY_COLORS = {
  Monday: "#6366f1",
  Tuesday: "#0ea5e9",
  Wednesday: "#10b981",
  Thursday: "#f59e0b",
  Friday: "#ef4444",
  Saturday: "#8b5cf6",
};
const SUBJECT_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];
const SUBJECT_COLOR_KEY = "subject_color_map_v1";
const LUNCH_SLOT = {
  key: "slot:720-780",
  label: "12:00 PM - 1:00 PM",
  sortOrder: 720,
  isLunch: true,
};
const TIME_COLUMN_WIDTH = 130;
const DAY_COLUMN_WIDTH = 133;
const TABLE_SCROLL_PADDING = 24;
const scheduleMetaKey = (uid) => `${CACHE_KEYS.schedule(uid)}_meta`;

function getTodayName() {
  return new Date().toLocaleString("en-US", { weekday: "long" });
}

function getCurrentWeekDates(reference = new Date()) {
  const today = new Date(reference);
  const dayIndex = today.getDay();
  const diffToMonday = dayIndex === 0 ? -6 : 1 - dayIndex;

  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() + diffToMonday);

  return DAYS.map((_, idx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + idx);
    return date;
  });
}

function parseTimeToMinutes(value) {
  if (!value) return null;

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.getHours() * 60 + asDate.getMinutes();
  }

  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = (match[3] || "").toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function toTimeLabel(minutes) {
  const safe = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  const hour24 = Math.floor(safe / 60);
  const minute = safe % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function normalizeSubjectKey(subject) {
  return String(subject || "")
    .trim()
    .toLowerCase();
}

function toRgba(hex, alpha) {
  if (!hex || !hex.startsWith("#") || hex.length < 7)
    return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getSubjectColor(subject, fallback) {
  const text = String(subject || "").trim();
  if (!text) return fallback;
  const idx = hashString(text) % SUBJECT_COLORS.length;
  return SUBJECT_COLORS[idx] || fallback;
}

function getClassSlotMeta(cls, fallbackOrder) {
  let start = parseTimeToMinutes(cls?.start);
  let end = parseTimeToMinutes(cls?.end);

  const display = String(cls?.timeDisplay || "").trim();
  if (display.includes("-")) {
    const [left, right] = display.split("-").map((part) => part.trim());
    if (start === null) start = parseTimeToMinutes(left);
    if (end === null) end = parseTimeToMinutes(right);
  }

  if (start !== null) {
    if (end === null || end <= start) end = start + 60;
    return {
      key: `slot:${start}-${end}`,
      label: `${toTimeLabel(start)} - ${toTimeLabel(end)}`,
      sortOrder: start,
    };
  }

  if (display) {
    return {
      key: `label:${display.toLowerCase()}`,
      label: display,
      sortOrder: 10000 + fallbackOrder,
    };
  }

  return {
    key: `unknown:${fallbackOrder}`,
    label: "Time TBD",
    sortOrder: 20000 + fallbackOrder,
  };
}

function getClassRangeMinutes(cls) {
  let start = parseTimeToMinutes(cls?.start);
  let end = parseTimeToMinutes(cls?.end);

  const display = String(cls?.timeDisplay || "").trim();
  if (display.includes("-")) {
    const [left, right] = display.split("-").map((part) => part.trim());
    if (start === null) start = parseTimeToMinutes(left);
    if (end === null) end = parseTimeToMinutes(right);
  }

  if (start === null) return null;
  if (end === null || end <= start) end = start + 60;
  return { start, end };
}

function formatClassTime(cls) {
  const display = String(cls?.timeDisplay || "").trim();
  if (display) return display;
  const range = getClassRangeMinutes(cls);
  if (!range) return "Time TBD";
  return `${toTimeLabel(range.start)} - ${toTimeLabel(range.end)}`;
}

function sortClassesByStart(classes) {
  return [...classes].sort((a, b) => {
    const aSlot = getClassSlotMeta(a, 0);
    const bSlot = getClassSlotMeta(b, 0);
    return aSlot.sortOrder - bSlot.sortOrder;
  });
}

function weekRangeLabel(start, end) {
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} - ${endLabel}`;
}

function weekMonthLabel(start, end) {
  const sameMonth =
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();
  if (sameMonth)
    return start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

  const sameYear = start.getFullYear() === end.getFullYear();
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  if (sameYear) return `${startMonth} - ${endMonth} ${start.getFullYear()}`;

  return `${startMonth} ${start.getFullYear()} - ${endMonth} ${end.getFullYear()}`;
}

function getSlotRangeFromKey(slotKey) {
  if (!slotKey || !slotKey.startsWith("slot:")) return null;
  const parts = slotKey
    .slice(5)
    .split("-")
    .map((v) => Number(v));
  if (parts.length !== 2 || parts.some((v) => Number.isNaN(v))) return null;
  const [start, end] = parts;
  if (end <= start) return null;
  return { start, end };
}

export default function ViewSchedule() {
  const { colors } = useTheme();
  const { isOnline, markSynced } = useOffline();
  const insets = useSafeAreaInsets();

  const [weekSchedule, setWeekSchedule] = useState({});
  const [semesterLabel, setSemesterLabel] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [subjectColors, setSubjectColors] = useState({});
  const [colorPicker, setColorPicker] = useState({
    visible: false,
    subject: "",
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasLoaded = useRef(false);
  const timetableScrollRef = useRef(null);
  const hasAutoSnappedToday = useRef(false);

  useFocusEffect(
    useCallback(() => {
      hasAutoSnappedToday.current = false;
      if (!hasLoaded.current) {
        loadSchedule();
        hasLoaded.current = true;
      } else if (isOnline) {
        loadSchedule(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline])
  );

  const loadSchedule = async (_silent = false) => {
    const user = auth.currentUser;
    if (!user) {
      return;
    }

    if (!isOnline) {
      const cached = await loadFromCache(
        CACHE_KEYS.schedule(user.uid) + "_week"
      );
      const metaCache = await loadFromCache(scheduleMetaKey(user.uid));
      if (cached?.data) {
        setWeekSchedule(cached.data);
        setFromCache(true);
      }
      if (metaCache?.data?.semester) {
        setSemesterLabel(String(metaCache.data.semester || "").trim());
      } else {
        setSemesterLabel("");
      }
      setRefreshing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) {
        // User document doesn't exist - may need profile setup
        setWeekSchedule({});
        setFromCache(false);
        setSemesterLabel("");
        return;
      }

      const userData = userSnap.data();
      const studentInfo = userData.studentInfo || {};
      const { college, course, year, section, scheduleType } = studentInfo;

      // Check if student profile is complete
      if (!course || !year || !section) {
        setWeekSchedule({});
        setFromCache(false);
        setSemesterLabel("");
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
        setWeekSchedule(ws);
        await saveToCache(CACHE_KEYS.schedule(user.uid) + "_week", ws);
        await saveToCache(scheduleMetaKey(user.uid), { semester });
        setSemesterLabel(semester);
        await markSynced();
        setFromCache(false);
      } else {
        setSemesterLabel("");
      }
    } catch (_err) {
      const cached = await loadFromCache(
        CACHE_KEYS.schedule(user.uid) + "_week"
      );
      const metaCache = await loadFromCache(scheduleMetaKey(user.uid));
      if (cached?.data) {
        setWeekSchedule(cached.data);
        setFromCache(true);
      }
      if (metaCache?.data?.semester) {
        setSemesterLabel(String(metaCache.data.semester || "").trim());
      } else {
        setSemesterLabel("");
      }
    } finally {
      setRefreshing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  const todayName = getTodayName();
  const heroColor = DAY_COLORS[todayName] || colors.primary;

  const weekDates = useMemo(() => getCurrentWeekDates(new Date()), []);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];

  const weekItems = useMemo(
    () =>
      DAYS.map((day, index) => ({
        day,
        date: weekDates[index],
        classes: sortClassesByStart(weekSchedule[day] || []),
        color: DAY_COLORS[day] || colors.primary,
        isToday: day === todayName,
      })),
    [weekDates, weekSchedule, colors.primary, todayName]
  );

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SUBJECT_COLOR_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") setSubjectColors(parsed);
        } catch (err) {
          console.warn("Failed to parse saved subject colors:", err);
        }
      })
      .catch((err) => {
        console.warn("Failed to load saved subject colors:", err);
      });
    return () => {
      active = false;
    };
  }, []);

  const saveSubjectColors = async (next) => {
    setSubjectColors(next);
    try {
      await AsyncStorage.setItem(SUBJECT_COLOR_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("Failed to persist subject colors:", err);
    }
  };

  const openColorPicker = (subject) => {
    const key = normalizeSubjectKey(subject);
    if (!key) return;
    setColorPicker({ visible: true, subject });
  };

  const applySubjectColor = async (subject, color) => {
    const key = normalizeSubjectKey(subject);
    if (!key) return;
    const next = { ...subjectColors, [key]: color };
    await saveSubjectColors(next);
  };

  const resetSubjectColor = async (subject) => {
    const key = normalizeSubjectKey(subject);
    if (!key) return;
    const next = { ...subjectColors };
    delete next[key];
    await saveSubjectColors(next);
  };

  const resolveSubjectColor = useCallback(
    (subject, fallback) => {
      const key = normalizeSubjectKey(subject);
      if (key && subjectColors[key]) return subjectColors[key];
      return getSubjectColor(subject, fallback);
    },
    [subjectColors]
  );

  const totalClasses = weekItems.reduce(
    (sum, item) => sum + item.classes.length,
    0
  );
  const daysWithClasses = weekItems.filter(
    (item) => item.classes.length > 0
  ).length;
  const todayColumnIndex = useMemo(
    () => weekItems.findIndex((item) => item.isToday),
    [weekItems]
  );

  const timetable = useMemo(() => {
    const slotMap = new Map();
    const matrix = DAYS.reduce((acc, day) => ({ ...acc, [day]: {} }), {});

    weekItems.forEach((item, dayIndex) => {
      item.classes.forEach((cls, classIndex) => {
        const fallbackOrder = dayIndex * 100 + classIndex;
        const slot = getClassSlotMeta(cls, fallbackOrder);
        if (!slotMap.has(slot.key)) slotMap.set(slot.key, slot);
        if (!matrix[item.day][slot.key]) matrix[item.day][slot.key] = [];
        matrix[item.day][slot.key].push(cls);
      });
    });

    if (!slotMap.has(LUNCH_SLOT.key)) slotMap.set(LUNCH_SLOT.key, LUNCH_SLOT);

    const slots = [...slotMap.values()].sort((a, b) => {
      if (a.sortOrder === b.sortOrder) return a.label.localeCompare(b.label);
      return a.sortOrder - b.sortOrder;
    });

    return { slots, matrix };
  }, [weekItems]);

  const todayStatus = useMemo(() => {
    const todayItem = weekItems.find((item) => item.isToday);
    if (!todayItem) return { current: null, next: null, done: true };
    const classes = todayItem.classes
      .map((cls) => {
        const range = getClassRangeMinutes(cls);
        return range ? { cls, range } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.range.start - b.range.start);

    let current = null;
    let next = null;
    for (const item of classes) {
      if (nowMinutes >= item.range.start && nowMinutes < item.range.end) {
        current = item;
      } else if (item.range.start > nowMinutes && !next) {
        next = item;
      }
    }

    return {
      current,
      next,
      done: !current && !next,
    };
  }, [weekItems, nowMinutes]);

  const todayClassesList = useMemo(() => {
    const todayItem = weekItems.find((item) => item.isToday);
    return todayItem ? todayItem.classes : [];
  }, [weekItems]);
  const todayLabel = useMemo(() => {
    const todayItem = weekItems.find((item) => item.isToday);
    return todayItem
      ? todayItem.date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "";
  }, [weekItems]);

  useEffect(() => {
    hasAutoSnappedToday.current = false;
  }, [todayName]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (totalClasses === 0) return;
    if (todayColumnIndex < 0) return;
    if (hasAutoSnappedToday.current) return;
    if (!timetableScrollRef.current) return;

    const offsetX = Math.max(
      0,
      TIME_COLUMN_WIDTH +
        todayColumnIndex * DAY_COLUMN_WIDTH -
        TABLE_SCROLL_PADDING
    );
    const timer = setTimeout(() => {
      timetableScrollRef.current?.scrollTo({ x: offsetX, animated: true });
      hasAutoSnappedToday.current = true;
    }, 180);

    return () => clearTimeout(timer);
  }, [todayColumnIndex, totalClasses, timetable.slots.length]);

  const scrollToDayIndex = (index) => {
    if (!timetableScrollRef.current || index < 0) return;
    const offsetX = Math.max(
      0,
      TIME_COLUMN_WIDTH + index * DAY_COLUMN_WIDTH - TABLE_SCROLL_PADDING
    );
    timetableScrollRef.current?.scrollTo({ x: offsetX, animated: true });
    hasAutoSnappedToday.current = true;
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={heroColor} />
      <OfflineBanner />

      <View
        style={[
          styles.hero,
          { backgroundColor: heroColor, paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.heroCircle} />
        <View style={styles.heroCircle2} />

        <Text style={styles.heroCampus}>CTU Danao</Text>
        <Text style={styles.heroSemester}>
          {semesterLabel ? `Semester: ${semesterLabel}` : "Semester: Not set"}
        </Text>
        <Text style={styles.heroSub}>Week of</Text>
        <Text style={styles.heroTitle}>
          {weekRangeLabel(weekStart, weekEnd)}
        </Text>
        <Text style={styles.heroRange}>
          {weekMonthLabel(weekStart, weekEnd)}
        </Text>

        <View style={styles.heroPills}>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="calendar" size={11} color="#fff" />
            <Text style={styles.heroPillText}>{totalClasses} classes</Text>
          </View>
          <View
            style={[
              styles.heroPill,
              { backgroundColor: "rgba(255,255,255,0.2)" },
            ]}
          >
            <Ionicons name="grid-outline" size={11} color="#fff" />
            <Text style={styles.heroPillText}>
              {daysWithClasses} active days
            </Text>
          </View>
          {fromCache ? (
            <View
              style={[
                styles.heroPill,
                { backgroundColor: "rgba(239,68,68,0.3)" },
              ]}
            >
              <Ionicons name="cloud-offline-outline" size={11} color="#fff" />
              <Text style={styles.heroPillText}>Cached</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (isOnline) {
                setRefreshing(true);
                loadSchedule();
              }
            }}
            colors={[heroColor]}
            tintColor={heroColor}
            enabled={isOnline}
          />
        }
      >
        <View
          style={[
            styles.weekStrip,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.weekStripHeaderRow}>
            <View style={styles.weekStripHeader}>
              <Text style={[styles.weekStripTitle, { color: colors.text }]}>
                Jump to day
              </Text>
              <Text style={[styles.weekStripMeta, { color: colors.muted }]}>
                Tap a day to focus the timetable
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.weekStripTodayBtn, { borderColor: colors.border }]}
              onPress={() => scrollToDayIndex(todayColumnIndex)}
              activeOpacity={0.85}
            >
              <Ionicons
                name="locate-outline"
                size={14}
                color={colors.primary}
              />
              <Text
                style={[styles.weekStripTodayText, { color: colors.primary }]}
              >
                Today
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.weekStripRow}>
            {weekItems.map((item, index) => (
              <TouchableOpacity
                key={item.day}
                style={[
                  styles.weekStripChip,
                  {
                    borderColor: item.isToday ? item.color : colors.border,
                    backgroundColor: item.isToday
                      ? `${item.color}1a`
                      : "transparent",
                  },
                ]}
                onPress={() => scrollToDayIndex(index)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.weekStripDay,
                    { color: item.isToday ? item.color : colors.text },
                  ]}
                >
                  {item.day.slice(0, 3)}
                </Text>
                <Text style={[styles.weekStripDate, { color: colors.muted }]}>
                  {item.date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View
          style={[
            styles.statusCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.statusHeader}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              Today&apos;s Classes
            </Text>
            <Text style={[styles.statusMeta, { color: colors.muted }]}>
              {todayStatus.done ? "No more classes today" : "Live status"}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View style={styles.statusBlock}>
              <Text style={[styles.statusLabel, { color: colors.muted }]}>
                Current
              </Text>
              {todayStatus.current ? (
                <>
                  <Text style={[styles.statusValue, { color: colors.text }]}>
                    {todayStatus.current.cls.subject || "Class"}
                  </Text>
                  <Text style={[styles.statusSub, { color: colors.muted }]}>
                    {todayStatus.current.cls.timeDisplay ||
                      toTimeLabel(todayStatus.current.range.start)}
                  </Text>
                </>
              ) : (
                <Text style={[styles.statusEmpty, { color: colors.muted }]}>
                  No class now
                </Text>
              )}
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusBlock}>
              <Text style={[styles.statusLabel, { color: colors.muted }]}>
                Next
              </Text>
              {todayStatus.next ? (
                <>
                  <Text style={[styles.statusValue, { color: colors.text }]}>
                    {todayStatus.next.cls.subject || "Class"}
                  </Text>
                  <Text style={[styles.statusSub, { color: colors.muted }]}>
                    {todayStatus.next.cls.timeDisplay ||
                      toTimeLabel(todayStatus.next.range.start)}
                  </Text>
                </>
              ) : (
                <Text style={[styles.statusEmpty, { color: colors.muted }]}>
                  No upcoming class
                </Text>
              )}
            </View>
          </View>
        </View>

        <View
          style={[
            styles.todayListCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.todayListHeader}>
            <Text style={[styles.todayListTitle, { color: colors.text }]}>
              Today&apos;s Timeline
            </Text>
            <Text style={[styles.todayListDate, { color: colors.muted }]}>
              {todayLabel || "Today"}
            </Text>
          </View>
          {todayClassesList.length === 0 ? (
            <EmptyStateCard
              title="No classes today"
              message="Use this time for assignments or review."
              icon="sunny-outline"
              compact
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }}
            />
          ) : (
            todayClassesList.map((cls, index) => {
              const range = getClassRangeMinutes(cls);
              const currentStart = todayStatus.current?.range?.start;
              const nextStart = todayStatus.next?.range?.start;
              const isCurrent =
                range &&
                currentStart !== undefined &&
                range.start === currentStart;
              const isNext =
                !isCurrent &&
                range &&
                nextStart !== undefined &&
                range.start === nextStart;
              const badgeLabel = isCurrent ? "Now" : isNext ? "Next" : null;
              return (
                <View
                  key={`today-${index}-${cls.subject || "class"}`}
                  style={[
                    styles.todayListItem,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.todayListTimeBox,
                      { backgroundColor: `${colors.primary}18` },
                    ]}
                  >
                    <Text
                      style={[styles.todayListTime, { color: colors.primary }]}
                    >
                      {formatClassTime(cls)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.todayListSubject, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {cls.subject || "Class"}
                    </Text>
                    <Text
                      style={[styles.todayListMeta, { color: colors.muted }]}
                      numberOfLines={1}
                    >
                      {cls.teacher
                        ? `Teacher: ${cls.teacher}`
                        : "Room or teacher not set"}
                    </Text>
                  </View>
                  {badgeLabel ? (
                    <View
                      style={[
                        styles.todayListBadge,
                        {
                          backgroundColor: isCurrent
                            ? "#22c55e"
                            : colors.primary,
                        },
                      ]}
                    >
                      <Text style={styles.todayListBadgeText}>
                        {badgeLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {totalClasses === 0 ? (
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
              <View
                style={[styles.headerRow, { borderBottomColor: colors.border }]}
              >
                <View
                  style={[
                    styles.timeHeadCell,
                    {
                      borderRightColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                >
                  <Text style={[styles.timeHeadText, { color: colors.muted }]}>
                    Time
                  </Text>
                </View>
                {weekItems.map((item) => (
                  <View
                    key={item.day}
                    style={[
                      styles.dayHeadCell,
                      {
                        borderRightColor: colors.border,
                        backgroundColor: item.isToday
                          ? `${item.color}14`
                          : colors.card,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayHeadName,
                        { color: item.isToday ? item.color : colors.text },
                      ]}
                    >
                      {item.day.slice(0, 3)}
                    </Text>
                    <Text style={[styles.dayHeadDate, { color: colors.muted }]}>
                      {item.date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </Text>
                    {item.isToday ? (
                      <Text style={[styles.todayTag, { color: item.color }]}>
                        Today
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>

              {timetable.slots.map((slot, rowIndex) => {
                const range = getSlotRangeFromKey(slot.key);
                const isNowSlot =
                  range && nowMinutes >= range.start && nowMinutes < range.end;
                const zebraTint =
                  rowIndex % 2 === 0
                    ? colors.surface || colors.background
                    : null;
                const isLunch = slot.isLunch === true;
                return (
                  <View
                    key={slot.key}
                    style={[
                      styles.row,
                      isLunch
                        ? { backgroundColor: "rgba(245, 158, 11, 0.08)" }
                        : null,
                      zebraTint ? { backgroundColor: zebraTint } : null,
                      isNowSlot ? { backgroundColor: `${heroColor}12` } : null,
                      rowIndex === timetable.slots.length - 1
                        ? null
                        : { borderBottomColor: colors.border },
                    ]}
                  >
                    {isNowSlot ? (
                      <View
                        style={[styles.nowLine, { backgroundColor: heroColor }]}
                        pointerEvents="none"
                      />
                    ) : null}
                    <View
                      style={[
                        styles.timeCell,
                        {
                          borderRightColor: colors.border,
                          backgroundColor: colors.surface,
                        },
                        isNowSlot
                          ? { backgroundColor: `${heroColor}1a` }
                          : null,
                      ]}
                    >
                      <Text style={[styles.timeText, { color: colors.text }]}>
                        {slot.label}
                      </Text>
                      {isNowSlot ? (
                        <Text style={[styles.nowBadge, { color: heroColor }]}>
                          Now
                        </Text>
                      ) : null}
                    </View>

                    {weekItems.map((item, colIndex) => {
                      const cellClasses =
                        timetable.matrix[item.day][slot.key] || [];
                      const tint = item.color;
                      const isLastCol = colIndex === weekItems.length - 1;
                      return (
                        <View
                          key={`${slot.key}-${item.day}`}
                          style={[
                            styles.dayCell,
                            {
                              borderRightColor: isLastCol
                                ? "transparent"
                                : colors.border,
                              backgroundColor: item.isToday
                                ? isNowSlot
                                  ? `${tint}25`
                                  : `${tint}12`
                                : "transparent",
                            },
                          ]}
                        >
                          {cellClasses.length === 0 ? (
                            isLunch ? (
                              <View
                                style={[
                                  styles.lunchPill,
                                  { borderColor: "#f59e0b" },
                                ]}
                              >
                                <Text style={styles.lunchText}>
                                  Lunch Break
                                </Text>
                              </View>
                            ) : (
                              <View
                                style={[
                                  styles.emptySlot,
                                  { backgroundColor: colors.border },
                                ]}
                              />
                            )
                          ) : (
                            cellClasses.map((cls, idx) => {
                              const subjectColor = resolveSubjectColor(
                                cls.subject,
                                tint
                              );
                              const range = getClassRangeMinutes(cls);
                              const isCurrentClass =
                                item.isToday &&
                                range &&
                                nowMinutes >= range.start &&
                                nowMinutes < range.end;
                              const timeLabel = cls.timeDisplay || slot.label;
                              return (
                                <TouchableOpacity
                                  key={`${slot.key}-${item.day}-${idx}`}
                                  style={[
                                    styles.classPill,
                                    {
                                      backgroundColor: toRgba(
                                        subjectColor,
                                        isCurrentClass ? 0.22 : 0.12
                                      ),
                                      borderColor: toRgba(
                                        subjectColor,
                                        isCurrentClass ? 0.9 : 0.5
                                      ),
                                    },
                                    isCurrentClass ? styles.classPillNow : null,
                                  ]}
                                  onLongPress={() =>
                                    openColorPicker(cls.subject)
                                  }
                                  activeOpacity={0.9}
                                >
                                  <View style={styles.classPillHeader}>
                                    <View
                                      style={[
                                        styles.classAccent,
                                        { backgroundColor: subjectColor },
                                      ]}
                                    />
                                    <Text
                                      style={[
                                        styles.classSubject,
                                        { color: colors.text },
                                      ]}
                                      numberOfLines={2}
                                    >
                                      {cls.subject || "Class"}
                                    </Text>
                                    {isCurrentClass ? (
                                      <View
                                        style={[
                                          styles.classNowTag,
                                          { backgroundColor: subjectColor },
                                        ]}
                                      >
                                        <Text style={styles.classNowText}>
                                          NOW
                                        </Text>
                                      </View>
                                    ) : null}
                                  </View>
                                  <Text
                                    style={[
                                      styles.classTime,
                                      { color: colors.text },
                                    ]}
                                  >
                                    {timeLabel}
                                  </Text>
                                  <View style={styles.classMetaRow}>
                                    {cls.teacher ? (
                                      <Text
                                        style={[
                                          styles.classMeta,
                                          { color: colors.muted },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {cls.teacher}
                                      </Text>
                                    ) : null}
                                    {cls.room ? (
                                      <Text
                                        style={[
                                          styles.classMeta,
                                          { color: colors.muted },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        Room: {cls.room}
                                      </Text>
                                    ) : null}
                                  </View>
                                </TouchableOpacity>
                              );
                            })
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        <View style={{ height: 28 }} />
      </Animated.ScrollView>

      <Modal visible={colorPicker.visible} transparent animationType="fade">
        <View style={styles.colorOverlay}>
          <View
            style={[
              styles.colorCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.colorTitle, { color: colors.text }]}>
              Pick a color
            </Text>
            <Text
              style={[styles.colorSub, { color: colors.muted }]}
              numberOfLines={2}
            >
              {colorPicker.subject || "Subject"}
            </Text>
            <View style={styles.colorRow}>
              {SUBJECT_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[styles.colorSwatch, { backgroundColor: color }]}
                  onPress={async () => {
                    await applySubjectColor(colorPicker.subject, color);
                    setColorPicker({ visible: false, subject: "" });
                  }}
                />
              ))}
            </View>
            <View style={styles.colorActions}>
              <TouchableOpacity
                style={[styles.colorBtn, { borderColor: colors.border }]}
                onPress={() => {
                  setColorPicker({ visible: false, subject: "" });
                }}
              >
                <Text style={[styles.colorBtnText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.colorBtn, { borderColor: colors.border }]}
                onPress={async () => {
                  await resetSubjectColor(colorPicker.subject);
                  setColorPicker({ visible: false, subject: "" });
                }}
              >
                <Text style={[styles.colorBtnText, { color: colors.text }]}>
                  Reset
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingTop: 52,
    paddingBottom: 18,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroCircle: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -40,
    right: -30,
  },
  heroCircle2: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 8,
    right: 62,
  },
  heroCampus: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  heroSemester: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
    marginBottom: 6,
  },
  heroSub: { color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "600" },
  heroTitle: { color: "#fff", fontSize: 23, fontWeight: "800", marginTop: 2 },
  heroRange: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 12,
    marginTop: 2,
    marginBottom: 12,
  },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  content: { paddingTop: 14, paddingHorizontal: 14 },
  weekStrip: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  weekStripHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  weekStripHeader: { flex: 1 },
  weekStripTitle: { fontSize: 13, fontWeight: "800" },
  weekStripMeta: { fontSize: 11, marginTop: 2, fontWeight: "600" },
  weekStripTodayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  weekStripTodayText: { fontSize: 11, fontWeight: "700" },
  weekStripRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  weekStripChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    minWidth: 70,
  },
  weekStripDay: { fontSize: 12, fontWeight: "800" },
  weekStripDate: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  todayListCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  todayListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  todayListTitle: { fontSize: 14, fontWeight: "800" },
  todayListDate: { fontSize: 11, fontWeight: "600" },
  todayListItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  todayListTimeBox: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  todayListTime: { fontSize: 11, fontWeight: "800" },
  todayListSubject: { fontSize: 13, fontWeight: "800" },
  todayListMeta: { fontSize: 11, marginTop: 2 },
  todayListBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  todayListBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  statusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  statusTitle: { fontSize: 14, fontWeight: "800" },
  statusMeta: { fontSize: 11, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center" },
  statusBlock: { flex: 1 },
  statusLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  statusValue: { fontSize: 13, fontWeight: "800" },
  statusSub: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  statusEmpty: { fontSize: 12, fontWeight: "600" },
  statusDivider: {
    width: 1,
    height: 44,
    backgroundColor: "rgba(148,163,184,0.35)",
    marginHorizontal: 12,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 44,
    borderRadius: 18,
  },
  emptyTitle: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
  emptyText: { fontSize: 13, fontWeight: "600" },

  table: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    minWidth: 930,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: "row",
    minHeight: 90,
    borderBottomWidth: 1,
    position: "relative",
  },
  nowLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 6,
    height: 2,
  },

  timeHeadCell: {
    width: 130,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  timeHeadText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  dayHeadCell: {
    flex: 1,
    width: 133,
    minWidth: 133,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    paddingVertical: 10,
  },
  dayHeadName: { fontSize: 14, fontWeight: "800" },
  dayHeadDate: { fontSize: 11, fontWeight: "600" },
  todayTag: { marginTop: 2, fontSize: 10, fontWeight: "800" },

  timeCell: {
    width: 130,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    paddingHorizontal: 10,
  },
  timeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  nowBadge: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  dayCell: {
    flex: 1,
    width: 133,
    minWidth: 133,
    borderRightWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: "center",
    gap: 6,
  },
  emptySlot: {
    width: 26,
    height: 2,
    borderRadius: 2,
    alignSelf: "center",
    opacity: 0.45,
  },
  lunchPill: {
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
  },
  lunchText: { fontSize: 10, fontWeight: "800", color: "#b45309" },
  classPill: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 4,
  },
  classPillNow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  classPillHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  classAccent: { width: 6, height: 28, borderRadius: 3 },
  classSubject: { flex: 1, fontSize: 12, fontWeight: "800", lineHeight: 16 },
  classNowTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  classNowText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  classTime: { fontSize: 10, fontWeight: "700" },
  classMetaRow: { gap: 2 },
  classMeta: { fontSize: 10, fontWeight: "600" },

  colorOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  colorCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  colorTitle: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
  colorSub: { fontSize: 12, fontWeight: "600", marginBottom: 12 },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  colorSwatch: { width: 34, height: 34, borderRadius: 10 },
  colorActions: { flexDirection: "row", gap: 10 },
  colorBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  colorBtnText: { fontSize: 12, fontWeight: "700" },
});
