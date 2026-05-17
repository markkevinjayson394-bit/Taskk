import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { AppState, Modal, Platform, Text, TouchableOpacity } from "react-native";
import DeadlineAlarmModal, {
  useDeadlineAlarmScheduler,
} from "../../components/DeadlineAlarmModal";
import { render } from "../../utils/test-utils";

const ORIGINAL_PLATFORM_OS = Platform.OS;
const ORIGINAL_APP_STATE = AppState.currentState;

// â”€â”€â”€ Mock all dependencies that DeadlineAlarmModal imports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
jest.mock("../../components/DeadlineAlarmModal.helpers", () => ({
  parseDueDate: (val) => (val ? new Date(val) : null),
  resolveTaskDueDate: jest.fn((task) =>
    task?.dueAt ? new Date(task.dueAt) : null
  ),
  formatDeadlineCountdown: jest.fn(() => "5m"),
  stopAlarmSound: jest.fn().mockResolvedValue(undefined),
  stopVibration: jest.fn(),
  playAlarmSound: jest.fn(),
  startVibration: jest.fn(),
  PRIORITY_COLOR: {},
  TYPE_META: {
    custom: { icon: "ellipse", label: "Task" },
  },
}));

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  cancelDeadlineAlarms: jest.fn().mockResolvedValue(undefined),
  DEADLINE_CATEGORY_ID: "deadline",
  DEADLINE_CHANNEL_ID: "deadline-channel",
  DEADLINE_NOTIF_TYPE: "deadline_alarm",
  displayAlarmNotification: jest.fn().mockResolvedValue(undefined),
  displayLeadNotification: jest.fn().mockResolvedValue(undefined),
  scheduleNextOverdueAlarm: jest.fn().mockResolvedValue("native-alarm-1"),
}));

jest.mock("../../utils/nativeAlarm", () => ({
  stopActiveNativeAlarm: jest.fn().mockResolvedValue(undefined),
  forceStopNativeAlarm: jest.fn().mockResolvedValue(undefined),
  isNativeAlarmSupported: false,
  scheduleNativeAlarm: jest.fn().mockResolvedValue(null),
}));

jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Warning: "warning", Success: "success" },
}));

jest.mock("../../utils/deadlineConstants", () => ({
  THRESHOLDS: [
    { key: "1d", ms: 24 * 60 * 60 * 1000 },
    { key: "2h", ms: 2 * 60 * 60 * 1000 },
    { key: "30m", ms: 30 * 60 * 1000 },
    { key: "due", ms: 0 },
  ],
  FOREGROUND_THRESHOLDS: [
    { key: "1d", ms: 24 * 60 * 60 * 1000, window: 5 * 60 * 1000 },
    { key: "2h", ms: 2 * 60 * 60 * 1000, window: 3 * 60 * 1000 },
    { key: "30m", ms: 30 * 60 * 1000, window: 2 * 60 * 1000 },
    { key: "1m", ms: 60 * 1000, window: 90 * 1000 },
    { key: "due", ms: 0, window: 10 * 60 * 1000 },
  ],
  OVERDUE_CHAIN: [
    { key: "due", stage: "due", delayMs: 0 },
    { key: "+15m", stage: "+15m", delayMs: 15 * 60 * 1000 },
    { key: "+1h", stage: "+1h", delayMs: 60 * 60 * 1000 },
    { key: "+3h", stage: "+3h", delayMs: 3 * 60 * 60 * 1000 },
    { key: "daily", stage: "daily", delayMs: null },
  ],
}));

jest.mock("../../utils/deadlineTime", () => ({
  getUrgencyMeta: () => ({ color: "#ef4444" }),
}));

jest.mock("../../utils/deadlineNotifications", () => ({
  cancelDeadlineNotifications: jest.fn().mockResolvedValue([]),
  dismissDeadlinePresentations: jest.fn().mockResolvedValue([]),
  normalizeDeadlineAlarmAction: jest.fn((value) => value),
}));

jest.mock("../../utils/notificationIds", () => ({
  buildDeadlineNotificationId: jest.fn(() => "notif-id"),
  buildManagedNotificationData: jest.fn(() => ({})),
  buildNotificationId: jest.fn(() => "notif-id"),
}));

