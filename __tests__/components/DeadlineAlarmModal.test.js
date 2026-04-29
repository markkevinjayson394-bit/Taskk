import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Text, TouchableOpacity } from "react-native";
import DeadlineAlarmModal, {
  useDeadlineAlarmScheduler,
} from "../../components/DeadlineAlarmModal";
import { render } from "../../utils/test-utils";

// ─── Harness ────────────────────────────────────────────────────────────────
// The harness mirrors what the real screen does: it reads alarmVisible from
// the hook and shows the task title while the alarm is active, or "No alarm"
// once the hook has dismissed it (alarmVisible === false).
function SchedulerHarness({ tasks }) {
  const { alarmVisible, alarmTask, notDoneAlarm } =
    useDeadlineAlarmScheduler(tasks);

  // alarmVisible drives the text shown. When the hook clears the alarm
  // (after notDoneAlarm persists the snooze) alarmVisible becomes false
  // and "No alarm" is rendered.
  return (
    <>
      <Text>{alarmVisible ? alarmTask?.title : "No alarm"}</Text>
      <TouchableOpacity onPress={notDoneAlarm}>
        <Text>Not Done Hook</Text>
      </TouchableOpacity>
    </>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("Deadline alarm flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Not Done callback ─────────────────────────────────────────────────
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

    const { getAllByText } = render(
      <DeadlineAlarmModal visible task={task} onNotDone={onNotDone} />
    );

    fireEvent.press(getAllByText(/not done/i)[0]);

    await waitFor(() => {
      expect(onNotDone).toHaveBeenCalled();
    });
  });

  // ── 2. Done callback ─────────────────────────────────────────────────────
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

    const { getByText } = render(
      <DeadlineAlarmModal visible task={task} onMarkDone={onMarkDone} />
    );

    fireEvent.press(getByText(/^done$/i));

    await waitFor(() => {
      expect(onMarkDone).toHaveBeenCalled();
    });
  });

  // ── 3. Scheduler – surfaces task then hides after "Not Done" ─────────────
  test("scheduler surfaces a soon-due task and persists not-done", async () => {
    const task = {
      id: "task-2",
      title: "Prepare oral report",
      dueAt: new Date(Date.now() + 29 * 60 * 1000).toISOString(), // 29 min → triggers 30-min alarm
      completed: false,
    };

    const { getByText } = render(<SchedulerHarness tasks={[task]} />);

    // Wait for the scheduler to surface the task
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Alarm should now be visible with the task title
    await waitFor(() => {
      expect(getByText("Prepare oral report")).toBeTruthy();
    });

    // Press "Not Done" – the hook should persist state and clear the alarm
    await act(async () => {
      fireEvent.press(getByText("Not Done Hook"));
      // Allow microtasks (AsyncStorage.setItem) to settle
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The hook must have called AsyncStorage.setItem to persist the snooze
    expect(AsyncStorage.setItem).toHaveBeenCalled();

    // After dismissal the harness should show "No alarm"
    await waitFor(() => {
      expect(getByText("No alarm")).toBeTruthy();
    });
  });
});
