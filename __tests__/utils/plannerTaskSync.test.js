// NOTE: All test dates use UTC noon (T12:00:00Z) intentionally.
// This keeps dates unambiguous across timezones during testing.
// In production, always use dateHelpers.toLocalDayKey() for dayKey values.

import {
  buildCalendarPlanTasks,
  buildDayPlannerRef,
  computePlannerAnalytics,
  fetchPlannerAssignments,
  syncCalendarDayPlans,
  syncDayPlannerTasks,
  syncMonthPlannerTasks,
} from "../../utils/plannerTaskSync";
import { parseDueDate } from "../../utils/academicTaskModel";

const mockGetDocs = jest.fn();
const mockUpdateDoc = jest.fn();
const mockBatchCommit = jest.fn();
const mockBatchSet = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();
const mockServerTimestamp = jest.fn(() => ({ seconds: 0 }));
const mockTimestampFromDate = jest.fn((value) => value);
const mockErrorIfDev = jest.fn();
const mockWarnIfDev = jest.fn();

jest.mock("../../config/firebase", () => ({
  db: {},
}));

jest.mock("firebase/firestore", () => ({
  Timestamp: { fromDate: (...args) => mockTimestampFromDate(...args) },
  collection: (...args) => mockCollection(...args),
  doc: (...args) => mockDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  query: (...args) => ({ type: "query", args }),
  where: (...args) => ({ type: "where", args }),
  writeBatch: () => ({
    set: mockBatchSet,
    commit: mockBatchCommit,
  }),
  serverTimestamp: () => mockServerTimestamp(),
  updateDoc: (...args) => mockUpdateDoc(...args),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: (...args) => mockWarnIfDev(...args),
  errorIfDev: (...args) => mockErrorIfDev(...args),
}));

const today = new Date("2026-03-23T12:00:00Z");

function makeDoc(id, data) {
  return {
    id,
    data: () => data,
  };
}

