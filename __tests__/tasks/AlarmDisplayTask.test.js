const mockBackgroundHandlers = [];
const mockNotifee = {
  onBackgroundEvent: jest.fn((handler) => {
    mockBackgroundHandlers.push(handler);
  }),
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  EventType: {
    ACTION_PRESS: "ACTION_PRESS",
    DISMISSED: "DISMISSED",
  },
};
const mockRegisterHeadlessTask = jest.fn();
const mockWriteAlarmAction = jest.fn().mockResolvedValue(true);
const mockCancelNativeAlarmByAlarmId = jest.fn().mockResolvedValue(true);
const mockStopActiveNativeAlarm = jest.fn().mockResolvedValue(true);
const mockForceStopNativeAlarm = jest.fn().mockResolvedValue({
  status: "success",
  value: true,
});
const mockAdvanceCheckpoint = jest.fn().mockResolvedValue({
  key: "+15m",
  delayMs: 15 * 60 * 1000,
});
const mockDisplayAlarmNotification = jest.fn().mockResolvedValue(undefined);
const mockDisplayLeadNotification = jest.fn().mockResolvedValue(undefined);
const mockScheduleNextOverdueAlarm = jest
  .fn()
  .mockResolvedValue("next-overdue-id");
const mockBootstrapDeadlineAlarmChannel = jest
  .fn()
  .mockResolvedValue(undefined);
const mockResolveNotificationAlarmKind = jest.fn((data = {}) => {
  if (typeof data?.alarmKind === "string" && data.alarmKind) {
    return data.alarmKind;
  }
  if (data?.isLeadTime === true) return "lead_notice";
  if (data?.isOverdueAlarm === true) return "overdue_alarm";
  return "due_alarm";
});

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
  ALARM_KIND_LEAD_NOTICE: "lead_notice",
  ACTION_MARK_DONE: "mark_done_deadline_alarm",
  ACTION_NOT_DONE: "not_done_deadline_alarm",
  DEADLINE_NOTIF_TYPE: "deadline_alarm",
  bootstrapDeadlineAlarmChannel: mockBootstrapDeadlineAlarmChannel,
  displayAlarmNotification: mockDisplayAlarmNotification,
  displayLeadNotification: mockDisplayLeadNotification,
  resolveNotificationAlarmKind: mockResolveNotificationAlarmKind,
  scheduleNextOverdueAlarm: mockScheduleNextOverdueAlarm,
}));

jest.mock("../../utils/deadlineConstants", () => ({
  OVERDUE_CHAIN: [
    { key: "due", delayMs: 0 },
    { key: "+15m", delayMs: 15 * 60 * 1000 },
    { key: "daily", delayMs: null },
  ],
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/nativeAlarm", () => ({
  cancelNativeAlarmByAlarmId: mockCancelNativeAlarmByAlarmId,
  forceStopNativeAlarm: mockForceStopNativeAlarm,
  stopActiveNativeAlarm: mockStopActiveNativeAlarm,
  writeAlarmAction: mockWriteAlarmAction,
}));

jest.mock("../../utils/taskOverdueState", () => ({
  advanceCheckpoint: mockAdvanceCheckpoint,
}));

