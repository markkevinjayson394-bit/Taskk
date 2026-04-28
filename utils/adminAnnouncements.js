import { getCollegeLabel } from "../constants/academics";

export const AUDIENCE_OPTIONS = [
  { value: "all", label: "All Students", icon: "people", color: "#6366f1" },
  { value: "year", label: "Specific Year", icon: "calendar", color: "#0ea5e9" },
  {
    value: "course",
    label: "Specific Section",
    icon: "school",
    color: "#10b981",
  },
];

export const MANAGE_AUDIENCE_OPTIONS = [
  { value: "any", label: "All Audiences", icon: "apps", color: "#64748b" },
  ...AUDIENCE_OPTIONS,
];

export const YEAR_OPTIONS = ["1", "2", "3", "4"];
export const SECTION_OPTIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
export const MAX_IMAGE_KB = 180;

export function getSelectedAudience(audience) {
  return AUDIENCE_OPTIONS.find((item) => item.value === audience) || AUDIENCE_OPTIONS[0];
}

export function validateAnnouncementForm({
  title,
  message,
  audience,
  course,
  year,
  section,
  currentUid,
}) {
  if (!String(title || "").trim() || !String(message || "").trim()) {
    return {
      ok: false,
      title: "Missing Fields",
      message: "Please fill in both title and message.",
    };
  }
  if (audience === "course" && (!course || !year || !section)) {
    return {
      ok: false,
      title: "Missing Fields",
      message: "Please select course, year, and section.",
    };
  }
  if (audience === "year" && !year) {
    return {
      ok: false,
      title: "Missing Fields",
      message: "Please select a year.",
    };
  }
  if (!currentUid) {
    return {
      ok: false,
      title: "Session Expired",
      message: "Please log in again.",
    };
  }
  return { ok: true };
}

export function buildAnnouncementPayload({
  title,
  message,
  audience,
  college,
  course,
  year,
  section,
  imageBase64,
  imageNote,
}) {
  return {
    title: String(title || "").trim(),
    message: String(message || "").trim(),
    audience,
    college: audience === "all" ? "" : college || "",
    course: audience === "course" ? course : "",
    year: audience !== "all" ? year : "",
    section: audience === "course" ? section : "",
    imageBase64: imageBase64 || "",
    imageNote: String(imageNote || "").trim(),
  };
}

export function filterAnnouncements(
  announcements,
  manageAudience,
  manageSearch,
  getCollegeLabelFn = getCollegeLabel
) {
  const queryText = String(manageSearch || "").trim().toLowerCase();
  return announcements.filter((item) => {
    if (manageAudience !== "any" && item.audience !== manageAudience) {
      return false;
    }
    if (!queryText) return true;
    const haystack = [
      item.title,
      item.message,
      item.course,
      item.year ? `year ${item.year}` : "",
      item.section ? `section ${item.section}` : "",
      item.college ? getCollegeLabelFn(item.college) : "",
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    return haystack.includes(queryText);
  });
}

export function buildAudienceLabel(item, getCollegeLabelFn = getCollegeLabel) {
  const audience = getSelectedAudience(item.audience);
  let label = audience.label;
  if ((item.audience === "year" || item.audience === "course") && item.college) {
    label += ` - ${getCollegeLabelFn(item.college)}`;
  }
  if (item.audience === "year" && item.year) {
    label += ` - Y${item.year}`;
  }
  if (item.audience === "course" && item.course) {
    label += ` - ${item.course}`;
  }
  return label;
}

export function formatAnnouncementDateTime(value) {
  try {
    const tsDate = value?.toDate?.();
    const date =
      tsDate instanceof Date
        ? tsDate
        : value instanceof Date
          ? value
          : value
            ? new Date(value)
            : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (err) {
    console.warn("Failed to format date/time:", err);
    return "";
  }
}
