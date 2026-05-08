const mockPlatform = { OS: "android" };
const mockNotifications = {
  setNotificationCategoryAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
};
const mockNotifee = {
  createChannel: jest.fn(),
  cancelNotification: jest.fn(),
  displayNotification: jest.fn(),
  AndroidColor: { RED: "red" },
};

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
  normalizeTaskDateInput: jest.fn(),
  parseDueDate: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/nativeAlarm", () => ({
  cancelNativeAlarmByScheduledId: jest.fn(),
  isNativeAlarmSupported: false,
  scheduleNativeAlarm: jest.fn(),
  stopActiveNativeAlarm: jest.fn(),
  toNativeAlarmScheduledId: jest.fn((id) => id),
  writeAlarmAction: jest.fn(),
}));

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
  clearCheckpoint: jest.fn(),
  OVERDUE_CHAIN: [],
  setCheckpoint: jest.fn(),
}));

const {
  ACTION_MARK_DONE,
  ACTION_NOT_DONE,
  DEADLINE_CATEGORY_ID,
  bootstrapDeadlineAlarmChannel,
} = require("../../utils/deadlineAlarmBackground");

describe("bootstrapDeadlineAlarmChannel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = "android";
  });

  it("registers the deadline action category before bootstrapping channels", async () => {
    await bootstrapDeadlineAlarmChannel();

    expect(mockNotifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      DEADLINE_CATEGORY_ID,
      [
        {
          identifier: ACTION_MARK_DONE,
          buttonTitle: "Done",
          options: { opensAppToForeground: true },
        },
        {
          identifier: ACTION_NOT_DONE,
          buttonTitle: "Not Done",
          options: { opensAppToForeground: true },
        },
      ]
    );
    expect(mockNotifee.createChannel).toHaveBeenCalledTimes(2);
  });

  it("still registers the action category on ios without creating android channels", async () => {
    mockPlatform.OS = "ios";

    await bootstrapDeadlineAlarmChannel();

    expect(mockNotifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      DEADLINE_CATEGORY_ID,
      [
        {
          identifier: ACTION_MARK_DONE,
          buttonTitle: "Done",
          options: { opensAppToForeground: true },
        },
        {
          identifier: ACTION_NOT_DONE,
          buttonTitle: "Not Done",
          options: { opensAppToForeground: true },
        },
      ]
    );
    expect(mockNotifee.createChannel).not.toHaveBeenCalled();
  });
});