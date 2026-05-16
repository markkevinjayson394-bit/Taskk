const mockPlatform = { OS: "android" };
const mockAsyncStorage = {
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
};
const mockGetDocs = jest.fn();
const mockResolveCurrentOverdueStageInfo = jest.fn();
const mockScheduleNativeAlarm = jest.fn().mockResolvedValue("native-alarm:auto");
const mockCancelNativeAlarmByAlarmId = jest.fn().mockResolvedValue(true);

jest.mock("react-native", () => ({
  Platform: mockPlatform,
}));

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  getDocs: (...args) => mockGetDocs(...args),
  limit: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

jest.mock("../../config/firebase", () => ({
  db: {},
}));

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  DEADLINE_NOTIF_TYPE: "deadline_alarm",
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/nativeAlarm", () => ({
  cancelNativeAlarmByAlarmId: (...args) =>
    mockCancelNativeAlarmByAlarmId(...args),
  canScheduleExactAlarms: jest
    .fn()
    .mockResolvedValue({ status: "success", value: true }),
  isNativeAlarmSupported: true,
  scheduleNativeAlarm: (...args) => mockScheduleNativeAlarm(...args),
}));

jest.mock("../../utils/notificationIds", () => ({
  buildManagedNotificationData: jest.fn((id, data) => ({ id, ...data })),
  buildNotificationId: jest.fn((prefix, taskId, stage) =>
    `${prefix}:${taskId}:${stage}`
  ),
}));

jest.mock("../../utils/taskOverdueState", () => ({
  resolveCurrentOverdueStageInfo: (...args) =>
    mockResolveCurrentOverdueStageInfo(...args),
}));

jest.mock("../../utils/offlineTaskQueue", () => ({
  buildOfflineTaskFromQueueItem: jest.fn(),
  readOfflineCreateQueue: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../utils/taskFilters", () => ({
  isPlannerTask: jest.fn(() => false),
}));

const { checkAndAutoLaunchOverdueAlarm } = require("../../utils/overdueAutoLaunch");

function buildRemoteTask(dueAt) {
  return {
    id: "task-1",
    data: () => ({
      userId: "user-1",
      title: "Essay",
      subject: "English",
      completed: false,
      dueAt,
    }),
  };
}

describe("overdueAutoLaunch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = "android";
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockScheduleNativeAlarm.mockResolvedValue("native-alarm:auto");
    mockCancelNativeAlarmByAlarmId.mockResolvedValue(true);
  });

  it("skips app-open catchup for tasks that are only at the due stage", async () => {
    mockResolveCurrentOverdueStageInfo.mockReturnValue({
      key: "due",
      triggerAtMs: Date.now() - 60 * 1000,
    });
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [buildRemoteTask(new Date(Date.now() - 2 * 60 * 1000))],
    });

    await checkAndAutoLaunchOverdueAlarm("user-1");

    expect(mockScheduleNativeAlarm).not.toHaveBeenCalled();
  });

  it("uses app-open catchup only for true overdue recovery stages", async () => {
    const dueAt = new Date(Date.now() - 20 * 60 * 1000);
    mockResolveCurrentOverdueStageInfo.mockReturnValue({
      key: "+15m",
      triggerAtMs: dueAt.getTime() + 15 * 60 * 1000,
    });
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [buildRemoteTask(dueAt)],
    });

    await checkAndAutoLaunchOverdueAlarm("user-1");

    expect(mockCancelNativeAlarmByAlarmId).toHaveBeenCalledWith(
      "auto-overdue:task-1:open"
    );
    expect(mockScheduleNativeAlarm).toHaveBeenCalledWith(
      expect.objectContaining({
        alarmId: "auto-overdue:task-1:open",
        payload: expect.objectContaining({
          deliveryPath: "app_open_catchup",
          stage: "+15m",
        }),
      })
    );
    expect(mockAsyncStorage.setItem).toHaveBeenCalled();
  });
});