jest.mock("../../utils/taskOverdueState", () => ({
  advanceCheckpoint: jest.fn(async () => ({
    key: "+15m",
    delayMs: 15 * 60 * 1000,
  })),
  clearCheckpoint: jest.fn().mockResolvedValue(undefined),
  getCheckpoint: jest.fn().mockResolvedValue(null),
  resolveCurrentOverdueStageInfo: jest.fn((dueAtMs, nowMs = Date.now()) => {
    const overdueMs = nowMs - dueAtMs;
    if (!Number.isFinite(overdueMs) || overdueMs < 0) return null;
    if (overdueMs >= 3 * 60 * 60 * 1000) {
      return { key: "+3h", triggerAtMs: dueAtMs + 3 * 60 * 60 * 1000 };
    }
    if (overdueMs >= 60 * 60 * 1000) {
      return { key: "+1h", triggerAtMs: dueAtMs + 60 * 60 * 1000 };
    }
    if (overdueMs >= 15 * 60 * 1000) {
      return { key: "+15m", triggerAtMs: dueAtMs + 15 * 60 * 1000 };
    }
    return { key: "due", triggerAtMs: dueAtMs };
  }),
  resolveDailyAckBucket: jest.fn(() => 0),
}));

// â”€â”€â”€ Harness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SchedulerHarness({
  tasks,
  deadlineWarningEnabled = true,
  foregroundModalEnabled = true,
}) {
  const { alarmVisible, alarmTask, alarmThresholdKey, notDoneAlarm } =
    useDeadlineAlarmScheduler(tasks, {
      deadlineWarningEnabled,
      foregroundModalEnabled,
    });

  return (
    <>
      <Text>{alarmVisible ? alarmTask?.title : "No alarm"}</Text>
      <Text>{alarmThresholdKey || "No threshold"}</Text>
      <TouchableOpacity onPress={notDoneAlarm}>
        <Text>Not Done Hook</Text>
      </TouchableOpacity>
    </>
  );
}

function setPlatformOs(os) {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    get: () => os,
  });
}

