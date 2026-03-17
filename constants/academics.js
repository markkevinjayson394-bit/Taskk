const COLLEGES = [
  { value: "COT", label: "College of Technology" },
  { value: "COE", label: "College of Engineering" },
  { value: "CED", label: "College of Education" },
  { value: "CME", label: "College of Management and Entrepreneurship" },
];

const COLLEGE_LABELS = COLLEGES.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const COLLEGE_NAME_TO_CODE = Object.entries(COLLEGE_LABELS).reduce(
  (acc, [code, label]) => {
    acc[String(label).toUpperCase()] = code;
    return acc;
  },
  {}
);

const COLLEGE_ALIASES = {
  COT: "COT",
  "COLLEGE OF TECHNOLOGY": "COT",
  COTECH: "COT",
  "COLLEGE OF TECH": "COT",
  COE: "COE",
  "COLLEGE OF ENGINEERING": "COE",
  ENGINEERING: "COE",
  CED: "CED",
  "COLLEGE OF EDUCATION": "CED",
  EDUCATION: "CED",
  CME: "CME",
  "COLLEGE OF MANAGEMENT AND ENTREPRENEURSHIP": "CME",
  "COLLEGE OF MANAGEMENT AND ENTREPRENURSHIP": "CME",
  MANAGEMENT: "CME",
  BUSINESS: "CME",
  BSME: "COE",
  BSCE: "COE",
  BSEE: "COE",
  BSHM: "CME",
  BSTM: "CME",
};

const COURSES_BY_COLLEGE = {
  COT: [
    "BSIT",
    "BSMX",
    "BIT CompTech",
    "BIT Drafting",
    "BIT Electrical",
    "BIT Electronics",
  ],
  CED: [
    "BEEd",
    "BTLEd Home Economics",
    "BSEd Mathematics",
    "BSEd Science",
    "BSEd English",
    "BSEd Social Studies",
  ],
  COE: ["BSIE", "BSME", "BSCE", "BSEE", "BSCpE"],
  CME: ["BSHM", "BSTM", "BSBA Marketing"],
};

const ALL_COURSES = Object.values(COURSES_BY_COLLEGE)
  .flat()
  .map((course) => (typeof course === "string" ? course.trim() : ""))
  .filter(Boolean);

const COURSE_CANONICAL = ALL_COURSES.reduce((acc, course) => {
  acc[course.toUpperCase()] = course;
  return acc;
}, {});

const COURSE_ALIASES = {
  "BTLED HOME EC": "BTLEd Home Economics",
  "BSED MATH": "BSEd Mathematics",
  BEED: "BEEd",
  "BACHELOR OF ELEMENTARY EDUCATION": "BEEd",
  "BACHELOR OF ELEMENTARY EDUCATION (BEED) NEW": "BEEd",
  "BACHELOR OF TECHNOLOGY AND LIVELIHOOD EDUCATION (BTLED) MAJOR IN HOME ECONOMICS":
    "BTLEd Home Economics",
  "BTLED HOME ECONOMICS": "BTLEd Home Economics",
  "BSED MATHEMATICS": "BSEd Mathematics",
  "BSED SCIENCE": "BSEd Science",
  "BSED ENGLISH": "BSEd English",
  "BSED SOCIAL STUDIES": "BSEd Social Studies",
  "BACHELOR OF SCIENCE IN INDUSTRIAL ENGINEERING (BSIE)": "BSIE",
  "BACHELOR OF SCIENCE IN MECHANICAL ENGINEERING (BSME)": "BSME",
  "BACHELOR OF SCIENCE IN CIVIL ENGINEERING (BSCE)": "BSCE",
  "BACHELOR OF SCIENCE IN ELECTRICAL ENGINEERING (BSEE)": "BSEE",
  "BACHELOR OF SCIENCE IN COMPUTER ENGINEERING (BSCPE)": "BSCpE",
  "BACHELOR OF SCIENCE IN COMPUTER ENGINEERING (BS CPE)": "BSCpE",
  "BACHELOR OF SCIENCE IN COMPUTER ENGINEERING (BSCPe)": "BSCpE",
  BSCPE: "BSCpE",
  "BS CPE": "BSCpE",
  "BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY (BSIT)": "BSIT",
  "BACHELOR OF SCIENCE IN MECHATRONICS (BSMX)": "BSMX",
  BSMX: "BSMX",
  "BACHELOR OF INDUSTRIAL TECHNOLOGY (BIT) MAJORS IN COMPUTER TECHNOLOGY":
    "BIT CompTech",
  "BIT COMPUTER": "BIT CompTech",
  "BIT COMPTECH": "BIT CompTech",
  "COMPUTER TECHNOLOGY": "BIT CompTech",
  "BACHELOR OF INDUSTRIAL TECHNOLOGY (BIT) MAJORS IN DRAFTING TECHNOLOGY":
    "BIT Drafting",
  "BACHELOR OF INDUSTRIAL TECHNOLOGY (BIT) MAJORS IN ELECTRICAL TECHNOLOGY":
    "BIT Electrical",
  "BACHELOR OF INDUSTRIAL TECHNOLOGY (BIT) MAJORS IN ELECTRONICS TECHNOLOGY":
    "BIT Electronics",
  "BACHELOR OF SCIENCE IN HOSPITALITY MANAGEMENT (BSHM)": "BSHM",
  "BACHELOR OF SCIENCE IN TOURISM MANAGEMENT (BSTM)": "BSTM",
  "BACHELOR OF SCIENCE IN BUSINESS ADMINISTRATION (BSBA) MAJOR IN MARKETING MANAGEMENT":
    "BSBA Marketing",
  "BSBA MARKETING MANAGEMENT": "BSBA Marketing",
  "BSBA MARKETING": "BSBA Marketing",
};

function normalizeCollege(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toUpperCase();
  return COLLEGE_ALIASES[key] || COLLEGE_NAME_TO_CODE[key] || raw;
}

function normalizeCourse(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toUpperCase();
  return COURSE_ALIASES[key] || COURSE_CANONICAL[key] || raw;
}

function getCollegeLabel(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const code = normalizeCollege(trimmed);
  // First try direct lookup
  if (COLLEGE_LABELS[code]) {
    return COLLEGE_LABELS[code];
  }
  // Try partial matching for edge cases
  const upperValue = trimmed.toUpperCase();
  for (const [labelKey, labelValue] of Object.entries(COLLEGE_LABELS)) {
    if (upperValue.includes(labelKey) || labelKey.includes(upperValue)) {
      return labelValue;
    }
  }
  // If still not found, return the original value or a formatted version
  // Capitalize first letter of each word for display
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCoursesForCollege(collegeValue) {
  const code = normalizeCollege(collegeValue);
  const list = COURSES_BY_COLLEGE[code];
  if (!Array.isArray(list)) return [];
  return list
    .map((course) => (typeof course === "string" ? course.trim() : ""))
    .filter(Boolean);
}

export {
  ALL_COURSES,
  COLLEGES,
  COURSES_BY_COLLEGE,
  getCollegeLabel,
  getCoursesForCollege,
  normalizeCollege,
  normalizeCourse
};


