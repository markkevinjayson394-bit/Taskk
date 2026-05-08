import AsyncStorage from "@react-native-async-storage/async-storage";
import { writeOfflineCreateQueue } from "../../utils/offlineTaskQueue";
import {
  getOverdueTasks,
  readSchedulablePendingTasks,
} from "../../utils/pendingTaskSources";

const mockCollection = jest.fn((...args) => ({ type: "collection", args }));
const mockGetDocs = jest.fn();
const mockQuery = jest.fn((...args) => ({ type: "query", args }));
const mockWarnIfDev = jest.fn();
const mockWhere = jest.fn((...args) => ({ type: "where", args }));

jest.mock("../../config/firebase", () => ({
  db: {},
}));

jest.mock("firebase/firestore", () => ({
  collection: (...args) => mockCollection(...args),
  getDocs: (...args) => mockGetDocs(...args),
  query: (...args) => mockQuery(...args),
  where: (...args) => mockWhere(...args),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: (...args) => mockWarnIfDev(...args),
}));

function makeDoc(id, data) {
  return {
    id,
    data: () => data,
  };
}

describe("pendingTaskSources", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("merges remote tasks with offline queued tasks and filters invalid entries", async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        makeDoc("remote-1", {
          title: "Remote task",
          dueAt: new Date("2026-05-03T10:00:00.000Z"),
          completed: false,
          status: "todo",
        }),
        makeDoc("remote-done", {
          title: "Done task",
          dueAt: new Date("2026-05-03T11:00:00.000Z"),
          completed: true,
          status: "done",
        }),
      ],
    });

    await writeOfflineCreateQueue("user-1", [
      {
        id: "local-1",
        payload: {
          title: "Offline task",
          dueAt: "2026-05-02T10:00:00.000Z",
          completed: false,
          status: "todo",
        },
        queuedAt: "2026-05-02T09:00:00.000Z",
      },
      {
        id: "local-missing-due",
        payload: {
          title: "Unschedulable task",
          completed: false,
          status: "todo",
        },
        queuedAt: "2026-05-02T09:05:00.000Z",
      },
    ]);

    const tasks = await readSchedulablePendingTasks("user-1", {
      warnContext: "pendingTaskSources.test",
    });

    expect(tasks.map((task) => task.id)).toEqual(["remote-1", "local-1"]);
  });

  it("falls back to offline queued tasks when the remote fetch fails", async () => {
    const remoteError = new Error("offline");
    mockGetDocs.mockRejectedValue(remoteError);

    await writeOfflineCreateQueue("user-2", [
      {
        id: "local-2",
        payload: {
          title: "Offline only",
          dueAt: "2026-05-02T10:00:00.000Z",
          completed: false,
          status: "todo",
        },
        queuedAt: "2026-05-02T09:00:00.000Z",
      },
    ]);

    const tasks = await readSchedulablePendingTasks("user-2", {
      warnContext: "pendingTaskSources.test",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "local-2", title: "Offline only" });
    expect(mockWarnIfDev).toHaveBeenCalledWith(
      "[pendingTaskSources.test] remote pending lookup failed:",
      remoteError
    );
  });

  it("returns overdue tasks sorted by oldest due date first", () => {
    const overdue = getOverdueTasks(
      [
        {
          id: "later",
          dueAt: "2026-05-02T11:00:00.000Z",
          completed: false,
          status: "todo",
        },
        {
          id: "earlier",
          dueAt: "2026-05-02T09:00:00.000Z",
          completed: false,
          status: "todo",
        },
        {
          id: "future",
          dueAt: "2026-05-02T13:00:00.000Z",
          completed: false,
          status: "todo",
        },
      ],
      new Date("2026-05-02T12:00:00.000Z").getTime()
    );

    expect(overdue.map((task) => task.id)).toEqual(["earlier", "later"]);
  });
});