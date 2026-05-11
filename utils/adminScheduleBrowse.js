import {
  getCollegeLabel,
  getCoursesForCollege,
  normalizeCollege,
} from "../constants/academics";
import { COURSE_COLORS } from "../constants/courseColors";
import { normalizeText, normalizeYear } from "./scheduleHelpers";
export { COURSE_COLORS } from "../constants/courseColors";

export const DEFAULT_YEAR_OPTIONS = ["1", "2", "3", "4"];

export { normalizeText } from "./scheduleHelpers";

export function countClasses(weekSchedule) {
  if (!weekSchedule) return 0;
  return Object.values(weekSchedule).reduce(
    (acc, day) => acc + (day?.length || 0),
    0
  );
}

export function buildCourseOptions(schedules, filterCollege) {
  const seen = new Set();
  if (filterCollege !== "All") {
    // filterCollege is expected to already be normalized by the caller.
    const normalizedFilter = filterCollege;
    getCoursesForCollege(normalizedFilter).forEach((course) =>
      seen.add(course)
    );
    schedules.forEach((item) => {
      if (normalizeCollege(item.college) === normalizedFilter && item.course) {
        seen.add(item.course);
      }
    });
  } else {
    Object.keys(COURSE_COLORS).forEach((course) => seen.add(course));
    schedules.forEach((item) => {
      if (item.course) seen.add(item.course);
    });
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function buildYearOptions(schedules) {
  const seen = new Set(DEFAULT_YEAR_OPTIONS);
  schedules.forEach((item) => {
    if (item.year) seen.add(item.year);
  });
  return Array.from(seen).sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    return a.localeCompare(b);
  });
}

export function filterSchedules(schedules, filters) {
  const {
    filterCollege = "All",
    filterCourse = "All",
    filterYear = "All",
    search = "",
  } = filters || {};

  let data = schedules;
  if (filterCollege !== "All") {
    data = data.filter(
      (item) => normalizeCollege(item.college) === filterCollege
    );
  }
  if (filterCourse !== "All") {
    data = data.filter(
      (item) =>
        String(item.course || "").toLowerCase() === filterCourse.toLowerCase()
    );
  }
  if (filterYear !== "All") {
    data = data.filter((item) => String(item.year) === String(filterYear));
  }
  if (search.trim()) {
    const needle = search.trim().toLowerCase();
    data = data.filter((item) =>
      `${item.collegeLabel || ""} ${item.course} year ${item.year} section ${item.section} ${item.scheduleType || ""}`
        .toLowerCase()
        .includes(needle)
    );
  }
  return data;
}

export function mapScheduleRecord(scheduleDoc) {
  const raw = scheduleDoc.data() || {};
  const collegeCode = normalizeCollege(raw.college || "");
  const collegeLabel = getCollegeLabel(collegeCode || raw.college || "");
  const course = normalizeText(raw.course) || "Unknown Course";
  const year = normalizeYear(raw.year) || "-";
  const section = normalizeText(raw.section) || "-";
  const academicYear = normalizeText(raw.academicYear) || "";
  return {
    id: scheduleDoc.id,
    ...raw,
    college: collegeCode || raw.college || "",
    collegeLabel: collegeLabel || "",
    course,
    year,
    section,
    academicYear,
    scheduleType: normalizeText(raw.scheduleType) || "-",
  };
}

export function sortSchedules(schedules) {
  return [...schedules].sort((a, b) => {
    const byCollege = String(a.collegeLabel || "").localeCompare(
      String(b.collegeLabel || "")
    );
    if (byCollege !== 0) return byCollege;
    const byCourse = String(a.course || "").localeCompare(
      String(b.course || "")
    );
    if (byCourse !== 0) return byCourse;

    const aYear = Number(a.year);
    const bYear = Number(b.year);
    if (!Number.isNaN(aYear) && !Number.isNaN(bYear) && aYear !== bYear) {
      return aYear - bYear;
    }

    return a.section.localeCompare(b.section);
  });
}

export async function deleteScheduleRecord({
  id,
  dbRef,
  deleteDocFn,
  docFn,
  reload,
}) {
  await deleteDocFn(docFn(dbRef, "schedules", id));
  if (typeof reload === "function") {
    await reload();
  }
}
