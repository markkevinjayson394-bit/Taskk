import {
  buildCourseOptions,
  buildYearOptions,
  countClasses,
  deleteScheduleRecord,
  filterSchedules,
  mapScheduleRecord,
  sortSchedules,
} from "../../utils/adminScheduleBrowse";

describe("adminScheduleBrowse", () => {
  const schedules = [
    {
      id: "1",
      college: "cot",
      collegeLabel: "College of Technology",
      course: "BSIT",
      year: "1",
      section: "A",
      scheduleType: "Day",
      weekSchedule: { Monday: [{}, {}], Tuesday: [{}] },
    },
    {
      id: "2",
      college: "cot",
      collegeLabel: "College of Technology",
      course: "BIT Electronics",
      year: "2",
      section: "B",
      scheduleType: "Night",
      weekSchedule: { Wednesday: [{}] },
    },
    {
      id: "3",
      college: "coe",
      collegeLabel: "College of Engineering",
      course: "BSMX",
      year: "3",
      section: "C",
      scheduleType: "Day",
      weekSchedule: {},
    },
  ];

  test("filterSchedules applies college, course, year, and search filters", () => {
    expect(
      filterSchedules(schedules, {
        filterCollege: "COT",
        filterCourse: "BSIT",
        filterYear: "1",
        search: "section a day",
      })
    ).toEqual([schedules[0]]);
  });

  test("buildCourseOptions scopes course list by selected college", () => {
    const result = buildCourseOptions(schedules, "COT");
    expect(result).toContain("BSIT");
    expect(result).toContain("BIT Electronics");
    expect(result).not.toContain("BSME");
  });

  // Note: '4' is included because buildYearOptions seeds its Set with DEFAULT_YEAR_OPTIONS,
  // not because any schedule in the fixture has year '4'.
  test("buildYearOptions merges defaults with discovered years", () => {
    expect(buildYearOptions(schedules)).toEqual(["1", "2", "3", "4"]);
  });

  test("countClasses totals weekly classes", () => {
    expect(countClasses(schedules[0].weekSchedule)).toBe(3);
  });

  test("mapScheduleRecord normalizes a firestore schedule doc", () => {
    const mapped = mapScheduleRecord({
      id: "abc",
      data: () => ({
        college: "cot",
        course: " BSIT ",
        year: "Year 1",
        section: " A ",
        academicYear: " 2026-2027 ",
        scheduleType: " day ",
      }),
    });

    expect(mapped).toMatchObject({
      id: "abc",
      college: "COT",
      course: "BSIT",
      year: "1",
      section: "A",
      academicYear: "2026-2027",
      scheduleType: "day",
    });
  });

  test("sortSchedules orders by college, course, year, then section", () => {
    const sorted = sortSchedules([schedules[2], schedules[1], schedules[0]]);
    expect(sorted.map((item) => item.id)).toEqual(["3", "2", "1"]);
  });

  test("deleteScheduleRecord deletes the doc and reloads the list", async () => {
    const deleteDocFn = jest.fn().mockResolvedValue(undefined);
    const docFn = jest.fn().mockReturnValue("doc-ref");
    const reload = jest.fn().mockResolvedValue(undefined);

    await deleteScheduleRecord({
      id: "sched-1",
      dbRef: "db",
      deleteDocFn,
      docFn,
      reload,
    });

    expect(docFn).toHaveBeenCalledWith("db", "schedules", "sched-1");
    expect(deleteDocFn).toHaveBeenCalledWith("doc-ref");
    expect(reload).toHaveBeenCalled();
  });
});
