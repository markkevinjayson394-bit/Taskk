import {
  COLLEGES,
  getCoursesForCollege,
  normalizeCollege,
  normalizeCourse,
} from "../constants/academics";
import { warnIfDev } from "./logger";

export const SCHEDULE_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const SCHOOL_YEAR_RANGE = 2;
const CURRENT_YEAR = new Date().getFullYear();

function buildSchoolYears(centerYear, range) {
  const list = [];
  for (let year = centerYear - range; year <= centerYear + range; year += 1) {
    list.push(`${year}-${year + 1}`);
  }
  return list;
}

function parseAcademicYear(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

function buildAcademicYear(startYear) {
  return `${startYear}-${startYear + 1}`;
}

function slugPart(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "na"
  );
}

export const SCHOOL_YEAR_OPTIONS = buildSchoolYears(
  CURRENT_YEAR,
  SCHOOL_YEAR_RANGE
);

export const DEFAULT_SCHOOL_YEAR =
  SCHOOL_YEAR_OPTIONS[SCHOOL_YEAR_RANGE] ||
  `${CURRENT_YEAR}-${CURRENT_YEAR + 1}`;

export function getAdjacentAcademicYear(value, delta) {
  const parsed = parseAcademicYear(value);
  if (parsed) return buildAcademicYear(parsed.start + delta);
  return buildAcademicYear(CURRENT_YEAR + delta);
}

export function findCollegeForCourse(courseValue) {
  const normalized = normalizeCourse(courseValue);
  if (!normalized) return "";
  for (const collegeItem of COLLEGES) {
    const list = getCoursesForCollege(collegeItem.value);
    if (list.some((item) => normalizeCourse(item) === normalized)) {
      return collegeItem.value;
    }
  }
  return "";
}

export function cleanText(value) {
  return String(value || "").trim();
}

export function normalizeScheduleTypeValue(value) {
  const lowered = String(value || "")
    .trim()
    .toLowerCase();
  if (lowered === "night") return "Night";
  if (lowered === "day") return "Day";
  warnIfDev("normalizeScheduleTypeValue: unrecognized schedule type:", value);
  return "Day";
}

export function buildLegacyScheduleDocId({ course, year, section }) {
  return `${slugPart(normalizeCourse(course))}_${slugPart(year)}_${slugPart(section)}`;
}

export function buildScheduleDocId({
  college,
  course,
  year,
  section,
  semester,
  academicYear,
  scheduleType,
}) {
  return [
    "sched",
    slugPart(normalizeCollege(college)),
    slugPart(normalizeCourse(course)),
    `y${slugPart(year)}`,
    `sec${slugPart(section)}`,
    `sem${slugPart(semester)}`,
    `sy${slugPart(academicYear)}`,
    `type${slugPart(normalizeScheduleTypeValue(scheduleType))}`,
  ].join("__");
}

export function getMinutesFromIso(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

export function createEmptyWeek() {
  return SCHEDULE_DAYS.reduce((acc, day) => {
    acc[day] = [];
    return acc;
  }, {});
}

export function validateWeekSchedule(weekSchedule = {}) {
  const dayErrors = {};
  let totalIssues = 0;

  for (const day of SCHEDULE_DAYS) {
    const classes = Array.isArray(weekSchedule[day]) ? weekSchedule[day] : [];
    const classErrors = {};
    const timed = [];

    classes.forEach((cls, index) => {
      const subjectMissing = !cleanText(cls?.subject);
      const teacherMissing = !cleanText(cls?.teacher);
      const startMinutes = getMinutesFromIso(cls?.start);
      const endMinutes = getMinutesFromIso(cls?.end);
      const timeMissing = startMinutes === null || endMinutes === null;
      const invalidRange =
        !timeMissing &&
        Number.isFinite(startMinutes) &&
        Number.isFinite(endMinutes) &&
        endMinutes <= startMinutes;

      if (subjectMissing || teacherMissing || timeMissing || invalidRange) {
        classErrors[index] = {
          subjectMissing,
          teacherMissing,
          timeMissing,
          invalidRange,
          overlap: false,
        };
      }

      if (!timeMissing && !invalidRange) {
        timed.push({ index, startMinutes, endMinutes });
      }
    });

    timed.sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) {
        return a.startMinutes - b.startMinutes;
      }
      return a.endMinutes - b.endMinutes;
    });

    for (let i = 1; i < timed.length; i += 1) {
      const previous = timed[i - 1];
      const current = timed[i];
      if (current.startMinutes < previous.endMinutes) {
        classErrors[previous.index] = {
          ...(classErrors[previous.index] || {
            subjectMissing: false,
            teacherMissing: false,
            timeMissing: false,
            invalidRange: false,
          }),
          overlap: true,
        };
        classErrors[current.index] = {
          ...(classErrors[current.index] || {
            subjectMissing: false,
            teacherMissing: false,
            timeMissing: false,
            invalidRange: false,
          }),
          overlap: true,
        };
      }
    }

    let dayIssueCount = 0;
    for (const errs of Object.values(classErrors)) {
      for (const flag in errs) {
        if (errs[flag]) dayIssueCount++;
      }
    }
    if (dayIssueCount > 0) {
      totalIssues += dayIssueCount;
      dayErrors[day] = classErrors;
    }
  }

  return {
    hasErrors: totalIssues > 0,
    totalIssues,
    dayErrors,
  };
}
