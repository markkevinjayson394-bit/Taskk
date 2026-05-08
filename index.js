// index.js
import "expo-router/entry";
import { AppRegistry } from "react-native";
import "./tasks/AlarmMissedTask";
import {
  bootstrapDeadlineAlarmChannel,
  DEADLINE_NOTIF_TYPE,
  displayAlarmNotification,
} from "./utils/deadlineAlarmBackground";

AppRegistry.registerHeadlessTask("AlarmDisplayTask", () => async (data) => {
  try {
    await bootstrapDeadlineAlarmChannel();

    const payload = data?.payloadJson ? JSON.parse(data.payloadJson) : {};

    const taskId = payload?.taskId || data?.alarmId || "";
    const title = data?.title || "Task Overdue";
    const body = data?.body || "A task requires your attention.";

    if (!taskId) return;

    await displayAlarmNotification({
      id: String(data.alarmId || taskId),
      title,
      body,
      data: {
        ...payload,
        type: DEADLINE_NOTIF_TYPE,
        notificationType: DEADLINE_NOTIF_TYPE,
        taskId,
        acknowledgeRequired: true,
      },
      isOngoing: true,
    });
  } catch (err) {
    console.warn("AlarmDisplayTask headless task failed:", err);
  }
});
