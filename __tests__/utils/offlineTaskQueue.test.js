import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildOfflineTaskFromQueueItem,
  mergePendingTasksWithOfflineQueue,
  prepareQueuedTaskPayloadForFirestore,
  readOfflineCreateQueue,
  writeOfflineCreateQueue,
} from "../../utils/offlineTaskQueue";

describe("offlineTaskQueue", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("hydrates date fields when reading the offline create queue", async () => {
    const dueAt = new Date("2026-05-02T10:00:00.000Z");
    const customReminderAt = new Date("2026-05-02T09:30:00.000Z");

    await writeOfflineCreateQueue("user-1", [
      {
        id: "local_task_1",
        payload: {
          title: "Offline task",
          dueAt,
          customReminderAt,
        },
        queuedAt: new Date("2026-05-02T09:00:00.000Z").toISOString(),
      },
    ]);

    const queue = await readOfflineCreateQueue("user-1");

    expect(queue).toHaveLength(1);
    expect(queue[0].payload.dueAt).toBeInstanceOf(Date);
    expect(queue[0].payload.customReminderAt).toBeInstanceOf(Date);
    expect(queue[0].payload.dueAt.toISOString()).toBe(dueAt.toISOString());
    expect(queue[0].payload.customReminderAt.toISOString()).toBe(
      customReminderAt.toISOString()
    );
  });

  it("builds local task objects from queued items", () => {
    const task = buildOfflineTaskFromQueueItem({
      id: "local_task_2",
      payload: {
        title: "Queued task",
        dueAt: "2026-05-02T10:00:00.000Z",
      },
      queuedAt: "2026-05-02T09:00:00.000Z",
    });

    expect(task).toMatchObject({
      id: "local_task_2",
      title: "Queued task",
      localOnly: true,
    });
    expect(task.dueAt).toBeInstanceOf(Date);
  });

  it("merges queued local tasks into pending tasks without duplicates", () => {
    const merged = mergePendingTasksWithOfflineQueue(
      [{ id: "remote_1", title: "Remote task" }],
      [
        {
          id: "local_task_3",
          payload: { title: "Local task", dueAt: "2026-05-02T10:00:00.000Z" },
          queuedAt: "2026-05-02T09:00:00.000Z",
        },
        {
          id: "remote_1",
          payload: {
            title: "Duplicate task",
            dueAt: "2026-05-02T11:00:00.000Z",
          },
          queuedAt: "2026-05-02T09:05:00.000Z",
        },
      ]
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((task) => task.id === "local_task_3")?.localOnly).toBe(
      true
    );
  });

  it("rehydrates serialized queue payloads before Firestore sync", () => {
    const payload = prepareQueuedTaskPayloadForFirestore({
      dueAt: "2026-05-02T10:00:00.000Z",
      customReminderAt: "2026-05-02T09:30:00.000Z",
    });

    expect(payload.dueAt).toBeInstanceOf(Date);
    expect(payload.customReminderAt).toBeInstanceOf(Date);
  });

  it("handles null date fields in queued task payload", () => {
    const payload = prepareQueuedTaskPayloadForFirestore({
      dueAt: null,
      customReminderAt: null,
    });
    expect(payload.dueAt).toBeNull();
    expect(payload.customReminderAt).toBeNull();
  });

  it("handles missing date fields in queued task payload", () => {
    const payload = prepareQueuedTaskPayloadForFirestore({
      title: "No dates here",
    });
    expect(payload.dueAt).toBeUndefined();
    expect(payload.customReminderAt).toBeUndefined();
  });
});
