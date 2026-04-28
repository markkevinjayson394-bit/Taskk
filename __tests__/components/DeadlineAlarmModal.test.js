import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { Text, TouchableOpacity } from "react-native";
import DeadlineAlarmModal, {
    useDeadlineAlarmScheduler,
} from "../../components/DeadlineAlarmModal";
import { render } from "../../utils/test-utils";
function SchedulerHarness({ tasks }) {
  const { alarmVisible, alarmTask, acknowledgeAlarm } =
    useDeadlineAlarmScheduler(tasks);
  return (
    <>
      <Text>{alarmVisible ? alarmTask?.title : "No alarm"}</Text>
      <TouchableOpacity onPress={acknowledgeAlarm}>
        <Text>Acknowledge Hook</Text>
      </TouchableOpacity>
    </>
  );
}
describe("Deadline alarm flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  test("acknowledging the modal notifies the caller", async () => {
    const onAcknowledge = jest.fn();
    const task = {
      id: "task-1",
      title: "Submit capstone draft",
      subject: "Research",
      dueAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      priority: "high",
      type: "project",
    };
    const { getByText } = render(
      <DeadlineAlarmModal visible task={task} onAcknowledge={onAcknowledge} />
    );
    fireEvent.press(getByText(/acknowledge/i));
    await waitFor(() => {
      expect(onAcknowledge).toHaveBeenCalled();
      expect(getByText(/acknowledged/i)).toBeTruthy();
    });
  });
  test("scheduler surfaces a soon-due task and persists acknowledgment", async () => {
    const task = {
      id: "task-2",
      title: "Prepare oral report",
      dueAt: new Date(Date.now() + 29 * 60 * 1000).toISOString(), // 29 min to trigger 30m alarm
      completed: false,
    };
    const { getByText } = render(<SchedulerHarness tasks={[task]} />);
    await waitFor(() => {
      expect(getByText("Prepare oral report")).toBeTruthy();
    });
    fireEvent.press(getByText("Acknowledge Hook"));
    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalled();
      expect(getByText("No alarm")).toBeTruthy();
    });
  });
});