import { collection, getDocs, query, where } from "firebase/firestore";
import { normalizeCollege, normalizeCourse } from "../constants/academics";
import { warnIfDev } from "./logger";

const SCHEDULE_MATCH_CACHE_TTL_MS = 5 * 60 * 1000;
const scheduleMatchCache = new Map();

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeCourseLower(value) {
  return normalizeCourse(value).toLowerCase();
}

function buildScheduleProfileCacheKey(profile = {}) {
  return [
    normalizeCollege(profile.college),
    normalizeCourse(profile.course),
    normalizeString(profile.year),
    normalizeLower(profile.section),
    normalizeLower(profile.scheduleType),
  ].join("|");
}

function readScheduleMatchCache(profile = {}) {
  const key = buildScheduleProfileCacheKey(profile);
  const cached = scheduleMatchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.savedAt > SCHEDULE_MATCH_CACHE_TTL_MS) {
    scheduleMatchCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeScheduleMatchCache(profile = {}, value) {
  const key = buildScheduleProfileCacheKey(profile);
  scheduleMatchCache.set(key, {
    savedAt: Date.now(),
    value,
  });
  return value;
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

function isDayScheduleType(data) {
  return normalizeLower(data?.scheduleType) === "day";
}

function isSpecificScheduleType(data) {
  return normalizeLower(data?.scheduleType) === "specific";
}

export async function findBestScheduleDoc(db, profile = {}) {
  const { college, course, year, section, scheduleType } = profile;
  const rawCourse = normalizeString(course);
  const normalizedCourse = normalizeCourse(rawCourse);
  if (!normalizedCourse || !year || !section) return null;

  const cached = readScheduleMatchCache(profile);
  if (cached !== null) return cached;

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
    ];
    if (scheduleType) {
      constraints.push(where("scheduleType", "==", scheduleType));
    }
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
        if (exact) {
          return writeScheduleMatchCache(profile, {
            doc: exact,
            source: "exact",
          });
        }
      } catch (err) {
        warnIfDev("findBestScheduleDoc: exact schedule lookup with college failed:", err);
        // Continue with tolerant fallback below.
      }
    }
  }

  const exactNoCollegeSource = normalizedCollege ? "exact_no_college" : "exact";
  for (const courseValue of courseCandidates) {
    try {
      const exactNoCollege = await tryExact(courseValue, false);
      if (exactNoCollege) {
        return writeScheduleMatchCache(profile, {
          doc: exactNoCollege,
          source: exactNoCollegeSource,
        });
      }
    } catch (err) {
      warnIfDev("findBestScheduleDoc: exact schedule lookup without college failed:", err);
      // Continue with tolerant fallback below.
    }
  }

  let courseDocs = [];
  for (const courseValue of courseCandidates) {
    try {
      const byCourseSnap = await getDocs(
        query(schedulesRef, where("course", "==", courseValue))
      );
      courseDocs = courseDocs.concat(byCourseSnap.docs);
    } catch (err) {
      warnIfDev("findBestScheduleDoc: fallback course query failed:", {
        courseValue,
        error: err,
      });
    }
  }
  if (!courseDocs.length) return writeScheduleMatchCache(profile, null);

  const uniqueCourseDocs = Array.from(
    new Map(courseDocs.map((docSnap) => [docSnap.id, docSnap])).values()
  );

  let profileMatches = uniqueCourseDocs.filter((d) => matchesProfile(d.data(), profile));
  if (!profileMatches.length && normalizedCollege) {
    profileMatches = uniqueCourseDocs.filter((d) =>
      matchesProfile(d.data(), profile, true)
    );
  }
  if (!profileMatches.length) return writeScheduleMatchCache(profile, null);

  const exactType = profileMatches.find((d) => matchesScheduleType(d.data(), scheduleType));
  if (exactType) {
    return writeScheduleMatchCache(profile, {
      doc: exactType,
      source: "fallback_exact_type",
    });
  }

  const dayType = profileMatches.find((d) => isDayScheduleType(d.data()));
  if (dayType) {
    return writeScheduleMatchCache(profile, {
      doc: dayType,
      source: "fallback_day_type",
    });
  }

  const specificType = profileMatches.find((d) => isSpecificScheduleType(d.data()));
  if (specificType) {
    return writeScheduleMatchCache(profile, {
      doc: specificType,
      source: "fallback_specific_type",
    });
  }

  return writeScheduleMatchCache(profile, {
    doc: profileMatches[0],
    source: "fallback_profile_only",
  });
}
