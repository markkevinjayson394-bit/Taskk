const mockGetPendingAlarmAction = jest.fn();
const mockClearPendingAlarmAction = jest.fn().mockResolvedValue(true);
const mockLogStartupHandoffAccepted = jest.fn().mockResolvedValue(undefined);
const mockLogStartupHandoffRead = jest.fn().mockResolvedValue(undefined);
const mockLogStartupHandoffSkipped = jest.fn().mockResolvedValue(undefined);

jest.mock("../../utils/nativeAlarm", () => ({
  getPendingAlarmAction: mockGetPendingAlarmAction,
  clearPendingAlarmAction: mockClearPendingAlarmAction,
}));

jest.mock("../../utils/deadlineAlarmStage", () => ({
  isDeadlineAlarmModalEligible: jest.fn(() => true),
  resolveDeadlineAlarmStage: jest.fn((payload) => payload?.stage ?? null),
}));

jest.mock("../../utils/alarmDiagnostics", () => ({
  logStartupHandoffAccepted: mockLogStartupHandoffAccepted,
  logStartupHandoffRead: mockLogStartupHandoffRead,
  logStartupHandoffSkipped: mockLogStartupHandoffSkipped,
}));

const {
  consumePendingAlarmAction,
} = require("../../utils/pendingAlarmAction");

describe("consumePendingAlarmAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("clears native not-done actions because the headless chain already handles them", async () => {
    const dueAtMs = Date.now();
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "notdone",
      alarmId: "task-1",
      timestamp: Date.now(),
      payloadJson: JSON.stringify({
        taskId: "task-1",
        stage: "due",
        displayStage: "due",
        recoveryReason: "missed",
        dueAtMs,
      }),
    });

    await expect(consumePendingAlarmAction()).resolves.toBeNull();
    expect(mockClearPendingAlarmAction).toHaveBeenCalled();
    expect(mockLogStartupHandoffSkipped).toHaveBeenCalledWith(
      "task-1",
      "notdone_already_handled",
      expect.objectContaining({
        sourceId: "task-1",
        action: "notdone",
      })
    );
  });

  it("normalizes legacy open actions so the modal opens without a preselected done state", async () => {
    const dueAtMs = Date.now();
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "markdone",
      alarmId: "alarm-1",
      timestamp: Date.now() - 26 * 60 * 1000,
      payloadJson: JSON.stringify({
        taskId: "task-1",
        stage: "due",
        displayStage: "due",
        recoveryReason: "missed",
        dueAtMs,
      }),
    });

    await expect(consumePendingAlarmAction()).resolves.toEqual({
      focusTaskId: "task-1",
      showAlarm: "1",
      alarmAction: "open",
      family: "deadline",
      nativeHandoff: "1",
      dueAtMs: String(dueAtMs),
      alarmStage: "due",
      displayStage: "due",
      recoveryReason: "missed",
      sourceId: "alarm-1",
    });
  });

  it("consumes deadline open handoffs older than 25 minutes but younger than 24 hours", async () => {
    const dueAtMs = Date.now();
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "open",
      alarmId: "alarm-recoverable-1",
      timestamp: Date.now() - 26 * 60 * 1000,
      payloadJson: JSON.stringify({
        taskId: "task-recoverable-1",
        stage: "due",
        dueAtMs,
      }),
    });

    await expect(consumePendingAlarmAction()).resolves.toEqual(
      expect.objectContaining({
        focusTaskId: "task-recoverable-1",
        alarmAction: "open",
        sourceId: "alarm-recoverable-1",
        dueAtMs: String(dueAtMs),
      })
    );
    expect(mockClearPendingAlarmAction).toHaveBeenCalled();
    expect(mockLogStartupHandoffAccepted).toHaveBeenCalledWith(
      "task-recoverable-1",
      expect.objectContaining({
        sourceId: "alarm-recoverable-1",
        action: "open",
      })
    );
  });

  it("clears and skips open handoffs older than 24 hours", async () => {
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "open",
      alarmId: "alarm-stale-1",
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
      payloadJson: JSON.stringify({
        taskId: "task-stale-1",
        stage: "due",
        dueAtMs: Date.now(),
      }),
    });

    await expect(consumePendingAlarmAction()).resolves.toBeNull();
    expect(mockClearPendingAlarmAction).toHaveBeenCalled();
    expect(mockLogStartupHandoffSkipped).toHaveBeenCalledWith(
      "task-stale-1",
      "expired",
      expect.objectContaining({
        sourceId: "alarm-stale-1",
      })
    );
  });
});
