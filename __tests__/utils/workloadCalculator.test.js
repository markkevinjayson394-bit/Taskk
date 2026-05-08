import {
  calculateDailyWorkload,
  getWorkloadLabel,
} from "../../utils/workloadCalculator";

describe("Workload Calculator", () => {
  test("calculateDailyWorkload with no tasks returns 0", () => {
    expect(calculateDailyWorkload([])).toBe(0);
  });

  test("calculateDailyWorkload with completed tasks ignores them", () => {
    const tasks = [
      {
        type: "assignment",
        priority: "high",
        completed: true,
        dueAt: new Date(),
      },
    ];
    expect(calculateDailyWorkload(tasks)).toBe(0);
  });

  test("calculateDailyWorkload with past tasks ignores them", () => {
    const pastDate = new Date(Date.now() - 86400000);
    const tasks = [
      { type: "quiz", priority: "high", completed: false, dueAt: pastDate },
    ];
    expect(calculateDailyWorkload(tasks)).toBe(0);
  });

  test("calculateDailyWorkload with today task", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tasks = [
      { type: "quiz", priority: "high", completed: false, dueAt: today },
    ];
    expect(calculateDailyWorkload(tasks)).toBe(8);
  });

  test("calculateDailyWorkload urgency weighting", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86400000);
    const tasks = [
      {
        type: "assignment",
        priority: "medium",
        completed: false,
        dueAt: today,
      },
      {
        type: "assignment",
        priority: "medium",
        completed: false,
        dueAt: tomorrow,
      },
      {
        type: "assignment",
        priority: "medium",
        completed: false,
        dueAt: new Date(today.getTime() + 4 * 86400000),
      },
    ];
    expect(calculateDailyWorkload(tasks)).toBe(8);
  });

  test("getWorkloadLabel ranges", () => {
    expect(getWorkloadLabel(0)).toBe("Light");
    expect(getWorkloadLabel(9)).toBe("Light");
    expect(getWorkloadLabel(10)).toBe("Moderate");
    expect(getWorkloadLabel(19)).toBe("Moderate");
    expect(getWorkloadLabel(20)).toBe("Heavy");
  });
});
