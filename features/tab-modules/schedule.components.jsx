// app/(tabs)/schedule.components.js
// React components extracted from schedule.js - memoized/typed

import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import EmptyStateCard from "../../components/EmptyStateCard";
import { getClassRangeMinutes } from "../../utils/scheduleHelpers";
import {
  DAYS,
  DAY_COLORS,
  DAY_TINTS,
  DAY_TINTS_TODAY,
  SUBJECT_COLORS,
  TIME_COLUMN_WIDTH,
  DAY_COLUMN_WIDTH,
  weekMonthLabel,
  weekRangeLabel,
} from "./schedule.helpers";

// ─────────────────────────────────────────
// HERO
// ─────────────────────────────────────────
const ScheduleHero = memo(
  ({
    heroColor,
    semesterText,
    weekStart,
    weekEnd,
    totalClasses,
    daysWithClasses,
    fromCache,
    insets,
    children,
  }) => (
    <View style={{ position: "relative" }}>
      <View
        style={[
          styles.hero,
          { backgroundColor: heroColor, paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.heroCircle} />
        <View style={styles.heroCircle2} />
        <Text style={styles.heroCampus}>CTU Danao</Text>
        <Text style={styles.heroSemester}>{semesterText}</Text>
        <Text style={styles.heroSub}>Week of</Text>
        <Text style={styles.heroTitle}>
          {weekRangeLabel(weekStart, weekEnd)}
        </Text>
        <Text style={styles.heroRange}>{weekMonthLabel(weekStart)}</Text>
        <View style={styles.heroPills}>
          <HeroPill label={`${totalClasses} classes`} icon="calendar" />
          <HeroPill
            label={`${daysWithClasses} active days`}
            icon="grid-outline"
          />
          {fromCache && (
            <HeroPill label="Cached" icon="cloud-offline-outline" />
          )}
        </View>
        {children}
      </View>
    </View>
  )
);
ScheduleHero.displayName = "ScheduleHero";

const HeroPill = memo(({ label, icon }) => (
  <View style={styles.heroPill}>
    <Ionicons name={icon} size={11} color="#fff" />
    <Text style={styles.heroPillText}>{label}</Text>
  </View>
));
HeroPill.displayName = "HeroPill";

// ─────────────────────────────────────────
// WEEK STRIP
// ─────────────────────────────────────────
const WeekStrip = memo(
  ({
    weekItems,
    todayColumnIndex,
    scrollToDayIndex,
    colors,
    textPrimary,
    textMuted,
  }) => (
    <View
      style={[
        styles.weekStrip,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.weekStripHeaderRow}>
        <View style={styles.weekStripHeader}>
          <Text style={[styles.weekStripTitle, { color: textPrimary }]}>
            Jump to day
          </Text>
          <Text style={[styles.weekStripMeta, { color: textMuted }]}>
            Tap a day to focus the timetable
          </Text>
        </View>
        <WeekStripTodayBtn
          todayColumnIndex={todayColumnIndex}
          scrollToDayIndex={scrollToDayIndex}
          colors={colors}
        />
      </View>
      <View style={styles.weekStripRow}>
        {weekItems.map((item, index) => (
          <WeekStripChip
            key={item.day}
            {...item}
            index={index}
            onPress={() => scrollToDayIndex(index)}
            colors={{
              text:   textPrimary,
              muted:  textMuted,
              border: colors.border,
            }}
          />
        ))}
      </View>
    </View>
  )
);
WeekStrip.displayName = "WeekStrip";

const WeekStripTodayBtn = memo(
  ({ todayColumnIndex, scrollToDayIndex, colors }) => (
    <TouchableOpacity
      style={[styles.weekStripTodayBtn, { borderColor: colors.border }]}
      onPress={() => scrollToDayIndex(todayColumnIndex)}
      activeOpacity={0.85}
    >
      <Ionicons name="locate-outline" size={14} color={colors.primary} />
      <Text style={[styles.weekStripTodayText, { color: colors.primary }]}>
        Today
      </Text>
    </TouchableOpacity>
  )
);
WeekStripTodayBtn.displayName = "WeekStripTodayBtn";

// ─────────────────────────────────────────
// STATUS CARD
// ─────────────────────────────────────────
const StatusCard = memo(({ todayStatus, colors, textPrimary, textMuted }) => (
  <View
    style={[
      styles.statusCard,
      { backgroundColor: colors.card, borderColor: colors.border },
    ]}
  >
    <View style={styles.statusHeader}>
      <Text style={[styles.statusTitle, { color: textPrimary }]}>
        {"Today's Classes"}
      </Text>
      <Text style={[styles.statusMeta, { color: textMuted }]}>
        {todayStatus.done ? "No more classes today" : "Live status"}
      </Text>
    </View>
    <View style={styles.statusRow}>
      <StatusBlock
        label="Current"
        value={todayStatus.current?.cls.subject}
        sub={todayStatus.current?.cls.timeDisplay}
        colors={colors}
        textPrimary={textPrimary}
        textMuted={textMuted}
      />
      <View style={styles.statusDivider} />
      <StatusBlock
        label="Next"
        value={todayStatus.next?.cls.subject}
        sub={todayStatus.next?.cls.timeDisplay}
        colors={colors}
        textPrimary={textPrimary}
        textMuted={textMuted}
      />
    </View>
  </View>
));
StatusCard.displayName = "StatusCard";

// ─────────────────────────────────────────
// TODAY LIST CARD
// ─────────────────────────────────────────
const TodayListCard = memo(
  ({
    todayClassesList,
    todayStatus,
    todayLabel,
    openSubjectTasks,
    colors,
    textPrimary,
    textMuted,
    colorsPrimary,
  }) => (
    <View
      style={[
        styles.todayListCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.todayListHeader}>
        <Text style={[styles.todayListTitle, { color: textPrimary }]}>
          {"Today's Timeline"}
        </Text>
        <Text style={[styles.todayListDate, { color: textMuted }]}>
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
            borderColor:     colors.border,
          }}
        />
      ) : (
        todayClassesList.map((cls, index) => (
          <TodayListItem
            key={cls.id || `today-${index}-${cls.subject || "class"}`}
            cls={cls}
            isCurrent={
              todayStatus.current?.range?.start ===
              getClassRangeMinutes(cls)?.start
            }
            isNext={
              !todayStatus.current &&
              todayStatus.next?.range?.start ===
                getClassRangeMinutes(cls)?.start
            }
            onPress={() => openSubjectTasks(cls.subject)}
            colors={colors}
            textPrimary={textPrimary}
            textMuted={textMuted}
            colorsPrimary={colorsPrimary}
          />
        ))
      )}
    </View>
  )
);
TodayListCard.displayName = "TodayListCard";

