const mockGetPendingAlarmAction = jest.fn();
const mockClearPendingAlarmAction = jest.fn().mockResolvedValue(true);

jest.mock("../../utils/nativeAlarm", () => ({
  getPendingAlarmAction: mockGetPendingAlarmAction,
  clearPendingAlarmAction: mockClearPendingAlarmAction,
}));

jest.mock("../../utils/deadlineAlarmStage", () => ({
  isDeadlineAlarmModalEligible: jest.fn(() => true),
  resolveDeadlineAlarmStage: jest.fn((payload) => payload?.stage ?? null),
}));

const {
  consumePendingAlarmAction,
} = require("../../utils/pendingAlarmAction");

describe("consumePendingAlarmAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("drops direct not-done actions so the modal does not reopen", async () => {
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "notdone",
      alarmId: "task-1",
      timestamp: Date.now(),
      payloadJson: JSON.stringify({
        taskId: "task-1",
        stage: "due",
        dueAtMs: Date.now(),
      }),
    });

    await expect(consumePendingAlarmAction()).resolves.toBeNull();
    expect(mockClearPendingAlarmAction).toHaveBeenCalled();
  });

  it("keeps mark-done actions so the silent confirm modal can open", async () => {
    const dueAtMs = Date.now();
    mockGetPendingAlarmAction.mockResolvedValue({
      action: "markdone",
      alarmId: "alarm-1",
      timestamp: Date.now(),
      payloadJson: JSON.stringify({
        taskId: "task-1",
        stage: "due",
        dueAtMs,
      }),
    });

    await expect(consumePendingAlarmAction()).resolves.toEqual({
      focusTaskId: "task-1",
      showAlarm: "1",
      pendingAction: "markdone",
      nativeHandoff: "1",
      dueAtMs: String(dueAtMs),
      alarmStage: "due",
    });
  });
});
