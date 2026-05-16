const mockPlatform = { OS: "android" };
const mockNotifications = {
  setNotificationCategoryAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("scheduled-id"),
};
const mockNotifee = {
  createChannel: jest.fn(),
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  displayNotification: jest.fn().mockResolvedValue(undefined),
  AndroidColor: { RED: "red" },
};
const mockResolveTaskDueDate = jest.fn();
const mockNativeAlarm = {
  cancelNativeAlarmByScheduledId: jest.fn(),
  ensureNativeAlarmPermissions: jest.fn().mockResolvedValue({
    exactAlarm: { status: "success", value: true },
    fullScreenIntent: { status: "success", value: true },
  }),
  forceStopNativeAlarm: jest.fn(),
  isNativeAlarmScheduledId: jest.fn(
    (id) => typeof id === "string" && id.startsWith("native-alarm:")
  ),
  isNativeAlarmSupported: true,
  openExactAlarmSettings: jest.fn(),
  scheduleNativeAlarm: jest.fn(async ({ alarmId }) => `native-alarm:${alarmId}`),
  stopActiveNativeAlarm: jest.fn(),
  toNativeAlarmScheduledId: jest.fn((id) => id),
  writeAlarmAction: jest.fn(),
};
const mockResolveIntendedTriggerAt = jest.fn((stageKey, dueAtMs) => {
  if (stageKey === "+15m") return dueAtMs + 15 * 60 * 1000;
  return dueAtMs;
});

jest.mock("react-native", () => ({
  Platform: mockPlatform,
}));

jest.mock("expo-notifications", () => mockNotifications);

jest.mock("@notifee/react-native", () => ({
  __esModule: true,
  default: mockNotifee,
  AndroidCategory: { ALARM: "alarm" },
  AndroidImportance: { HIGH: "high", DEFAULT: "default" },
  AndroidVisibility: { PUBLIC: "public" },
}));

jest.mock("../../utils/academicTaskModel", () => ({
  resolveTaskDueDate: mockResolveTaskDueDate,
}));

