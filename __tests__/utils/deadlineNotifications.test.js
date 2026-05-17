const mockCancelNativeAlarmByScheduledId = jest.fn().mockResolvedValue(true);
const mockNotifications = {
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
};
const mockNotifee = {
  cancelNotification: jest.fn().mockResolvedValue(undefined),
};

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

jest.mock("expo-notifications", () => mockNotifications);

jest.mock("@notifee/react-native", () => ({
  __esModule: true,
  default: mockNotifee,
}));

jest.mock("../../utils/nativeAlarm", () => ({
  cancelNativeAlarmByScheduledId: (...args) =>
    mockCancelNativeAlarmByScheduledId(...args),
  toNativeAlarmScheduledId: jest.fn((id) => id),
}));

jest.mock("../../utils/deadlineConstants", () => ({
  FOREGROUND_THRESHOLDS: [
    { key: "30m" },
    { key: "due" },
  ],
  OVERDUE_CHAIN: [
    { key: "due" },
    { key: "+15m" },
  ],
}));

jest.mock("../../utils/notificationIds", () => ({
  buildDeadlineNotificationId: jest.fn(
    (taskId, stage) => `deadline-overdue:${taskId}:${stage}`
  ),
  buildNotificationId: jest.fn(
    (prefix, taskId, stage) => `${prefix}:${taskId}:${stage}`
  ),
}));

describe("deadlineNotifications cleanup dedupe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reuses an in-flight presentation dismissal within the dedupe window", async () => {
    const {
      dismissDeadlinePresentations,
    } = require("../../utils/deadlineNotifications");

    const first = dismissDeadlinePresentations("task-1", {
      thresholdKey: "due",
    });
    const second = dismissDeadlinePresentations("task-1", {
      thresholdKey: "due",
    });

    const [firstIds, secondIds] = await Promise.all([first, second]);
    const cancelledIds = mockNotifee.cancelNotification.mock.calls.map(
      ([id]) => id
    );

    expect(firstIds).toEqual(secondIds);
    expect(cancelledIds).toEqual([
      "deadline-due:task-1:due",
      "deadline-due:task-1:due-display",
      "deadline-overdue:task-1:due",
      "deadline-overdue:task-1:due-display",
      "deadline-overdue:task-1:+15m",
      "deadline-overdue:task-1:+15m-display",
    ]);
    expect(mockNotifications.dismissNotificationAsync).toHaveBeenCalledTimes(
      cancelledIds.length
    );
  });
});