describe("tasks/AlarmDisplayTask background events", () => {
  const loadModule = () => {
    jest.resetModules();
    mockBackgroundHandlers.length = 0;
    require("../../tasks/AlarmDisplayTask.js");
    const registrationCall =
      mockRegisterHeadlessTask.mock.calls[
        mockRegisterHeadlessTask.mock.calls.length - 1
      ];
    const headlessFactory = registrationCall?.[1];
    return {
      backgroundHandler: mockBackgroundHandlers[0],
      headlessTask:
        typeof headlessFactory === "function" ? headlessFactory() : null,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBackgroundHandlers.length = 0;
  });

  it("registers the headless task", () => {
    loadModule();
    expect(mockRegisterHeadlessTask).toHaveBeenCalledWith(
      "AlarmDisplayTask",
      expect.any(Function)
    );
  });

  it("displays a deadline alarm from the headless task payload", async () => {
    const { headlessTask } = loadModule();

    await headlessTask({
      alarmId: "deadline-native-1",
      title: "Deadline Due Test",
      body: "Test Task is due now.",
      payloadJson: JSON.stringify({
        type: "deadline_alarm",
        notificationType: "deadline_alarm",
        alarmKind: "due_alarm",
        taskId: "task-1",
        taskTitle: "Test Task",
        subjectLabel: "General",
        dueAtMs: Date.now(),
        stage: "due",
        acknowledgeRequired: true,
        isLeadTime: false,
      }),
    });

    expect(mockBootstrapDeadlineAlarmChannel).toHaveBeenCalled();
    expect(mockDisplayAlarmNotification).toHaveBeenCalledWith({
      id: "deadline-native-1-display",
      title: "Deadline Due Test",
      body: "Test Task is due now.",
      data: expect.objectContaining({
        alarmId: "deadline-native-1",
        notificationId: "deadline-native-1",
        taskId: "task-1",
        stage: "due",
      }),
      isOngoing: true,
    });
    expect(mockDisplayLeadNotification).not.toHaveBeenCalled();
  });

  it("displays a lead notice as a normal notification", async () => {
    const { headlessTask } = loadModule();

    await headlessTask({
      alarmId: "deadline-lead:task-1:30m",
      title: "Due in 30 min",
      body: "Review chapter outline.",
      payloadJson: JSON.stringify({
        type: "deadline_alarm",
        notificationType: "deadline_alarm",
        alarmKind: "lead_notice",
        taskId: "task-1",
        taskTitle: "Review chapter outline",
        subjectLabel: "English",
        dueAtMs: Date.now() + 30 * 60 * 1000,
        stage: "30m",
        acknowledgeRequired: false,
        isLeadTime: true,
      }),
    });

    expect(mockDisplayLeadNotification).toHaveBeenCalledWith({
      id: "deadline-lead:task-1:30m",
      title: "Due in 30 min",
      body: "Review chapter outline.",
      data: expect.objectContaining({
        alarmId: "deadline-lead:task-1:30m",
        notificationId: "deadline-lead:task-1:30m",
        taskId: "task-1",
        alarmKind: "lead_notice",
      }),
    });
    expect(mockDisplayAlarmNotification).not.toHaveBeenCalled();
  });

  it("keeps the native alarm active on default handoff presses", async () => {
    const { backgroundHandler } = loadModule();

    await backgroundHandler({
      type: mockNotifee.EventType.ACTION_PRESS,
      detail: {
        notification: {
          id: "deadline-1",
          data: {
            type: "deadline_alarm",
            notificationType: "deadline_alarm",
            alarmKind: "due_alarm",
            taskId: "task-1",
          },
        },
      },
    });

    expect(mockNotifee.cancelNotification).not.toHaveBeenCalled();
    expect(mockStopActiveNativeAlarm).not.toHaveBeenCalled();
    expect(mockWriteAlarmAction).toHaveBeenCalledWith(
      "default",
      "deadline-1",
      expect.any(String)
    );
  });

  it("writes the done action without scheduling another checkpoint", async () => {
    const { backgroundHandler } = loadModule();

    await backgroundHandler({
      type: mockNotifee.EventType.ACTION_PRESS,
      detail: {
        pressAction: { id: "mark_done_deadline_alarm" },
        notification: {
          id: "deadline-1",
          data: {
            type: "deadline_alarm",
            notificationType: "deadline_alarm",
            alarmKind: "due_alarm",
            taskId: "task-1",
            dueAtMs: String(Date.now()),
          },
        },
      },
    });

    expect(mockWriteAlarmAction).toHaveBeenCalledWith(
      "markdone",
      "deadline-1",
      expect.any(String)
    );
    expect(mockCancelNativeAlarmByAlarmId).toHaveBeenCalledWith("deadline-1");
    expect(mockNotifee.cancelNotification).not.toHaveBeenCalled();
    expect(mockStopActiveNativeAlarm).not.toHaveBeenCalled();
    expect(mockAdvanceCheckpoint).not.toHaveBeenCalled();
    expect(mockScheduleNextOverdueAlarm).not.toHaveBeenCalled();
  });

  it("advances the overdue chain for not-done actions", async () => {
    const { backgroundHandler } = loadModule();
    const dueAtMs = Date.now();

    await backgroundHandler({
      type: mockNotifee.EventType.ACTION_PRESS,
      detail: {
        pressAction: { id: "not_done_deadline_alarm" },
        notification: {
          id: "deadline-1",
          data: {
            type: "deadline_alarm",
            notificationType: "deadline_alarm",
            alarmKind: "due_alarm",
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
    });

    expect(mockWriteAlarmAction).not.toHaveBeenCalled();
    expect(mockBootstrapDeadlineAlarmChannel).toHaveBeenCalled();
    expect(mockCancelNativeAlarmByAlarmId).toHaveBeenCalledWith("deadline-1");
    expect(mockAdvanceCheckpoint).toHaveBeenCalledWith(
      "task-1",
      "due",
      dueAtMs
    );
    expect(mockScheduleNextOverdueAlarm).toHaveBeenCalledWith({
      task: expect.objectContaining({
        id: "task-1",
        title: "Submit report",
        subject: "Research",
        dueAt: new Date(dueAtMs).toISOString(),
      }),
      checkpoint: {
        key: "+15m",
        delayMs: 15 * 60 * 1000,
      },
      triggerAt: dueAtMs + 15 * 60 * 1000,
    });
  });

  it("stores a default handoff on body press so the alarm can reopen in-app", async () => {
    const { backgroundHandler } = loadModule();
    const dueAtMs = Date.now();

    await backgroundHandler({
      type: mockNotifee.EventType.ACTION_PRESS,
      detail: {
        notification: {
          id: "deadline-urgent-open",
          data: {
            type: "deadline_alarm",
            notificationType: "deadline_alarm",
            alarmKind: "due_alarm",
            taskId: "task-open-1",
            taskTitle: "Submit report",
            subjectLabel: "Research",
            dueAtMs,
            stage: "due",
          },
        },
      },
    });

    expect(mockNotifee.cancelNotification).not.toHaveBeenCalled();
    expect(mockStopActiveNativeAlarm).not.toHaveBeenCalled();
    expect(mockCancelNativeAlarmByAlarmId).not.toHaveBeenCalled();
    expect(mockWriteAlarmAction).toHaveBeenCalledWith(
      "default",
      "deadline-urgent-open",
      expect.any(String)
    );
    expect(mockAdvanceCheckpoint).not.toHaveBeenCalled();
    expect(mockScheduleNextOverdueAlarm).not.toHaveBeenCalled();
  });

  it("ignores dismissed events for ongoing deadline alarms", async () => {
    const { backgroundHandler } = loadModule();

    await backgroundHandler({
      type: mockNotifee.EventType.DISMISSED,
      detail: {
        notification: {
          id: "deadline-dismissed",
          data: {
            type: "deadline_alarm",
            notificationType: "deadline_alarm",
            alarmKind: "due_alarm",
            taskId: "task-1",
          },
        },
      },
    });

    expect(mockWriteAlarmAction).not.toHaveBeenCalled();
    expect(mockAdvanceCheckpoint).not.toHaveBeenCalled();
  });
});
