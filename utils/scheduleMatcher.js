import { collection, getDocs, query, where } from "firebase/firestore";
import { normalizeCollege, normalizeCourse } from "../constants/academics";

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeCourseLower(value) {
  return normalizeCourse(value).toLowerCase();
}

function matchesProfile(data, profile, allowCollegeFallback = false) {
  const profileCollege = normalizeCollege(profile.college);
  const dataCollege = normalizeCollege(data?.college);
  const collegeMatches = !profileCollege
    || dataCollege === profileCollege
    || (allowCollegeFallback && !dataCollege);
  return (
    collegeMatches &&
    normalizeCourseLower(data?.course) === normalizeCourseLower(profile.course) &&
    normalizeString(data?.year) === normalizeString(profile.year) &&
    normalizeLower(data?.section) === normalizeLower(profile.section)
  );
}

function matchesScheduleType(data, scheduleType) {
  if (!scheduleType) return true;
  return normalizeLower(data?.scheduleType) === normalizeLower(scheduleType);
}

function isSpecificScheduleType(data) {
  return normalizeLower(data?.scheduleType) === "specific";
}

export async function findBestScheduleDoc(db, profile = {}) {
  const { college, course, year, section, scheduleType } = profile;
  const rawCourse = normalizeString(course);
  const normalizedCourse = normalizeCourse(rawCourse);
  if (!normalizedCourse || !year || !section) return null;

  const schedulesRef = collection(db, "schedules");
  const normalizedCollege = normalizeCollege(college);
  const courseCandidates = [normalizedCourse];
  if (rawCourse && rawCourse !== normalizedCourse) {
    courseCandidates.push(rawCourse);
  }

  const tryExact = async (courseValue, includeCollege) => {
    const constraints = [
      where("course", "==", courseValue),
      where("year", "==", year),
      where("section", "==", section),
      where("scheduleType", "==", scheduleType || "Specific"),
    ];
    if (includeCollege && normalizedCollege) {
      constraints.push(where("college", "==", normalizedCollege));
    }
    const snap = await getDocs(query(schedulesRef, ...constraints));
    return snap.empty ? null : snap.docs[0];
  };

  if (normalizedCollege) {
    for (const courseValue of courseCandidates) {
      try {
        const exact = await tryExact(courseValue, true);
        if (exact) return { doc: exact, source: "exact" };
      } catch {
        // Continue with tolerant fallback below.
      }
    }
  }

  const exactNoCollegeSource = normalizedCollege ? "exact_no_college" : "exact";
  for (const courseValue of courseCandidates) {
    try {
      const exactNoCollege = await tryExact(courseValue, false);
      if (exactNoCollege) return { doc: exactNoCollege, source: exactNoCollegeSource };
    } catch {
      // Continue with tolerant fallback below.
    }
  }

  let courseDocs = [];
  try {
    for (const courseValue of courseCandidates) {
      const byCourseSnap = await getDocs(query(schedulesRef, where("course", "==", courseValue)));
      courseDocs = courseDocs.concat(byCourseSnap.docs);
    }
  } catch {
    return null;
  }

  let profileMatches = courseDocs.filter((d) => matchesProfile(d.data(), profile));
  if (!profileMatches.length && normalizedCollege) {
    profileMatches = courseDocs.filter((d) => matchesProfile(d.data(), profile, true));
  }
  if (!profileMatches.length) return null;

  const exactType = profileMatches.find((d) => matchesScheduleType(d.data(), scheduleType));
  if (exactType) return { doc: exactType, source: "fallback_exact_type" };

  const specificType = profileMatches.find((d) => isSpecificScheduleType(d.data()));
  if (specificType) return { doc: specificType, source: "fallback_specific_type" };

  return { doc: profileMatches[0], source: "fallback_profile_only" };
}
