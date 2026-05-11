const mockRegisterHeadlessTask = jest.fn();
const mockNotifee = {
  cancelNotification: jest.fn().mockResolvedValue(undefined),
};
const mockNotifications = {
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
};
const mockAdvanceCheckpoint = jest.fn().mockResolvedValue({
  key: "+15m",
  delayMs: 15 * 60 * 1000,
  triggerAtMs: null,
});
const mockGetCheckpoint = jest.fn();
const mockSetCheckpoint = jest.fn().mockResolvedValue(undefined);
const mockCompareOverdueStageOrder = jest.fn((a, b) => {
  const order = { due: 0, "+15m": 1, daily: 2 };
  const aIndex = Object.prototype.hasOwnProperty.call(order, a) ? order[a] : -1;
  const bIndex = Object.prototype.hasOwnProperty.call(order, b) ? order[b] : -1;
  return aIndex - bIndex;
});
const mockScheduleNextOverdueAlarm = jest
  .fn()
  .mockResolvedValue("next-overdue-id");

jest.mock("@notifee/react-native", () => ({
  __esModule: true,
  default: mockNotifee,
}));

jest.mock("expo-notifications", () => mockNotifications);

jest.mock("react-native", () => ({
  AppRegistry: {
    registerHeadlessTask: mockRegisterHeadlessTask,
  },
}));

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  ALARM_KIND_OVERDUE_SEED: "overdue_seed",
  bootstrapDeadlineAlarmChannel: jest.fn().mockResolvedValue(undefined),
  DEADLINE_NOTIF_TYPE: "deadline_alarm",
  resolveNotificationAlarmKind: jest.fn((payload = {}) => {
    if (typeof payload?.alarmKind === "string" && payload.alarmKind) {
      return payload.alarmKind;
    }
    return "due_alarm";
  }),
  scheduleNextOverdueAlarm: mockScheduleNextOverdueAlarm,
}));

jest.mock("../../utils/deadlineConstants", () => ({
  OVERDUE_CHAIN: [
    { key: "due", delayMs: 0 },
    { key: "+15m", delayMs: 15 * 60 * 1000 },
    { key: "daily", delayMs: null },
  ],
}));

jest.mock("../../utils/taskOverdueState", () => ({
  advanceCheckpoint: mockAdvanceCheckpoint,
  compareOverdueStageOrder: mockCompareOverdueStageOrder,
  getCheckpoint: mockGetCheckpoint,
  setCheckpoint: mockSetCheckpoint,
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

describe("tasks/AlarmMissedTask", () => {
  const loadTask = () => {
    jest.resetModules();
    require("../../tasks/AlarmMissedTask.js");
    const taskFactory = mockRegisterHeadlessTask.mock.calls[0]?.[1];
    return taskFactory?.();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCheckpoint.mockResolvedValue(null);
  });

  it("registers the missed-alarm headless task", () => {
    loadTask();
    expect(mockRegisterHeadlessTask).toHaveBeenCalledWith(
      "AlarmMissedTask",
      expect.any(Function)
    );
  });

  it("treats an overdue timeout as missed and schedules the next checkpoint", async () => {
    const taskHandler = loadTask();
    const dueAtMs = Date.now() - 10 * 60 * 1000;
    const alarmId = "deadline-overdue:task-1:due";

    await taskHandler({
      alarmId,
      title: "Overdue task",
      payloadJson: JSON.stringify({
        notificationType: "deadline_alarm",
        taskId: "task-1",
        taskTitle: "Submit practicum log",
        subject: "Internship",
        taskType: "project",
        taskPriority: "high",
        dueAtMs,
        stage: "due",
        alarmKind: "overdue_alarm",
      }),
    });

    expect(
      mockNotifications.cancelScheduledNotificationAsync
    ).toHaveBeenCalledWith(alarmId);
    expect(mockNotifee.cancelNotification).toHaveBeenCalledWith(alarmId);
    expect(mockNotifee.cancelNotification).toHaveBeenCalledWith(
      `${alarmId}-display`
    );
    expect(mockAdvanceCheckpoint).toHaveBeenCalledWith("task-1", "due", dueAtMs);
    expect(mockScheduleNextOverdueAlarm).toHaveBeenCalledWith({
      task: expect.objectContaining({
        id: "task-1",
        title: "Submit practicum log",
        subject: "Internship",
        dueAt: new Date(dueAtMs).toISOString(),
      }),
      checkpoint: {
        key: "+15m",
        delayMs: 15 * 60 * 1000,
      },
      triggerAt: null,
      intendedTriggerAtMs: null,
      deliveryPathHint: "missed_alarm_recovery",
    });
  });

  it("uses the overdue seed to schedule the real +15m checkpoint when the checkpoint is still due", async () => {
    const taskHandler = loadTask();
    const dueAtMs = Date.now() - 2 * 60 * 1000;
    const alarmId = "deadline-followup:task-1:+15m";

    mockGetCheckpoint.mockResolvedValue({ key: "due", triggerAtMs: dueAtMs });

    await taskHandler({
      alarmId,
      title: "Overdue follow-up",
      payloadJson: JSON.stringify({
        notificationType: "deadline_alarm",
        taskId: "task-1",
        taskTitle: "Submit practicum log",
        subject: "Internship",
        taskType: "project",
        taskPriority: "high",
        dueAtMs,
        stage: "due",
        alarmKind: "overdue_seed",
        seedTargetStage: "+15m",
      }),
    });

    expect(mockAdvanceCheckpoint).not.toHaveBeenCalled();
    expect(mockSetCheckpoint).toHaveBeenCalledWith(
      "task-1",
      "+15m",
      dueAtMs + 15 * 60 * 1000
    );
    expect(mockScheduleNextOverdueAlarm).toHaveBeenCalledWith({
      task: expect.objectContaining({
        id: "task-1",
        title: "Submit practicum log",
        subject: "Internship",
        dueAt: new Date(dueAtMs).toISOString(),
      }),
      checkpoint: {
        key: "+15m",
        delayMs: 15 * 60 * 1000,
      },
      triggerAt: dueAtMs + 15 * 60 * 1000,
      intendedTriggerAtMs: dueAtMs + 15 * 60 * 1000,
      deliveryPathHint: "seed_recovery",
    });
  });

  it("ignores the overdue seed when the checkpoint already advanced beyond due", async () => {
    const taskHandler = loadTask();
    const dueAtMs = Date.now() - 2 * 60 * 1000;

    mockGetCheckpoint.mockResolvedValue({ key: "+15m" });

    await taskHandler({
      alarmId: "deadline-followup:task-1:+15m",
      title: "Overdue follow-up",
      payloadJson: JSON.stringify({
        notificationType: "deadline_alarm",
        taskId: "task-1",
        taskTitle: "Submit practicum log",
        dueAtMs,
        stage: "due",
        alarmKind: "overdue_seed",
        seedTargetStage: "+15m",
      }),
    });

    expect(mockSetCheckpoint).not.toHaveBeenCalled();
    expect(mockScheduleNextOverdueAlarm).not.toHaveBeenCalled();
  });
});
