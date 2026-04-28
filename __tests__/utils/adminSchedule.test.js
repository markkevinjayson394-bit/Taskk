import {
  buildScheduleDocId,
  createEmptyWeek,
  DEFAULT_SCHOOL_YEAR,
  getAdjacentAcademicYear,
  SCHEDULE_DAYS,
  validateWeekSchedule,
} from "../../utils/adminSchedule";

function toIso(hour, minute = 0) {
  return new Date(2026, 2, 31, hour, minute, 0, 0).toISOString();
}

describe("adminSchedule", () => {
  test("createEmptyWeek returns every schedule day", () => {
    const week = createEmptyWeek();
    expect(Object.keys(week)).toEqual(SCHEDULE_DAYS);
    expect(Object.values(week).every((value) => Array.isArray(value) && value.length === 0)).toBe(true);
  });

  test("validateWeekSchedule passes a clean schedule", () => {
    const week = createEmptyWeek();
    week.Monday = [
      { subject: "Math", teacher: "Prof A", start: toIso(8), end: toIso(9) },
      { subject: "Science", teacher: "Prof B", start: toIso(9), end: toIso(10) },
    ];

    expect(validateWeekSchedule(week)).toEqual({
      hasErrors: false,
      totalIssues: 0,
      dayErrors: {},
    });
  });

  test("validateWeekSchedule catches overlaps", () => {
    const week = createEmptyWeek();
    week.Tuesday = [
      { subject: "Physics", teacher: "Prof A", start: toIso(8), end: toIso(10) },
      { subject: "Chem", teacher: "Prof B", start: toIso(9, 30), end: toIso(11) },
    ];

    const result = validateWeekSchedule(week);

    expect(result.hasErrors).toBe(true);
    expect(result.totalIssues).toBe(2);
    expect(result.dayErrors.Tuesday[0].overlap).toBe(true);
    expect(result.dayErrors.Tuesday[1].overlap).toBe(true);
  });

  test("validateWeekSchedule flags incomplete and invalid classes", () => {
    const week = createEmptyWeek();
    week.Wednesday = [
      { subject: "", teacher: "", start: toIso(11), end: toIso(10) },
    ];

    const result = validateWeekSchedule(week);

    expect(result.hasErrors).toBe(true);
    expect(result.totalIssues).toBe(3);
    expect(result.dayErrors.Wednesday[0]).toMatchObject({
      subjectMissing: true,
      teacherMissing: true,
      timeMissing: false,
      invalidRange: true,
    });
  });

  test("buildScheduleDocId normalizes key schedule parts", () => {
    expect(
      buildScheduleDocId({
        college: " cot ",
        course: "BSIT",
        year: "1",
        section: "A",
        semester: "1st Sem",
        academicYear: DEFAULT_SCHOOL_YEAR,
        scheduleType: "night",
      })
    ).toContain("typenight");
  });

  test("getAdjacentAcademicYear shifts from the provided academic year", () => {
    expect(getAdjacentAcademicYear("2025-2026", 1)).toBe("2026-2027");
    expect(getAdjacentAcademicYear("2025-2026", -1)).toBe("2024-2025");
  });
});
