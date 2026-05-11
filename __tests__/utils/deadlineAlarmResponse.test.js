const mockPlatform = { OS: "android" };
const mockNotifications = {
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("scheduled-id"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
};
const mockNotifee = {
  createChannel: jest.fn().mockResolvedValue("deadline-channel"),
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  AndroidColor: { RED: "red" },
};
const mockNativeAlarm = {
  cancelNativeAlarmByScheduledId: jest.fn(),
  ensureNativeAlarmPermissions: jest.fn().mockResolvedValue({
    exactAlarm: { status: "success", value: true },
    fullScreenIntent: { status: "success", value: true },
  }),
  forceStopNativeAlarm: jest.fn().mockResolvedValue(true),
  isNativeAlarmScheduledId: jest.fn(() => true),
  isNativeAlarmSupported: true,
  scheduleNativeAlarm: jest.fn().mockResolvedValue("native-overdue"),
  stopActiveNativeAlarm: jest.fn().mockResolvedValue(true),
  toNativeAlarmScheduledId: jest.fn((id) => id),
};
const mockAdvanceCheckpoint = jest.fn().mockResolvedValue({
  key: "+15m",
  delayMs: 15 * 60 * 1000,
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
  resolveTaskDueDate: jest.fn(() => new Date(Date.now() + 60 * 60 * 1000)),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/nativeAlarm", () => mockNativeAlarm);

jest.mock("../../utils/notificationIds", () => ({
  buildManagedNotificationData: jest.fn((id, data) => ({ id, ...data })),
  buildNotificationId: jest.fn((prefix, taskId, stage) =>
    `${prefix}:${taskId}:${stage}`
  ),
}));

jest.mock("../../utils/taskFilters", () => ({
  isPlannerTask: jest.fn(() => false),
}));

jest.mock("../../utils/taskOverdueState", () => ({
  advanceCheckpoint: mockAdvanceCheckpoint,
  getCheckpoint: jest.fn(),
  resolveCurrentOverdueStageInfo: jest.fn((dueAtMs) => ({
    key: "due",
    triggerAtMs: dueAtMs,
  })),
  resolveIntendedTriggerAt: jest.fn((stageKey, dueAtMs) =>
    stageKey === "+15m" ? dueAtMs + 15 * 60 * 1000 : dueAtMs
  ),
  setCheckpoint: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/deadlineConstants", () => ({
  OVERDUE_CHAIN: [
    { key: "due", delayMs: 0 },
    { key: "+15m", delayMs: 15 * 60 * 1000 },
    { key: "daily", delayMs: null },
  ],
}));

const {
  ACTION_NOT_DONE,
  handleDeadlineAlarmResponse,
} = require("../../utils/deadlineAlarmBackground");

describe("handleDeadlineAlarmResponse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("advances the overdue chain directly for not-done actions without reopening modal state", async () => {
    const dueAtMs = Date.now() - 2 * 60 * 1000;

    await handleDeadlineAlarmResponse({
      actionIdentifier: ACTION_NOT_DONE,
      notification: {
        request: {
          identifier: "deadline-due:task-1:due",
          content: {
            data: {
              notificationType: "deadline_alarm",
              taskId: "task-1",
              taskTitle: "Submit report",
              subjectLabel: "Research",
              taskType: "project",
              taskPriority: "high",
              dueAtMs,
              stage: "due",
            },
          },
        },
      },
    });

    expect(mockNativeAlarm.stopActiveNativeAlarm).toHaveBeenCalled();
    expect(mockNotifications.dismissNotificationAsync).toHaveBeenCalledWith(
      "deadline-due:task-1:due"
    );
    expect(mockNotifee.cancelNotification).toHaveBeenCalledWith(
      "deadline-due:task-1:due"
    );
    expect(mockAdvanceCheckpoint).toHaveBeenCalledWith(
      "task-1",
      "due",
      dueAtMs
    );
    expect(mockNativeAlarm.scheduleNativeAlarm).toHaveBeenCalledWith(
      expect.objectContaining({
        alarmId: "deadline-overdue:task-1:+15m",
      })
    );
  });
});
