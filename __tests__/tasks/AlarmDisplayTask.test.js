const mockBackgroundHandlers = [];
const mockNotifee = {
  onBackgroundEvent: jest.fn((handler) => {
    mockBackgroundHandlers.push(handler);
  }),
  cancelNotification: jest.fn(),
  EventType: {
    ACTION_PRESS: "ACTION_PRESS",
    DISMISSED: "DISMISSED",
  },
};
const mockRegisterHeadlessTask = jest.fn();

jest.mock("@notifee/react-native", () => ({
  __esModule: true,
  default: mockNotifee,
}));

jest.mock("react-native", () => ({
  AppRegistry: {
    registerHeadlessTask: mockRegisterHeadlessTask,
  },
  NativeModules: {},
  TurboModuleRegistry: null,
  Platform: { OS: "android" },
}));

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  DEADLINE_NOTIF_TYPE: "deadline_alarm",
  displayAlarmNotification: jest.fn(),
}));

jest.mock("../../utils/notificationIds", () => ({
  buildNotificationId: jest.fn((prefix, taskId, stage) =>
    `${prefix}:${taskId}:${stage}`
  ),
}));

describe("tasks/AlarmDisplayTask background events", () => {
  const loadModule = () => {
    jest.resetModules();
    mockBackgroundHandlers.length = 0;
    require("../../tasks/AlarmDisplayTask.js");
    return mockBackgroundHandlers[0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBackgroundHandlers.length = 0;
  });

  it("registers the headless task", () => {
    loadModule();
    expect(mockRegisterHeadlessTask).toHaveBeenCalledWith("AlarmDisplayTask", expect.any(Function));
  });

  it("cancels deadline notifications on action press", async () => {
    const backgroundHandler = loadModule();

    await backgroundHandler({
      type: mockNotifee.EventType.ACTION_PRESS,
      detail: {
        notification: {
          id: "deadline-1",
          data: { type: "deadline_alarm", taskId: "task-1" },
        },
      },
    });

    expect(mockNotifee.cancelNotification).toHaveBeenCalledWith("deadline-1");
  });

  it("ignores dismissed events for ongoing deadline alarms", async () => {
    const backgroundHandler = loadModule();

    await backgroundHandler({
      type: mockNotifee.EventType.DISMISSED,
      detail: {
        notification: {
          id: "deadline-1",
          data: { type: "deadline_alarm", taskId: "task-1" },
        },
      },
    });

    expect(mockNotifee.cancelNotification).not.toHaveBeenCalled();
  });
});