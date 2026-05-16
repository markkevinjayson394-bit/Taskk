import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import DeadlineAlarmHost from "../../components/DeadlineAlarmHost";
import { publishDeadlineAlarmOpenRequest } from "../../utils/deadlineAlarmBridge";

const mockShowAlarmForTask = jest.fn();
const mockNotDoneAlarm = jest.fn(() => Promise.resolve());
const mockMarkDoneAlarm = jest.fn(() => Promise.resolve());
const mockDismissAlarm = jest.fn();
const mockUpdateDoc = jest.fn(() => Promise.resolve());
const mockLoadFromCache = jest.fn();
const mockSaveToCache = jest.fn(() => Promise.resolve());
const mockReadOfflineCreateQueue = jest.fn(() => Promise.resolve([]));
const mockStopActiveNativeAlarm = jest.fn(() => Promise.resolve(true));
const mockForceStopNativeAlarm = jest.fn(() => Promise.resolve(true));
const mockRefreshPendingSyncSummary = jest.fn(() => Promise.resolve());
const mockLogAlarmHostDuplicateSuppressed = jest.fn(() => Promise.resolve());
const mockLogForegroundCatchupSuppressed = jest.fn(() => Promise.resolve());
const mockLogStartupHandoffSkipped = jest.fn(() => Promise.resolve());

jest.mock("../../config/firebase", () => ({
  auth: { currentUser: { uid: "student-1" } },
  getDb: jest.fn(() => ({})),
}));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  doc: jest.fn((...args) => args),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  orderBy: jest.fn(),
  query: jest.fn(),
  updateDoc: (...args) => mockUpdateDoc(...args),
  where: jest.fn(),
}));

jest.mock("../../context/OfflineContext", () => ({
  CACHE_KEYS: {
    assignments: (uid) => `assignments:${uid}`,
  },
  loadFromCache: (...args) => mockLoadFromCache(...args),
  saveToCache: (...args) => mockSaveToCache(...args),
  useOffline: () => ({
    isOnline: false,
    refreshPendingSyncSummary: mockRefreshPendingSyncSummary,
  }),
}));