// ─────────────────────────────────────────
// TABLE HEADER ROW
// ─────────────────────────────────────────
const TableHeaderRow = memo(({ weekItems, colors, textPrimary, textMuted }) => (
  <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
    {/* FIX: explicit width on time column header */}
    <View
      style={[
        styles.timeHeadCell,
        { borderRightColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      <Text style={[styles.timeHeadText, { color: textMuted }]}>Time</Text>
    </View>

    {weekItems.map((item) => (
      <DayHeadCell
        key={item.day}
        item={item}
        colors={colors}
        textPrimary={textPrimary}
        textMuted={textMuted}
      />
    ))}
  </View>
));
TableHeaderRow.displayName = "TableHeaderRow";

const TimeHeadCell = memo(({ colors, textMuted }) => (
  <View
    style={[
      styles.timeHeadCell,
      { borderRightColor: colors.border, backgroundColor: colors.surface },
    ]}
  >
    <Text style={[styles.timeHeadText, { color: textMuted }]}>Time</Text>
  </View>
));
TimeHeadCell.displayName = "TimeHeadCell";

const DayHeadCell = memo(({ item, colors, textPrimary, textMuted }) => {
  // FIX: always apply the day color as the header background
  const dayColor = DAY_COLORS[item.day] || colors.primary;
  return (
    <View
      style={[
        styles.dayHeadCell,
        {
          borderRightColor: colors.border,
          // FIX: colored header for each day, dimmed if not today
          backgroundColor: item.isToday ? dayColor : `${dayColor}99`,
        },
      ]}
    >
      <Text style={styles.dayHeadName}>
        {item.day.slice(0, 3)}
      </Text>
      <Text style={styles.dayHeadDate}>
        {item.date.toLocaleDateString("en-US", {
          month: "short",
          day:   "numeric",
        })}
      </Text>
      {item.isToday && (
        <View style={styles.todayTagBadge}>
          <Text style={styles.todayTagText}>TODAY</Text>
        </View>
      )}
    </View>
  );
});
DayHeadCell.displayName = "DayHeadCell";

// ─────────────────────────────────────────
// TABLE ROW
// ─────────────────────────────────────────
const TableRow = memo(
  ({
    slot,
    rowIndex,
    nowMinutes,
    heroColor,
    weekItems,
    timetable,
    colors,
    textPrimary,
    textMuted,
    colorsSurface,
    isLunch,
    zebraTint,
    isNowSlot,
    openColorPicker,
    openSubjectTasks,
    resolveSubjectColor,
  }) => {
    return (
      <View
        style={[
          styles.row,
          // FIX: zebra only when no stronger tint applies
          !isLunch && !isNowSlot && zebraTint
            ? { backgroundColor: zebraTint }
            : null,
          isLunch
            ? { backgroundColor: "rgba(245,158,11,0.10)" }
            : null,
          isNowSlot
            ? { backgroundColor: `${heroColor}14` }
            : null,
          rowIndex === timetable.slots.length - 1
            ? null
            : { borderBottomColor: colors.border },
        ]}
      >
        {isNowSlot && (
          <View style={[styles.nowLine, { backgroundColor: heroColor }]} />
        )}

        <TimeCell
          slot={slot}
          isNowSlot={isNowSlot}
          heroColor={heroColor}
          colors={colors}
          textPrimary={textPrimary}
        />

        {weekItems.map((item, colIndex) => (
          <DayCell
            key={`${slot.key}-${item.day}`}
            item={item}
            slot={slot}
            colIndex={colIndex}
            cellClasses={timetable.matrix[item.day][slot.key] || []}
            nowMinutes={nowMinutes}
            isNowSlot={isNowSlot}
            isLunch={isLunch}
            colors={colors}
            textPrimary={textPrimary}
            textMuted={textMuted}
            colorsSurface={colorsSurface}
            openColorPicker={openColorPicker}
            openSubjectTasks={openSubjectTasks}
            resolveSubjectColor={resolveSubjectColor}
            itemColor={item.color}
            isToday={item.isToday}
          />
        ))}
      </View>
    );
  }
);
TableRow.displayName = "TableRow";

// ─────────────────────────────────────────
// TIME CELL
// ─────────────────────────────────────────
const TimeCell = memo(({ slot, isNowSlot, heroColor, colors, textPrimary }) => (
  <View
    style={[
      styles.timeCell,
      {
        borderRightColor:  colors.border,
        backgroundColor:   isNowSlot
          ? `${heroColor}1a`
          : colors.surface,
      },
    ]}
  >
    {/* FIX: split time label into two lines so it never overflows */}
    {slot.label.includes(" - ") ? (
      <>
        <Text style={[styles.timeLabelTop, { color: isNowSlot ? heroColor : textPrimary }]}>
          {slot.label.split(" - ")[0]}
        </Text>
        <Text style={[styles.timeLabelBot, { color: isNowSlot ? heroColor : colors.muted || "#94a3b8" }]}>
          – {slot.label.split(" - ")[1]}
        </Text>
      </>
    ) : (
      <Text style={[styles.timeLabelTop, { color: textPrimary }]}>
        {slot.label}
      </Text>
    )}
    {isNowSlot && (
      <View style={[styles.nowBadgePill, { backgroundColor: heroColor }]}>
        <Text style={styles.nowBadgeText}>NOW</Text>
      </View>
    )}
  </View>
));
TimeCell.displayName = "TimeCell";

// ─────────────────────────────────────────
// DAY CELL
// ─────────────────────────────────────────
const DayCell = memo(
  ({
    item,
    slot,
    colIndex,
    cellClasses,
    nowMinutes,
    isNowSlot,
    isLunch,
    colors,
    textPrimary,
    textMuted,
    colorsSurface,
    openColorPicker,
    openSubjectTasks,
    resolveSubjectColor,
    itemColor,
    isToday,
  }) => {
    const isLastCol = colIndex === DAYS.length - 1;
    const dayColor  = DAY_COLORS[item.day] || itemColor;

    // FIX: pick the right background for every state
    let cellBg = "transparent";
    if (isLunch) {
      cellBg = "rgba(245,158,11,0.06)";
    } else if (isToday && isNowSlot) {
      cellBg = DAY_TINTS_TODAY[item.day] || `${dayColor}25`;
    } else if (isToday) {
      cellBg = DAY_TINTS[item.day] || `${dayColor}12`;
    }

    return (
      <View
        style={[
          styles.dayCell,
          {
            borderRightColor: isLastCol ? "transparent" : colors.border,
            backgroundColor:  cellBg,
          },
        ]}
      >
        {cellClasses.length === 0 ? (
          isLunch ? (
            <LunchPill />
          ) : (
            <EmptySlot colorsSurface={colorsSurface} />
          )
        ) : (
          cellClasses.map((cls, idx) => (
            <ClassPill
              key={`${slot.key}-${item.day}-${idx}`}
              cls={cls}
              isCurrentClass={
                isToday &&
                getClassRangeMinutes(cls) !== null &&
                nowMinutes >= getClassRangeMinutes(cls)?.start &&
                nowMinutes  < getClassRangeMinutes(cls)?.end
              }
              onPress={() => openSubjectTasks(cls.subject)}
              onLongPress={() => openColorPicker(cls.subject)}
              colors={colors}
              textPrimary={textPrimary}
              textMuted={textMuted}
              resolveSubjectColor={resolveSubjectColor}
              tint={dayColor}
            />
          ))
        )}
      </View>
    );
  }
);
DayCell.displayName = "DayCell";

// ─────────────────────────────────────────
// LUNCH PILL
// ─────────────────────────────────────────
const LunchPill = memo(() => (
  <View style={styles.lunchPill}>
    <Text style={styles.lunchEmoji}>🍱</Text>
    <Text style={styles.lunchText}>Lunch{"\n"}Break</Text>
  </View>
));
LunchPill.displayName = "LunchPill";

const EmptySlot = memo(({ colorsSurface }) => (
  <View style={[styles.emptySlot, { backgroundColor: colorsSurface }]} />
));
EmptySlot.displayName = "EmptySlot";

// ─────────────────────────────────────────
// CLASS PILL  ← main fix for the messy look
// ─────────────────────────────────────────
const ClassPill = memo(
  ({
    cls,
    isCurrentClass,
    onPress,
    onLongPress,
    colors,
    textPrimary,
    textMuted,
    resolveSubjectColor,
    tint,
  }) => {
    const bgColor = resolveSubjectColor(cls.subject) || tint || "#6366f1";

    return (
      <TouchableOpacity
        style={[
          styles.classPill,
          // FIX: use the subject color as a light fill + colored left border
          {
            backgroundColor: `${bgColor}1a`,
            borderLeftColor: bgColor,
            borderColor:     isCurrentClass ? bgColor : "transparent",
          },
          isCurrentClass && styles.classPillNow,
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.8}
      >
        {/* colored top accent bar */}
        <View style={[styles.classPillAccentBar, { backgroundColor: bgColor }]} />

        <View style={styles.classPillBody}>
          {/* subject name */}
          <Text
            style={[styles.classSubject, { color: textPrimary }]}
            numberOfLines={2}
          >
            {cls.subject || "Class"}
          </Text>

          {/* time */}
          {(cls.timeDisplay || cls.start) ? (
            <Text style={[styles.classTime, { color: bgColor }]} numberOfLines={1}>
              {cls.timeDisplay || `${cls.start} – ${cls.end}`}
            </Text>
          ) : null}

          {/* room */}
          {cls.room ? (
            <Text style={[styles.classMeta, { color: textMuted }]} numberOfLines={1}>
              {cls.room}
            </Text>
          ) : null}
        </View>

        {/* "IN" badge when currently active */}
        {isCurrentClass && (
          <View style={[styles.classNowTag, { backgroundColor: bgColor }]}>
            <Text style={styles.classNowText}>IN</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }
);
ClassPill.displayName = "ClassPill";

// ─────────────────────────────────────────
// WEEK STRIP CHIP
// ─────────────────────────────────────────
const WeekStripChip = memo(
  ({ day, date, index, onPress, color, isToday, colors }) => (
    <TouchableOpacity
      style={[
        styles.weekStripChip,
        {
          borderColor:     isToday ? color : colors.border,
          backgroundColor: isToday ? `${color}18` : "transparent",
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[styles.weekStripDay, { color: isToday ? color : colors.text }]}
      >
        {day.slice(0, 3)}
      </Text>
      <Text style={[styles.weekStripDate, { color: colors.muted }]}>
        {date.toLocaleDateString("en-US", { day: "numeric" })}
      </Text>
    </TouchableOpacity>
  )
);
WeekStripChip.displayName = "WeekStripChip";

// ─────────────────────────────────────────
// STATUS BLOCK
// ─────────────────────────────────────────
const StatusBlock = memo(
  ({ label, value, sub, colors, textPrimary, textMuted }) => (
    <View style={styles.statusBlock}>
      <Text style={[styles.statusLabel, { color: textMuted }]}>{label}</Text>
      {value ? (
        <>
          <Text style={[styles.statusValue, { color: textPrimary }]}>
            {value}
          </Text>
          {sub && (
            <Text style={[styles.statusSub, { color: textMuted }]}>{sub}</Text>
          )}
        </>
      ) : (
        <Text style={[styles.statusEmpty, { color: textMuted }]}>None</Text>
      )}
    </View>
  )
);
StatusBlock.displayName = "StatusBlock";

// ─────────────────────────────────────────
// TODAY LIST ITEM
// ─────────────────────────────────────────
const TodayListItem = memo(
  ({
    cls,
    isCurrent,
    isNext,
    onPress,
    colors,
    textPrimary,
    textMuted,
    colorsPrimary,
  }) => (
    <TouchableOpacity
      style={[
        styles.todayListItem,
        {
          borderColor:     colors.border,
          backgroundColor: isCurrent ? `${colorsPrimary}12` : colors.card,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.todayListTimeBox,
          {
            backgroundColor: isCurrent ? `${colorsPrimary}22` : colors.surface,
          },
        ]}
      >
        <Text style={[styles.todayListTime, { color: colorsPrimary }]}>
          {cls.timeDisplay || "TBA"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.todayListSubject, { color: textPrimary }]}
          numberOfLines={1}
        >
          {cls.subject || "Class"}
        </Text>
        <Text style={[styles.todayListMeta, { color: textMuted }]}>
          {cls.room || "Room TBA"}
        </Text>
      </View>
      {isCurrent && (
        <View
          style={[styles.todayListBadge, { backgroundColor: colorsPrimary }]}
        >
          <Text style={styles.todayListBadgeText}>Now</Text>
        </View>
      )}
      {isNext && (
        <View
          style={[styles.todayListBadge, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.todayListBadgeText}>Next</Text>
        </View>
      )}
    </TouchableOpacity>
  )
);
TodayListItem.displayName = "TodayListItem";

// ─────────────────────────────────────────
// COLOR PICKER MODAL
// ─────────────────────────────────────────
const ColorSwatch = memo(({ color, onPress }) => (
  <TouchableOpacity
    style={[styles.colorSwatch, { backgroundColor: color }]}
    onPress={onPress}
    activeOpacity={0.7}
  />
));
ColorSwatch.displayName = "ColorSwatch";

const ColorPickerModal = memo(
  ({
    colorPicker,
    setColorPicker,
    colors,
    textPrimary,
    textMuted,
    applySubjectColor,
    resetSubjectColor,
  }) => (
    <Modal visible={colorPicker.visible} transparent animationType="fade">
      <View style={styles.colorOverlay}>
        <View
          style={[
            styles.colorCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.colorTitle, { color: textPrimary }]}>
            Pick a color
          </Text>
          <Text
            style={[styles.colorSub, { color: textMuted }]}
            numberOfLines={2}
          >
            {colorPicker.subject || "Subject"}
          </Text>
          <View style={styles.colorRow}>
            {SUBJECT_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={color}
                onPress={() => {
                  applySubjectColor(colorPicker.subject, color);
                  setColorPicker({ visible: false, subject: "" });
                }}
              />
            ))}
          </View>
          <View style={styles.colorActions}>
            <ColorBtn
              label="Cancel"
              onPress={() => setColorPicker({ visible: false, subject: "" })}
              colors={colors}
              textPrimary={textPrimary}
            />
            <ColorBtn
              label="Reset"
              onPress={() => resetSubjectColor(colorPicker.subject)}
              colors={colors}
              textPrimary={textPrimary}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
);
ColorPickerModal.displayName = "ColorPickerModal";

const ColorBtn = memo(({ label, onPress, colors, textPrimary }) => (
  <TouchableOpacity
    style={[styles.colorBtn, { borderColor: colors.border }]}
    onPress={onPress}
  >
    <Text style={[styles.colorBtnText, { color: textPrimary }]}>{label}</Text>
  </TouchableOpacity>
));
ColorBtn.displayName = "ColorBtn";

// ─────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Hero ──────────────────────────────
  hero: {
    paddingTop:        52,
    paddingBottom:     18,
    paddingHorizontal: 20,
    overflow:          "hidden",
  },
  heroCircle: {
    position:        "absolute",
    width:           160,
    height:          160,
    borderRadius:    80,
    backgroundColor: "rgba(255,255,255,0.07)",
    top:             -40,
    right:           -30,
  },
  heroCircle2: {
    position:        "absolute",
    width:           90,
    height:          90,
    borderRadius:    45,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom:          8,
    right:           62,
  },
  heroCampus: {
    color:       "rgba(255,255,255,0.95)",
    fontSize:    12,
    fontWeight:  "800",
    letterSpacing: 0.4,
  },
  heroSemester: {
    color:        "rgba(255,255,255,0.85)",
    fontSize:     12,
    fontWeight:   "700",
    marginTop:    2,
    marginBottom: 6,
  },
  heroSub:   { color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "600" },
  heroTitle: { color: "#fff", fontSize: 23, fontWeight: "800", marginTop: 2 },
  heroRange: { color: "rgba(255,255,255,0.84)", fontSize: 12, marginTop: 2, marginBottom: 12 },
  heroPills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroPill: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              4,
    paddingHorizontal: 8,
    paddingVertical:  4,
    borderRadius:     12,
    backgroundColor:  "rgba(255,255,255,0.18)",
  },
  heroPillText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // ── Week Strip ────────────────────────
  weekStrip: {
    borderRadius:  16,
    borderWidth:   1,
    padding:       12,
    marginBottom:  14,
  },
  weekStripHeaderRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginBottom:   10,
  },
  weekStripHeader:   { flex: 1 },
  weekStripTitle:    { fontSize: 13, fontWeight: "800" },
  weekStripMeta:     { fontSize: 11, marginTop: 2, fontWeight: "600" },
  weekStripTodayBtn: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              6,
    borderWidth:      1,
    borderRadius:     12,
    paddingHorizontal: 10,
    paddingVertical:  6,
  },
  weekStripTodayText: { fontSize: 11, fontWeight: "700" },
  weekStripRow:       { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  weekStripChip: {
    borderWidth:      1,
    borderRadius:     12,
    paddingVertical:  8,
    paddingHorizontal: 10,
    alignItems:       "center",
    minWidth:         46,
  },
  weekStripDay:  { fontSize: 12, fontWeight: "800" },
  weekStripDate: { fontSize: 10, fontWeight: "600", marginTop: 2 },

  // ── Status Card ───────────────────────
  statusCard: {
    borderRadius:  16,
    borderWidth:   1,
    padding:       14,
    marginBottom:  14,
  },
  statusHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   10,
  },
  statusTitle:   { fontSize: 14, fontWeight: "800" },
  statusMeta:    { fontSize: 11, fontWeight: "600" },
  statusRow:     { flexDirection: "row", alignItems: "center" },
  statusBlock:   { flex: 1 },
  statusLabel: {
    fontSize:      11,
    fontWeight:    "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom:  4,
  },
  statusValue: { fontSize: 13, fontWeight: "800" },
  statusSub:   { fontSize: 11, fontWeight: "600", marginTop: 2 },
  statusEmpty: { fontSize: 12, fontWeight: "600" },
  statusDivider: {
    width:             1,
    height:            44,
    backgroundColor:   "rgba(148,163,184,0.35)",
    marginHorizontal:  12,
  },

  // ── Today List ────────────────────────
  todayListCard: {
    borderRadius:  16,
    borderWidth:   1,
    padding:       14,
    marginBottom:  14,
    gap:           10,
  },
  todayListHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
  },
  todayListTitle: { fontSize: 14, fontWeight: "800" },
  todayListDate:  { fontSize: 11, fontWeight: "600" },
  todayListItem: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              10,
    borderWidth:      1,
    borderRadius:     12,
    paddingHorizontal: 10,
    paddingVertical:  10,
  },
  todayListTimeBox: {
    paddingHorizontal: 8,
    paddingVertical:   6,
    borderRadius:      8,
  },
  todayListTime:       { fontSize: 11, fontWeight: "800" },
  todayListSubject:    { fontSize: 13, fontWeight: "800" },
  todayListMeta:       { fontSize: 11, marginTop: 2 },
  todayListBadge:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  todayListBadgeText:  { color: "#fff", fontSize: 10, fontWeight: "800" },

  // ── Timetable table ───────────────────
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },

  // FIX: explicit fixed widths for time column and day columns
  timeHeadCell: {
    width:           TIME_COLUMN_WIDTH,
    justifyContent:  "center",
    alignItems:      "center",
    paddingVertical: 10,
    borderRightWidth: 1,
  },
  timeHeadText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },

  dayHeadCell: {
    width:           DAY_COLUMN_WIDTH,
    alignItems:      "center",
    justifyContent:  "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    gap:             2,
  },
  dayHeadName: { fontSize: 13, fontWeight: "800", color: "#fff" },
  dayHeadDate: { fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.80)" },
  todayTagBadge: {
    marginTop:        3,
    backgroundColor:  "rgba(255,255,255,0.25)",
    borderRadius:     6,
    paddingHorizontal: 6,
    paddingVertical:  2,
  },
  todayTagText: { fontSize: 8, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },

  row: {
    flexDirection:  "row",
    minHeight:      80,          // FIX: consistent row height
    borderBottomWidth: 1,
    position:       "relative",
  },
  nowLine: {
    position:  "absolute",
    left:      0,
    right:     0,
    top:       0,
    height:    3,
    zIndex:    10,
  },

  // FIX: fixed widths match header cells exactly
  timeCell: {
    width:           TIME_COLUMN_WIDTH,
    justifyContent:  "center",
    alignItems:      "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRightWidth: 1,
  },
  timeLabelTop: {
    fontSize:   10,
    fontWeight: "700",
    textAlign:  "center",
  },
  timeLabelBot: {
    fontSize:   9,
    fontWeight: "500",
    textAlign:  "center",
    marginTop:  1,
  },
  nowBadgePill: {
    marginTop:        4,
    paddingHorizontal: 6,
    paddingVertical:  2,
    borderRadius:     6,
  },
  nowBadgeText: { fontSize: 8, fontWeight: "800", color: "#fff" },

  dayCell: {
    width:           DAY_COLUMN_WIDTH,
    minHeight:       80,
    padding:         4,
    borderRightWidth: 1,
    justifyContent:  "center",
    gap:             4,
  },

  // ── Class Pill ────────────────────────
  classPill: {
    borderRadius:    8,
    overflow:        "hidden",
    borderLeftWidth: 3,
    borderWidth:     1,
    marginVertical:  2,
  },
  classPillNow: {
    borderWidth: 1.5,
  },
  classPillAccentBar: {
    height: 3,
    width:  "100%",
  },
  classPillBody: {
    padding: 6,
    gap:     2,
  },
  classSubject: {
    fontSize:   12,
    fontWeight: "800",
    lineHeight: 15,
  },
  classTime: {
    fontSize:   10,
    fontWeight: "700",
  },
  classMeta: {
    fontSize:   10,
    fontWeight: "500",
  },
  classNowTag: {
    position:  "absolute",
    top:       4,
    right:     4,
    paddingHorizontal: 5,
    paddingVertical:   2,
    borderRadius:      5,
  },
  classNowText: { color: "#fff", fontSize: 8, fontWeight: "800" },

  // ── Lunch / empty ─────────────────────
  lunchPill: {
    alignItems:     "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap:            2,
  },
  lunchEmoji: { fontSize: 16 },
  lunchText: {
    fontSize:   9,
    fontWeight: "700",
    color:      "#b45309",
    textAlign:  "center",
  },
  emptySlot: {
    flex:         1,
    minHeight:    20,
    borderRadius: 4,
    opacity:      0.3,
  },

  // ── Color picker ──────────────────────
  colorOverlay: {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent:  "center",
    alignItems:      "center",
  },
  colorCard: {
    width:         300,
    borderRadius:  20,
    borderWidth:   1,
    padding:       24,
    gap:           12,
  },
  colorTitle: { fontSize: 18, fontWeight: "800" },
  colorSub:   { fontSize: 13, fontWeight: "500" },
  colorRow:   { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  colorSwatch: {
    width:        36,
    height:       36,
    borderRadius: 18,
  },
  colorActions:  { flexDirection: "row", gap: 10 },
  colorBtn: {
    flex:             1,
    borderWidth:      1,
    borderRadius:     12,
    paddingVertical:  10,
    alignItems:       "center",
  },
  colorBtnText: { fontSize: 13, fontWeight: "700" },
});

export {
  ClassPill, ColorBtn, ColorPickerModal,
  ColorSwatch, DayCell, DayHeadCell, EmptySlot, HeroPill, LunchPill, ScheduleHero,
  StatusBlock, StatusCard, TableHeaderRow, TableRow,
  TimeCell, TimeHeadCell, TodayListCard,
  TodayListItem, WeekStrip,
  WeekStripChip,
  WeekStripTodayBtn,
};