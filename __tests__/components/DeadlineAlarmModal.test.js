import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Text, TouchableOpacity } from "react-native";
import DeadlineAlarmModal, {
  useDeadlineAlarmScheduler,
} from "../../components/DeadlineAlarmModal";
import { render } from "../../utils/test-utils";

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
}));

// â”€â”€â”€ Harness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SchedulerHarness({ tasks, deadlineWarningEnabled = true }) {
  const { alarmVisible, alarmTask, alarmThresholdKey, notDoneAlarm } =
    useDeadlineAlarmScheduler(tasks, { deadlineWarningEnabled });

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

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("Deadline alarm flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  test("native Not Done action auto-advances the overdue chain", async () => {
    const onNotDone = jest.fn();
    const { scheduleNextOverdueAlarm } = jest.requireMock(
      "../../utils/deadlineAlarmBackground"
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
        onNotDone={onNotDone}
        pendingAction="notdone"
        thresholdKey="due"
      />
    );

    await waitFor(() => {
      expect(onNotDone).toHaveBeenCalled();
      expect(scheduleNextOverdueAlarm).toHaveBeenCalled();
    });
  });

  // â”€â”€ 2. Done callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