describe("PlannerTaskSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockImplementation((...args) => ({ type: "collection", args }));
    mockDoc.mockImplementation((...args) => ({ type: "doc", args }));
    mockBatchSet.mockImplementation(() => undefined);
    mockBatchCommit.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
  });

  describe("parseDueDate", () => {
    test("handles Timestamp", () => {
      const timestamp = { toDate: () => new Date("2026-03-24T12:00:00Z") };
      expect(parseDueDate(timestamp)).toBeInstanceOf(Date);
    });

    test("handles Date", () => {
      const date = new Date("2026-03-24T12:00:00Z");
      expect(parseDueDate(date)).toBe(date);
    });

    test("handles string", () => {
      expect(parseDueDate("2026-03-24T12:00:00Z")).toBeInstanceOf(Date);
    });

    test("returns null for invalid values", () => {
      expect(parseDueDate(null)).toBe(null);
      expect(parseDueDate("invalid")).toBe(null);
      expect(parseDueDate(undefined)).toBe(null);
    });

    test("handles number timestamp", () => {
      expect(parseDueDate(Date.now())).toBeInstanceOf(Date);
    });

    test("handles Firebase Timestamp with NaN date", () => {
      const timestamp = { toDate: () => new Date("invalid") };
      expect(parseDueDate(timestamp)).toBe(null);
    });
  });

  describe("computePlannerAnalytics", () => {
    test("day range", () => {
      const tasks = [
        { dueDate: new Date("2026-03-23T12:00:00Z") },
        { dueDate: new Date("2026-03-24T12:00:00Z") },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.day.planned).toBe(1);
      expect(analytics.day.pending).toBe(1);
    });

    test("empty", () => {
      const analytics = computePlannerAnalytics([], today);
      expect(analytics.day.percent).toBe(0);
    });

    test("week range aggregates tasks in iso week", () => {
      const tasks = [
        { dueDate: new Date("2026-03-23T12:00:00Z") },
        { dueDate: new Date("2026-03-24T12:00:00Z") },
        { dueDate: new Date("2026-03-25T12:00:00Z") },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.week.planned).toBe(3);
    });

    test("month range aggregates tasks in month", () => {
      const tasks = [
        { dueDate: new Date("2026-03-01T12:00:00Z") },
        { dueDate: new Date("2026-03-15T12:00:00Z") },
        { dueDate: new Date("2026-04-01T12:00:00Z") },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.month.planned).toBe(2);
    });

    test("percent completion", () => {
      const tasks = [
        { dueDate: new Date("2026-03-23T12:00:00Z"), completed: true },
        { dueDate: new Date("2026-03-23T13:00:00Z"), completed: false },
        { dueDate: new Date("2026-03-23T14:00:00Z"), completed: true },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.day.percent).toBe(67);
    });

    test("week range with tasks spanning ISO week boundaries", () => {
      const tasks = [
        { dueDate: new Date("2026-03-23T12:00:00Z") },
        { dueDate: new Date("2026-03-28T12:00:00Z") },
        { dueDate: new Date("2026-03-29T12:00:00Z") },
        { dueDate: new Date("2026-03-30T12:00:00Z") },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.week.planned).toBe(3);
    });

    test("percent for week range", () => {
      const tasks = [
        { dueDate: new Date("2026-03-23T12:00:00Z"), completed: true },
        { dueDate: new Date("2026-03-24T12:00:00Z"), completed: false },
        { dueDate: new Date("2026-03-25T12:00:00Z"), completed: true },
        { dueDate: new Date("2026-03-26T12:00:00Z"), completed: false },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.week.percent).toBe(50);
    });

    test("percent for month range", () => {
      const tasks = [
        { dueDate: new Date("2026-03-05T12:00:00Z"), completed: true },
        { dueDate: new Date("2026-03-12T12:00:00Z"), completed: false },
        { dueDate: new Date("2026-03-19T12:00:00Z"), completed: true },
        { dueDate: new Date("2026-03-26T12:00:00Z"), completed: false },
      ];

      const analytics = computePlannerAnalytics(tasks, today);

      expect(analytics.month.percent).toBe(50);
    });
  });

  describe("buildCalendarPlanTasks", () => {
    test("keeps only plans from the requested day", () => {
      const plans = [
        {
          id: "plan_today",
          dayKey: "2026-03-23",
          title: "Read chapter 4",
          note: "Physics",
          priority: "urgent",
          time: "2026-03-23T08:00:00.000Z",
        },
        {
          id: "plan_other",
          dayKey: "2026-03-24",
          title: "Draft report",
          note: "Research",
          priority: "normal",
          time: "2026-03-24T09:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(
        new Date("2026-03-23T00:00:00.000Z"),
        "2026-03-23",
        plans
      );

      expect(tasks).toHaveLength(1);
      expect(tasks[0].plannerRef).toBe("calendar:day:2026-03-23:plan:plan_today");
      expect(tasks[0].title).toBe("Read chapter 4");
    });

    test("uses note as subject when provided", () => {
      const plans = [
        {
          id: "plan1",
          dayKey: "2026-03-23",
          title: "Finish assignment",
          note: "Mathematics",
          priority: "normal",
          time: "2026-03-23T10:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks[0].subject).toBe("Mathematics");
    });

    test("defaults to Calendar Plan subject when no note", () => {
      const plans = [
        {
          id: "plan1",
          dayKey: "2026-03-23",
          title: "Meeting",
          note: "",
          priority: "normal",
          time: "2026-03-23T10:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks[0].subject).toBe("Calendar Plan");
    });

    test("maps planner urgency to assignment priority", () => {
      const plans = [
        {
          id: "plan1",
          dayKey: "2026-03-23",
          title: "Urgent task",
          note: "Work",
          priority: "urgent",
          time: "2026-03-23T10:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks[0].priority).toBe("high");
    });

    test("skips plans with null id", () => {
      const plans = [
        {
          id: null,
          title: "Some Title",
          note: "Work",
          priority: "normal",
          time: "2026-03-23T10:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks).toHaveLength(0);
    });

    test("generates default title when title is missing", () => {
      const plans = [
        {
          id: "abc12345",
          dayKey: "2026-03-23",
          title: undefined,
          note: "Work",
          priority: "normal",
          time: "2026-03-23T10:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks[0].title).toContain("abc12345");
    });

    test("deduplicates plans with same id", () => {
      const plans = [
        {
          id: "plan1",
          dayKey: "2026-03-23",
          title: "Task 1",
          note: "Work",
          priority: "normal",
          time: "2026-03-23T10:00:00.000Z",
        },
        {
          id: "plan1",
          dayKey: "2026-03-23",
          title: "Task 1 duplicate",
          note: "Work",
          priority: "normal",
          time: "2026-03-23T11:00:00.000Z",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks).toHaveLength(1);
    });

    test("skips plans with no time field and uses base date", () => {
      const plans = [
        {
          id: "plan_no_time",
          dayKey: "2026-03-23",
          title: "All-day event",
          note: "General",
        },
      ];

      const tasks = buildCalendarPlanTasks(today, "2026-03-23", plans);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("All-day event");
      expect(tasks[0].dueDate.toISOString()).toBe(today.toISOString());
    });

    test("returns empty array for empty plan list", () => {
      const tasks = buildCalendarPlanTasks(today, "2026-03-23", []);
      expect(tasks).toHaveLength(0);
    });
  });

  describe("buildDayPlannerRef", () => {
    test("generates correctly formatted ref", () => {
      const ref = buildDayPlannerRef("2026-03-23", "block-1");
      expect(ref).toBe("planner:day:2026-03-23:block:block-1");
    });

    test("truncates long inputs", () => {
      const longDay = "a".repeat(100);
      const longBlock = "b".repeat(200);
      const ref = buildDayPlannerRef(longDay, longBlock);
      expect(ref.length).toBeLessThan(200);
    });

    test("handles empty strings", () => {
      const ref = buildDayPlannerRef("", "");
      expect(ref).toBe("planner:day:unknown-day:block:unknown-block");
    });
  });

  describe("syncCalendarDayPlans", () => {
    test("happy path creates tasks for calendar plans", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const plans = [
        {
          id: "cp1",
          dayKey: "2026-03-23",
          title: "Math review",
          note: "Algebra",
          priority: "urgent",
          time: "2026-03-23T09:00:00.000Z",
        },
      ];

      const result = await syncCalendarDayPlans(
        "uid123",
        today,
        "2026-03-23",
        plans
      );

      expect(result).toEqual({ created: 1, updated: 0, archived: 0 });
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
      expect(mockBatchSet.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          title: "Math review",
          subject: "Algebra",
          subjectName: "Algebra",
          plannerRef: "calendar:day:2026-03-23:plan:cp1",
          priority: "high",
        })
      );
    });

    test("empty plan list creates nothing", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const result = await syncCalendarDayPlans("uid123", today, "2026-03-23", []);

      expect(result).toEqual({ created: 0, updated: 0, archived: 0 });
      expect(mockBatchSet).not.toHaveBeenCalled();
    });

    test("plan with no time field still creates a task using the base date", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const plans = [
        {
          id: "cp_no_time",
          dayKey: "2026-03-23",
          title: "All-day study",
          note: "Physics",
        },
      ];

      const result = await syncCalendarDayPlans(
        "uid123",
        today,
        "2026-03-23",
        plans
      );

      expect(result.created).toBe(1);
      expect(parseDueDate(mockBatchSet.mock.calls[0][1].dueAt)?.toISOString()).toBe(
        today.toISOString()
      );
    });
  });

  describe("syncDayPlannerTasks", () => {
    test("creates new assignments for new time blocks", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const blocks = [
        { id: "block1", task: "New task", subject: "Math", start: "09:00", end: "10:00" },
      ];

      const result = await syncDayPlannerTasks("uid123", today, "2026-03-23", blocks);

      expect(result.created).toBe(1);
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
    });

    test("returns zero when no blocks are provided", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const result = await syncDayPlannerTasks("uid123", today, "2026-03-23", []);

      expect(result).toEqual({ created: 0, updated: 0, archived: 0 });
    });

    test("skips blocks with empty task titles", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const blocks = [{ id: "block1", task: "", subject: "Math" }];

      const result = await syncDayPlannerTasks("uid123", today, "2026-03-23", blocks);

      expect(result.created).toBe(0);
      expect(mockBatchSet).not.toHaveBeenCalled();
    });

    test("does not update when Timestamp dueAt matches the desired Date", async () => {
      const matchingDueAt = new Date(today);
      matchingDueAt.setHours(10, 0, 0, 0);

      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc_same", {
            plannerRef: "planner:day:2026-03-23:block:block1",
            plannerBucket: "day:2026-03-23",
            source: "planner",
            title: "Read notes",
            subject: "Math",
            subjectName: "Math",
            subjectId: "subject_math",
            status: "todo",
            completed: false,
            plannerArchived: false,
            priority: "medium",
            priorityLevel: 2,
            schemaVersion: 2,
            type: "assignment",
            dueAt: { toDate: () => matchingDueAt },
          }),
        ],
      });

      const blocks = [
        { id: "block1", task: "Read notes", subject: "Math", start: "09:00", end: "10:00" },
      ];

      const result = await syncDayPlannerTasks("uid123", today, "2026-03-23", blocks);

      expect(result).toEqual({ created: 0, updated: 0, archived: 0 });
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    test("update path triggers updateDoc when taskNeedsUpdate is true", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc_existing", {
            plannerRef: "planner:day:2026-03-23:block:block1",
            plannerBucket: "day:2026-03-23",
            source: "planner",
            title: "Old title",
            subject: "Math",
            subjectName: "Math",
            subjectId: "subject_math",
            status: "todo",
            completed: false,
            plannerArchived: false,
            priority: "medium",
            priorityLevel: 2,
            schemaVersion: 2,
            type: "assignment",
            dueAt: { toDate: () => new Date("2026-03-23T10:00:00Z") },
          }),
        ],
      });

      const blocks = [
        { id: "block1", task: "New title", subject: "Math", start: "09:00", end: "10:00" },
      ];

      const result = await syncDayPlannerTasks("uid123", today, "2026-03-23", blocks);

      expect(result).toEqual({ created: 0, updated: 1, archived: 0 });
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: "New title",
          subject: "Math",
          subjectName: "Math",
          subjectId: "subject_math",
          plannerArchived: false,
        })
      );
    });

    test("archive path marks stale tasks with plannerArchived true", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc_stale", {
            plannerRef: "planner:day:2026-03-23:block:block_old",
            plannerBucket: "day:2026-03-23",
            source: "planner",
            title: "Deleted block",
            subject: "Math",
            subjectName: "Math",
            subjectId: "subject_math",
            status: "todo",
            completed: false,
            plannerArchived: false,
            priority: "medium",
            priorityLevel: 2,
            schemaVersion: 2,
            type: "assignment",
            dueAt: { toDate: () => new Date("2026-03-23T10:00:00Z") },
          }),
        ],
      });

      const result = await syncDayPlannerTasks("uid123", today, "2026-03-23", []);

      expect(result).toEqual({ created: 0, updated: 0, archived: 1 });
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ plannerArchived: true })
      );
    });
  });

  describe("syncMonthPlannerTasks", () => {
    test("creates milestone tasks", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const milestones = ["Finish draft", "Submit report"];

      const result = await syncMonthPlannerTasks("uid123", today, "2026-03", milestones);

      expect(result.created).toBe(2);
      expect(mockBatchSet).toHaveBeenCalledTimes(2);
    });

    test("skips empty milestone titles", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      const milestones = ["Valid milestone", "", "Another valid"];

      const result = await syncMonthPlannerTasks("uid123", today, "2026-03", milestones);

      expect(result.created).toBe(2);
    });

    test("update path triggers updateDoc when taskNeedsUpdate is true", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc_month_existing", {
            plannerRef: "planner:month:2026-03:milestone:1",
            plannerBucket: "month:2026-03",
            source: "planner",
            title: "Old milestone",
            subject: "Monthly Planner",
            subjectName: "Monthly Planner",
            subjectId: "subject_monthly_planner",
            status: "todo",
            completed: false,
            plannerArchived: false,
            priority: "medium",
            priorityLevel: 2,
            schemaVersion: 2,
            type: "project",
            dueAt: { toDate: () => new Date("2026-03-31T20:00:00Z") },
          }),
        ],
      });

      const milestones = ["Updated milestone title"];

      const result = await syncMonthPlannerTasks("uid123", today, "2026-03", milestones);

      expect(result).toEqual({ created: 0, updated: 1, archived: 0 });
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: "Updated milestone title",
          plannerArchived: false,
        })
      );
    });

    test("archive path marks stale milestone tasks with plannerArchived true", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc_month_stale", {
            plannerRef: "planner:month:2026-03:milestone:99",
            plannerBucket: "month:2026-03",
            source: "planner",
            title: "Removed milestone",
            subject: "Monthly Planner",
            subjectName: "Monthly Planner",
            subjectId: "subject_monthly_planner",
            status: "todo",
            completed: false,
            plannerArchived: false,
            priority: "medium",
            priorityLevel: 2,
            schemaVersion: 2,
            type: "project",
            dueAt: { toDate: () => new Date("2026-03-31T20:00:00Z") },
          }),
        ],
      });

      const result = await syncMonthPlannerTasks("uid123", today, "2026-03", []);

      expect(result).toEqual({ created: 0, updated: 0, archived: 1 });
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ plannerArchived: true })
      );
    });
  });

  describe("fetchPlannerAssignments", () => {
    test("returns only planner source assignments", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc1", {
            source: "planner",
            plannerArchived: false,
            dueAt: { toDate: () => new Date("2026-03-23T12:00:00Z") },
          }),
          makeDoc("doc2", {
            source: "manual",
            dueAt: { toDate: () => new Date("2026-03-23T12:00:00Z") },
          }),
        ],
      });

      const assignments = await fetchPlannerAssignments("uid123");

      expect(assignments).toHaveLength(1);
      expect(assignments[0].source).toBe("planner");
    });

    test("excludes archived planner assignments", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc1", {
            source: "planner",
            plannerArchived: true,
            dueAt: { toDate: () => new Date("2026-03-23T12:00:00Z") },
          }),
        ],
      });

      const assignments = await fetchPlannerAssignments("uid123");

      expect(assignments).toHaveLength(0);
    });

    test("excludes assignments with invalid due dates", async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          makeDoc("doc1", {
            source: "planner",
            plannerArchived: false,
            dueAt: { toDate: () => new Date("invalid") },
          }),
        ],
      });

      const assignments = await fetchPlannerAssignments("uid123");

      expect(assignments).toHaveLength(0);
    });

    test("re-throws Firestore errors from fetchAssignmentsByUser", async () => {
      const firestoreError = new Error("Firestore unavailable");
      mockGetDocs.mockRejectedValueOnce(firestoreError);

      await expect(fetchPlannerAssignments("uid123")).rejects.toThrow(
        "Firestore unavailable"
      );
      expect(mockErrorIfDev).toHaveBeenCalledWith(
        "Failed to fetch assignments:",
        firestoreError
      );
    });
  });
});