jest.mock("../../utils/logger", () => ({
  logIfDev: jest.fn(),
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/nativeAlarm", () => mockNativeAlarm);

jest.mock("../../utils/notificationIds", () => ({
  buildDeadlineNotificationId: jest.fn((taskId, stage) =>
    `deadline-overdue:${taskId}:${stage}`
  ),
  buildManagedNotificationData: jest.fn((id, data) => ({ id, ...data })),
  buildNotificationId: jest.fn((prefix, taskId, stage) =>
    `${prefix}:${taskId}:${stage}`
  ),
}));

jest.mock("../../utils/taskFilters", () => ({
  isPlannerTask: jest.fn(() => false),
}));

jest.mock("../../utils/taskOverdueState", () => ({
  advanceCheckpoint: jest.fn(),
  getCheckpoint: jest.fn(),
  resolveCurrentOverdueStageInfo: jest.fn((dueAtMs) => ({
    key: "due",
    triggerAtMs: dueAtMs,
  })),
  resolveIntendedTriggerAt: mockResolveIntendedTriggerAt,
  setCheckpoint: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/deadlineConstants", () => ({
  FOREGROUND_THRESHOLDS: [
    { key: "1d", ms: 24 * 60 * 60 * 1000 },
    { key: "2h", ms: 2 * 60 * 60 * 1000 },
    { key: "30m", ms: 30 * 60 * 1000 },
    { key: "5m", ms: 5 * 60 * 1000 },
    { key: "due", ms: 0 },
  ],
  OVERDUE_CHAIN: [
    { key: "due", delayMs: 0 },
    { key: "+15m", delayMs: 15 * 60 * 1000 },
    { key: "daily", delayMs: null },
  ],
}));

const {
  DEADLINE_CATEGORY_ID,
  bootstrapDeadlineAlarmChannel,
  displayAlarmNotification,
  scheduleDeadlineAlarms,
  scheduleNextOverdueAlarm,
} = require("../../utils/deadlineAlarmBackground");

describe("deadlineAlarmBackground", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = "android";
    mockNativeAlarm.scheduleNativeAlarm.mockImplementation(
      async ({ alarmId }) => `native-alarm:${alarmId}`
    );
    mockResolveTaskDueDate.mockReturnValue(
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    );
  });

  it("registers the deadline action category before bootstrapping channels", async () => {
    await bootstrapDeadlineAlarmChannel();

    expect(mockNotifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      DEADLINE_CATEGORY_ID,
      [
        {
          identifier: "open_deadline_alarm",
          buttonTitle: "Open",
          options: { opensAppToForeground: true },
        },
        {
          identifier: "not_done_deadline_alarm",
          buttonTitle: "Not Done",
          options: { opensAppToForeground: false },
        },
      ]
    );
    expect(mockNotifee.createChannel).toHaveBeenCalledTimes(2);
    expect(mockNotifee.createChannel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        importance: "default",
        vibration: false,
        lights: false,
      })
    );
  });

  it("still registers the action category on ios without creating android channels", async () => {
    mockPlatform.OS = "ios";

    await bootstrapDeadlineAlarmChannel();

    expect(mockNotifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      DEADLINE_CATEGORY_ID,
      [
        {
          identifier: "open_deadline_alarm",
          buttonTitle: "Open",
          options: { opensAppToForeground: true },
        },
        {
          identifier: "not_done_deadline_alarm",
          buttonTitle: "Not Done",
          options: { opensAppToForeground: false },
        },
      ]
    );
    expect(mockNotifee.createChannel).not.toHaveBeenCalled();
  });

  it("schedules Android lead reminders natively and skips the overdue seed when the due path is native", async () => {
    const ids = await scheduleDeadlineAlarms({
      id: "task-1",
      title: "Essay",
      subject: "English",
    });

    const scheduledAlarmIds = mockNativeAlarm.scheduleNativeAlarm.mock.calls.map(
      ([payload]) => payload.alarmId
    );

    expect(scheduledAlarmIds).toEqual(
      expect.arrayContaining([
        "deadline-lead:task-1:1d",
        "deadline-lead:task-1:2h",
        "deadline-lead:task-1:30m",
        "deadline-lead:task-1:5m",
        "deadline-due:task-1:due",
      ])
    );
    expect(scheduledAlarmIds).not.toContain("deadline-followup:task-1:+15m");
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(ids).toEqual(
      expect.arrayContaining(["native-alarm:deadline-due:task-1:due"])
    );
  });

  it("keeps iOS lead reminders on expo scheduling", async () => {
    mockPlatform.OS = "ios";

    await scheduleDeadlineAlarms({
      id: "task-1",
      title: "Essay",
      subject: "English",
    });

    expect(mockNativeAlarm.scheduleNativeAlarm).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(5);
  });

  it("creates the +15m overdue seed when the due alarm falls back to expo", async () => {
    mockNativeAlarm.scheduleNativeAlarm.mockImplementation(async ({ alarmId }) => {
      if (alarmId === "deadline-due:task-1:due") return null;
      return `native-alarm:${alarmId}`;
    });

    const ids = await scheduleDeadlineAlarms({
      id: "task-1",
      title: "Essay",
      subject: "English",
    });

    const scheduledAlarmIds = mockNativeAlarm.scheduleNativeAlarm.mock.calls.map(
      ([payload]) => payload.alarmId
    );

    expect(scheduledAlarmIds).toContain("deadline-due:task-1:due");
    expect(scheduledAlarmIds).toContain("deadline-followup:task-1:+15m");
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(
      expect.arrayContaining([
        "scheduled-id",
        "native-alarm:deadline-followup:task-1:+15m",
      ])
    );
  });

  it("falls back to Expo scheduling for Android lead reminders when native scheduling fails", async () => {
    mockNativeAlarm.scheduleNativeAlarm.mockImplementation(async ({ alarmId }) => {
      if (alarmId === "deadline-lead:task-1:30m") return null;
      return `native-alarm:${alarmId}`;
    });

    await scheduleDeadlineAlarms({
      id: "task-1",
      title: "Essay",
      subject: "English",
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "deadline-lead:task-1:30m",
        content: expect.objectContaining({
          channelId: "ctu-deadline-lead-v2",
        }),
      })
    );
  });

  it("marks the due native path as no-fullscreen fallback when popup permission is missing", async () => {
    mockNativeAlarm.ensureNativeAlarmPermissions.mockResolvedValue({
      exactAlarm: { status: "success", value: true },
      fullScreenIntent: { status: "success", value: false },
    });

    await scheduleDeadlineAlarms({
      id: "task-1",
      title: "Essay",
      subject: "English",
    });

    const dueCall = mockNativeAlarm.scheduleNativeAlarm.mock.calls.find(
      ([payload]) => payload.alarmId === "deadline-due:task-1:due"
    );

    expect(dueCall?.[0]?.payload?.deliveryPath).toBe(
      "native_no_fullscreen_popup"
    );
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("uses a persistent notification without full-screen action for no-fullscreen delivery paths", async () => {
    await displayAlarmNotification({
      id: "deadline-due:task-1:due-display",
      title: "Task Due",
      body: "Body",
      data: {
        taskId: "task-1",
        taskTitle: "Essay",
        dueAtMs: Date.now(),
        deliveryPath: "native_no_fullscreen_popup",
      },
      isOngoing: true,
    });

    expect(mockNotifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "deadline-due:task-1:due-display",
        android: expect.objectContaining({
          ongoing: true,
          autoCancel: false,
        }),
      })
    );
    expect(
      mockNotifee.displayNotification.mock.calls[0][0].android.fullScreenAction
    ).toBeUndefined();
  });

  it("does not post an immediate duplicate notifee notification for overdue fallback scheduling", async () => {
    const dueAt = new Date(Date.now() - 60 * 60 * 1000);
    mockResolveTaskDueDate.mockReturnValue(dueAt);
    mockNativeAlarm.scheduleNativeAlarm.mockResolvedValue(null);

    await scheduleNextOverdueAlarm({
      task: {
        id: "task-2",
        title: "Quiz review",
        subject: "Physics",
        dueAt: dueAt.toISOString(),
      },
      checkpoint: {
        key: "+15m",
        delayMs: 15 * 60 * 1000,
      },
      triggerAt: Date.now() + 1000,
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sticky: true,
          autoDismiss: false,
          channelId: "ctu-deadline-alarms-v2",
        }),
      })
    );
    expect(mockNotifee.displayNotification).not.toHaveBeenCalled();
  });
});