function setAppStateCurrentState(state) {
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    get: () => state,
  });
}

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("Deadline alarm flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatformOs(ORIGINAL_PLATFORM_OS);
    setAppStateCurrentState(ORIGINAL_APP_STATE ?? "active");
  });

  // â”€â”€ 1. Not Done callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test("pressing Not Done on the modal notifies the caller", async () => {
    const onNotDone = jest.fn();
    const task = {
      id: "task-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };

    const { getByRole } = render(
      <DeadlineAlarmModal visible task={task} onNotDone={onNotDone} />
    );

    // Use getByRole to unambiguously target the button (not the info paragraph
    // text that also contains "Not Done") and wait for the async handler.
    await act(async () => {
      fireEvent.press(getByRole("button", { name: /not done/i }));
    });

    await waitFor(() => {
      expect(onNotDone).toHaveBeenCalled();
    });
  });

  test("mark-done handoff opens silently and waits for explicit confirmation", async () => {
    const onMarkDone = jest.fn();
    const alarmHelpers = jest.requireMock(
      "../../components/DeadlineAlarmModal.helpers"
    );
    const task = {
      id: "task-overdue-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };

    render(
      <DeadlineAlarmModal
        visible
        task={task}
        onMarkDone={onMarkDone}
        pendingAction="markdone"
        thresholdKey="due"
      />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(alarmHelpers.playAlarmSound).not.toHaveBeenCalled();
    expect(alarmHelpers.startVibration).not.toHaveBeenCalled();
    expect(onMarkDone).not.toHaveBeenCalled();
  });

  test("native-handoff body opens without starting a second local alarm loop", async () => {
    const alarmHelpers = jest.requireMock(
      "../../components/DeadlineAlarmModal.helpers"
    );
    const task = {
      id: "task-native-handoff-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };

    render(
      <DeadlineAlarmModal
        visible
        task={task}
        nativeHandoff={true}
        thresholdKey="due"
      />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(alarmHelpers.playAlarmSound).not.toHaveBeenCalled();
    expect(alarmHelpers.startVibration).not.toHaveBeenCalled();
  });

  test("native-handoff falls back to a local loop after 750ms when native audio never started", async () => {
    jest.useFakeTimers();

    try {
      const alarmHelpers = jest.requireMock(
        "../../components/DeadlineAlarmModal.helpers"
      );
      const task = {
        id: "task-native-fallback-1",
        title: "Submit capstone draft",
        subject: "Research",
        dueAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        priority: "high",
        type: "project",
      };

      render(
        <DeadlineAlarmModal
          visible
          task={task}
          nativeHandoff={true}
          nativeAudioStarted={false}
          thresholdKey="due"
        />
      );

      await act(async () => {
        jest.advanceTimersByTime(740);
      });

      expect(alarmHelpers.playAlarmSound).not.toHaveBeenCalled();
      expect(alarmHelpers.startVibration).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(10);
      });

      expect(alarmHelpers.playAlarmSound).toHaveBeenCalledTimes(1);
      expect(alarmHelpers.startVibration).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("foreground modal starts one continuous local alarm loop without restart timers", async () => {
    jest.useFakeTimers();

    try {
      const alarmHelpers = jest.requireMock(
        "../../components/DeadlineAlarmModal.helpers"
      );
      const task = {
        id: "task-local-loop-1",
        title: "Submit capstone draft",
        subject: "Research",
        dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
        priority: "high",
        type: "project",
      };

      render(<DeadlineAlarmModal visible task={task} thresholdKey="due" />);

      await act(async () => {
        jest.advanceTimersByTime(20 * 1000);
      });

      expect(alarmHelpers.playAlarmSound).toHaveBeenCalledTimes(1);
      expect(alarmHelpers.startVibration).toHaveBeenCalledTimes(1);
      expect(alarmHelpers.stopAlarmSound).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test("hiding the modal explicitly stops local sound and vibration", async () => {
    const alarmHelpers = jest.requireMock(
      "../../components/DeadlineAlarmModal.helpers"
    );
    const task = {
      id: "task-hide-stop-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };

    const { rerender } = render(
      <DeadlineAlarmModal visible task={task} thresholdKey="due" />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    alarmHelpers.stopAlarmSound.mockClear();
    alarmHelpers.stopVibration.mockClear();

    rerender(
      <DeadlineAlarmModal visible={false} task={task} thresholdKey="due" />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(alarmHelpers.stopAlarmSound).toHaveBeenCalled();
    expect(alarmHelpers.stopVibration).toHaveBeenCalled();
  });

  test("done does not restart local playback when session props change before close", async () => {
    const alarmHelpers = jest.requireMock(
      "../../components/DeadlineAlarmModal.helpers"
    );
    const task = {
      id: "task-done-restart-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };
    let resolveDone;
    const onMarkDone = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveDone = resolve;
        })
    );

    const { getByRole, rerender } = render(
      <DeadlineAlarmModal
        visible
        task={task}
        thresholdKey="due"
        nativeAudioStarted={true}
        onMarkDone={onMarkDone}
      />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(alarmHelpers.playAlarmSound).toHaveBeenCalledTimes(1);
    expect(alarmHelpers.startVibration).toHaveBeenCalledTimes(1);

    alarmHelpers.playAlarmSound.mockClear();
    alarmHelpers.startVibration.mockClear();

    act(() => {
      fireEvent.press(getByRole("button", { name: /^done$/i }));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    rerender(
      <DeadlineAlarmModal
        visible
        task={task}
        thresholdKey="due"
        nativeAudioStarted={null}
        onMarkDone={onMarkDone}
      />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(alarmHelpers.playAlarmSound).not.toHaveBeenCalled();
    expect(alarmHelpers.startVibration).not.toHaveBeenCalled();

    await act(async () => {
      resolveDone?.();
      await Promise.resolve();
    });
  });

  // â”€â”€ 2. Done callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test("overdue alarms auto-miss after five minutes", async () => {
    jest.useFakeTimers();

    try {
      const onNotDone = jest.fn();
      const { scheduleNextOverdueAlarm } = jest.requireMock(
        "../../utils/deadlineAlarmBackground"
      );
      const task = {
        id: "task-overdue-timeout",
        title: "Submit practicum log",
        subject: "Internship",
        dueAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        priority: "high",
        type: "project",
      };

      render(
        <DeadlineAlarmModal
          visible
          task={task}
          onNotDone={onNotDone}
          thresholdKey="due"
        />
      );

      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000 + 1000);
      });

      await waitFor(() => {
        expect(onNotDone).toHaveBeenCalled();
        expect(scheduleNextOverdueAlarm).toHaveBeenCalled();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("due alarms ignore request-close dismissal while urgent", async () => {
    const task = {
      id: "task-due-block-close",
      title: "Submit practicum log",
      subject: "Internship",
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };

    const { UNSAFE_getByType, getByRole } = render(
      <DeadlineAlarmModal visible task={task} thresholdKey="due" />
    );

    await act(async () => {
      UNSAFE_getByType(Modal).props.onRequestClose();
    });

    expect(getByRole("button", { name: /^done$/i })).toBeTruthy();
    expect(getByRole("button", { name: /not done/i })).toBeTruthy();
  });

  test("pressing Done on the modal cancels all alarms", async () => {
    const onMarkDone = jest.fn();
    const task = {
      id: "task-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };

    const { getByRole } = render(
      <DeadlineAlarmModal visible task={task} onMarkDone={onMarkDone} />
    );

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /^done$/i }));
    });

    await waitFor(() => {
      expect(onMarkDone).toHaveBeenCalled();
    });
  });

  // â”€â”€ 3. Scheduler â€“ surfaces task then hides after "Not Done" â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  test("scheduler surfaces a soon-due task and persists not-done", async () => {
    const task = {
      id: "task-2",
      title: "Prepare oral report",
      dueAt: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
      completed: false,
    };

    const { getByText } = render(<SchedulerHarness tasks={[task]} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("Prepare oral report")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Not Done Hook"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(AsyncStorage.setItem).toHaveBeenCalled();

    await waitFor(() => {
      expect(getByText("No alarm")).toBeTruthy();
    });
  });

  test("scheduler skips an immediate modal for a new task created under five minutes before due, then opens at due", async () => {
    jest.useFakeTimers();

    try {
      const now = new Date();
      const task = {
        id: "task-new-under-5",
        title: "Quick worksheet sync",
        dueAt: new Date(now.getTime() + 45 * 1000).toISOString(),
        leadCatchupEligibleFrom: now.toISOString(),
        completed: false,
      };

      const { getByText } = render(<SchedulerHarness tasks={[task]} />);

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(getByText("No alarm")).toBeTruthy();
        expect(getByText("No threshold")).toBeTruthy();
      });

      await act(async () => {
        jest.advanceTimersByTime(46 * 1000);
      });

      await waitFor(() => {
        expect(getByText("Quick worksheet sync")).toBeTruthy();
        expect(getByText("due")).toBeTruthy();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("scheduler does not retro-open the 30-minute lead for a newly created 29-minute task", async () => {
    const now = new Date();
    const task = {
      id: "task-new-29m",
      title: "Review chapter summary",
      dueAt: new Date(now.getTime() + 29 * 60 * 1000).toISOString(),
      leadCatchupEligibleFrom: now.toISOString(),
      completed: false,
    };

    const { getByText } = render(<SchedulerHarness tasks={[task]} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("No alarm")).toBeTruthy();
      expect(getByText("No threshold")).toBeTruthy();
    });
  });

  test("scheduler skips an immediate modal when an existing task is edited under five minutes before due, then opens at due", async () => {
    jest.useFakeTimers();

    try {
      const now = new Date();
      const task = {
        id: "task-edited-under-5",
        title: "Revise appendix notes",
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        dueAt: new Date(now.getTime() + 45 * 1000).toISOString(),
        leadCatchupEligibleFrom: now.toISOString(),
        completed: false,
      };

      const { getByText } = render(<SchedulerHarness tasks={[task]} />);

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(getByText("No alarm")).toBeTruthy();
        expect(getByText("No threshold")).toBeTruthy();
      });

      await act(async () => {
        jest.advanceTimersByTime(46 * 1000);
      });

      await waitFor(() => {
        expect(getByText("Revise appendix notes")).toBeTruthy();
        expect(getByText("due")).toBeTruthy();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("scheduler still opens a lead alarm when a valid future lead threshold is crossed naturally", async () => {
    jest.useFakeTimers();

    try {
      const now = new Date();
      const task = {
        id: "task-natural-lead",
        title: "Join peer review call",
        dueAt: new Date(now.getTime() + 70 * 1000).toISOString(),
        leadCatchupEligibleFrom: new Date(
          now.getTime() - 5 * 60 * 1000
        ).toISOString(),
        completed: false,
      };

      const { getByText } = render(<SchedulerHarness tasks={[task]} />);

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(getByText("No alarm")).toBeTruthy();
        expect(getByText("No threshold")).toBeTruthy();
      });

      await act(async () => {
        jest.advanceTimersByTime(12 * 1000);
      });

      await waitFor(() => {
        expect(getByText("Join peer review call")).toBeTruthy();
        expect(getByText("1m")).toBeTruthy();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("scheduler does not auto-open the modal when foreground modal support is disabled", async () => {
    setPlatformOs("android");
    setAppStateCurrentState("active");
    const { displayAlarmNotification, displayLeadNotification } =
      jest.requireMock("../../utils/deadlineAlarmBackground");
    const task = {
      id: "task-foreground-disabled",
      title: "Prepare oral report",
      dueAt: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
      completed: false,
    };

    const { getByText } = render(
      <SchedulerHarness
        tasks={[task]}
        foregroundModalEnabled={false}
      />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("No alarm")).toBeTruthy();
      expect(getByText("No threshold")).toBeTruthy();
    });

    expect(displayLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "notif-id",
        title: "\u23F0 Due in 30 min",
        body: expect.stringContaining("Prepare oral report"),
        data: expect.objectContaining({
          taskId: "task-foreground-disabled",
          acknowledgeRequired: false,
          isLeadTime: true,
          alarmKind: "lead_notice",
          stage: "30m",
          deliveryPath: "foreground_catchup",
        }),
      })
    );
    expect(displayAlarmNotification).not.toHaveBeenCalled();
  });

  test("scheduler does not auto-open due alarms when foreground modal support is disabled", async () => {
    setPlatformOs("android");
    setAppStateCurrentState("active");
    const { displayAlarmNotification, displayLeadNotification } =
      jest.requireMock("../../utils/deadlineAlarmBackground");
    const task = {
      id: "task-due-foreground-disabled",
      title: "Join group meeting",
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      completed: false,
    };

    const { getByText } = render(
      <SchedulerHarness
        tasks={[task]}
        foregroundModalEnabled={false}
      />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("No alarm")).toBeTruthy();
      expect(getByText("No threshold")).toBeTruthy();
    });

    expect(displayAlarmNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "notif-id",
        data: expect.objectContaining({
          taskId: "task-due-foreground-disabled",
          acknowledgeRequired: true,
          isLeadTime: false,
          stage: "due",
          deliveryPath: "foreground_catchup",
        }),
        isOngoing: true,
      })
    );
    expect(displayLeadNotification).not.toHaveBeenCalled();
  });

  test("scheduler uses explicit overdue checkpoints", async () => {
    const task = {
      id: "task-overdue-2",
      title: "Finish chemistry lab",
      dueAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      completed: false,
    };

    const { getByText } = render(<SchedulerHarness tasks={[task]} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("Finish chemistry lab")).toBeTruthy();
      expect(getByText("+15m")).toBeTruthy();
    });
  });

  test("scheduler handles the due threshold without throwing", async () => {
    const task = {
      id: "task-due-now",
      title: "Join group meeting",
      dueAt: new Date(Date.now() - 60 * 1000).toISOString(),
      completed: false,
    };

    const { getByText } = render(<SchedulerHarness tasks={[task]} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("Join group meeting")).toBeTruthy();
      expect(getByText("due")).toBeTruthy();
    });
  });

  test("scheduler advances to the next queued alarm after Not Done", async () => {
    const tasks = [
      {
        id: "task-queue-1",
        title: "Draft reflection paper",
        dueAt: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
        completed: false,
      },
      {
        id: "task-queue-2",
        title: "Review biology notes",
        dueAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        completed: false,
      },
    ];

    const { getByText, queryByText } = render(<SchedulerHarness tasks={tasks} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("Draft reflection paper")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Not Done Hook"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(queryByText("Draft reflection paper")).toBeNull();
      expect(getByText("Review biology notes")).toBeTruthy();
    });
  });

  test("scheduler respects the deadline warning setting", async () => {
    const task = {
      id: "task-3",
      title: "Read case study",
      dueAt: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
      completed: false,
    };

    const { getByText } = render(
      <SchedulerHarness tasks={[task]} deadlineWarningEnabled={false} />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(getByText("No alarm")).toBeTruthy();
      expect(getByText("No threshold")).toBeTruthy();
    });
  });
});
