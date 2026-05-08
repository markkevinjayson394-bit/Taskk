import {
  buildTaskCreateData,
  parseDueDate,
} from "../../utils/academicTaskModel";

describe("academicTaskModel", () => {
  describe("parseDueDate", () => {
    it("returns null for null", () => expect(parseDueDate(null)).toBeNull());
    it("parses ISO string", () =>
      expect(parseDueDate("2025-01-15")).toBeInstanceOf(Date));
    it("parses Firestore Timestamp", () => {
      const ts = { toDate: () => new Date("2025-01-15") };
      expect(parseDueDate(ts)).toEqual(new Date("2025-01-15"));
    });
    it("parses plain Firestore object", () => {
      expect(parseDueDate({ seconds: 1700000000 })).toBeInstanceOf(Date);
    });
  });

  it("preserves a custom reminder date when building task data", () => {
    const customReminderAt = new Date("2026-05-02T09:30:00.000Z");
    const task = buildTaskCreateData({
      userId: "user-1",
      title: "Write report",
      subject: "English",
      dueAt: new Date("2026-05-02T10:00:00.000Z"),
      customReminderAt,
    });

    expect(task.customReminderAt).toBeInstanceOf(Date);
    expect(task.customReminderAt.toISOString()).toBe(
      customReminderAt.toISOString()
    );
  });

  it("preserves at-creation reminder metadata when building task data", () => {
    const task = buildTaskCreateData({
      userId: "user-1",
      title: "Submit reflection",
      subject: "English",
      dueAt: new Date("2026-05-02T10:00:00.000Z"),
      reminderPolicy: {
        mode: "persistent",
        acknowledgeRequired: true,
        dailyOverdue: true,
        type: "at_creation",
      },
    });

    expect(task.reminderPolicy).toMatchObject({
      mode: "persistent",
      acknowledgeRequired: true,
      dailyOverdue: true,
      type: "at_creation",
    });
  });
});
