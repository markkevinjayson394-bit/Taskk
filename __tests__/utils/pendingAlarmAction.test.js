const mockGetPendingAlarmAction = jest.fn();
const mockClearPendingAlarmAction = jest.fn().mockResolvedValue(true);
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
  logStartupHandoffSkipped: mockLogStartupHandoffSkipped,
}));

const {
  consumePendingAlarmAction,
} = require("../../utils/pendingAlarmAction");

describe("consumePendingAlarmAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps direct not-done actions so TaskManagerScreen can run the fallback chain advance", async () => {
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

    await expect(consumePendingAlarmAction()).resolves.toEqual({
      focusTaskId: "task-1",
      showAlarm: "1",
      alarmAction: "notdone",
      family: "deadline",
      nativeHandoff: "1",
      dueAtMs: String(dueAtMs),
      alarmStage: "due",
      displayStage: "due",
      recoveryReason: "missed",
      sourceId: "task-1",
    });
    expect(mockClearPendingAlarmAction).toHaveBeenCalled();
  });

  it("normalizes legacy open actions so the modal opens without a preselected done state", async () => {
    const dueAtMs = Date.now();
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "markdone",
      alarmId: "alarm-1",
      timestamp: Date.now(),
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

  it("clears and skips stale handoffs instead of reopening the modal", async () => {
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "open",
      alarmId: "alarm-stale-1",
      timestamp: Date.now() - 26 * 60 * 1000,
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