jest.mock("../../context/NotificationContext", () => ({
  useNotifications: () => ({
    settings: { deadlineWarning: true },
    clearTaskAlarmSuppression: jest.fn(() => Promise.resolve()),
    rescheduleAll: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock("../../utils/nativeAlarm", () => ({
  stopActiveNativeAlarm: (...args) => mockStopActiveNativeAlarm(...args),
  forceStopNativeAlarm: (...args) => mockForceStopNativeAlarm(...args),
}));

jest.mock("../../utils/offlineTaskQueue", () => ({
  findOfflineQueuedTask: jest.fn(() => Promise.resolve(null)),
  isLocalOnlyTaskId: jest.fn((id) => String(id || "").startsWith("local_")),
  mergePendingTasksWithOfflineQueue: jest.fn((pending) => pending),
  readOfflineCreateQueue: (...args) => mockReadOfflineCreateQueue(...args),
  removeOfflineQueuedTask: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  cancelDeadlineAlarms: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/alarmDiagnostics", () => ({
  logAlarmHostDuplicateSuppressed: (...args) =>
    mockLogAlarmHostDuplicateSuppressed(...args),
  logForegroundCatchupSuppressed: (...args) =>
    mockLogForegroundCatchupSuppressed(...args),
  logStartupHandoffSkipped: (...args) => mockLogStartupHandoffSkipped(...args),
}));

jest.mock("../../components/DeadlineAlarmModal", () => {
  const React = require("react");
  const { Text, TouchableOpacity, View } = require("react-native");

  return {
    __esModule: true,
    default: ({ visible, task, nativeHandoff, onNotDone, onMarkDone }) => (
      <View>
        <Text>{visible ? `visible:${task?.id}` : "hidden"}</Text>
        <Text>{nativeHandoff ? "native" : "local"}</Text>
        <TouchableOpacity onPress={onNotDone}>
          <Text>Not Done</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onMarkDone}>
          <Text>Done</Text>
        </TouchableOpacity>
      </View>
    ),
    useDeadlineAlarmScheduler: (tasks) => {
      const [active, setActive] = React.useState(null);
      const showAlarmForTask = React.useCallback((task, thresholdKey) => {
        mockShowAlarmForTask(task, thresholdKey);
        setActive({ task, thresholdKey });
      }, []);
      const notDoneAlarm = React.useCallback(async () => {
        await mockNotDoneAlarm();
        setActive(null);
      }, []);
      const markDoneAlarm = React.useCallback(async () => {
        await mockMarkDoneAlarm();
        setActive(null);
      }, []);
      const dismissAlarm = React.useCallback(() => {
        mockDismissAlarm();
        setActive(null);
      }, []);

      return {
        alarmVisible: Boolean(active),
        alarmTask: active?.task ?? null,
        alarmThresholdKey: active?.thresholdKey ?? null,
        notDoneAlarm,
        dismissAlarm,
        markDoneAlarm,
        showAlarmForTask,
      };
    },
  };
});

describe("DeadlineAlarmHost", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadFromCache.mockResolvedValue({
      data: {
        pending: [
          {
            id: "task-1",
            title: "Essay",
            completed: false,
            dueAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      },
    });
  });

  it("opens a bridged alarm once and settles native handoff into local modal audio", async () => {
    const { getByText } = render(<DeadlineAlarmHost />);

    await act(async () => {
      publishDeadlineAlarmOpenRequest({
        focusTaskId: "task-1",
        alarmStage: "+15m",
        sourceId: "source-1",
        nativeHandoff: "1",
      });
    });

    await waitFor(() => {
      expect(getByText("visible:task-1")).toBeTruthy();
    });

    expect(mockStopActiveNativeAlarm).toHaveBeenCalled();
    expect(getByText("local")).toBeTruthy();
    expect(mockShowAlarmForTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      publishDeadlineAlarmOpenRequest({
        focusTaskId: "task-1",
        alarmStage: "+15m",
        sourceId: "source-1",
        nativeHandoff: "1",
      });
    });

    expect(mockShowAlarmForTask).toHaveBeenCalledTimes(1);
  });

  it("delegates Not Done to the single host scheduler", async () => {
    const { getByText } = render(<DeadlineAlarmHost />);

    await act(async () => {
      publishDeadlineAlarmOpenRequest({
        focusTaskId: "task-1",
        alarmStage: "due",
        sourceId: "source-2",
      });
    });

    await waitFor(() => {
      expect(getByText("visible:task-1")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Not Done"));
    });

    expect(mockNotDoneAlarm).toHaveBeenCalledTimes(1);
    expect(mockLogForegroundCatchupSuppressed).toHaveBeenCalledWith(
      "task-1",
      "modal_notdone",
      expect.objectContaining({
        stage: "due",
      })
    );
  });

  it("passes uid during Done completion and does not keep the completed task eligible", async () => {
    const { getByText } = render(<DeadlineAlarmHost />);

    await act(async () => {
      publishDeadlineAlarmOpenRequest({
        focusTaskId: "task-1",
        alarmStage: "due",
        sourceId: "source-done",
      });
    });

    await waitFor(() => {
      expect(getByText("visible:task-1")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Done"));
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });
    expect(mockRefreshPendingSyncSummary).toHaveBeenCalledWith("student-1");
    expect(mockDismissAlarm).toHaveBeenCalled();
  });

  it("suppresses the same source after the modal session closes", async () => {
    const { getByText } = render(<DeadlineAlarmHost />);

    await act(async () => {
      publishDeadlineAlarmOpenRequest({
        focusTaskId: "task-1",
        alarmStage: "due",
        sourceId: "source-notdone",
      });
    });

    await waitFor(() => {
      expect(getByText("visible:task-1")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Not Done"));
    });

    await act(async () => {
      publishDeadlineAlarmOpenRequest({
        focusTaskId: "task-1",
        alarmStage: "due",
        sourceId: "source-notdone",
      });
    });

    expect(mockShowAlarmForTask).toHaveBeenCalledTimes(1);
    expect(mockLogAlarmHostDuplicateSuppressed).toHaveBeenCalledWith(
      "task-1",
      "source_already_handled",
      expect.objectContaining({
        sourceId: "source-notdone",
      })
    );
  });
});
