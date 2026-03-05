import * as Notifications from "expo-notifications";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../config/firebase";

export async function scheduleAssignmentNotifications(assignmentId, assignment) {
  // FIX #6: wrap entire function in try/catch to prevent silent crashes
  try {
    // Do nothing if already completed
    if (assignment.completed) return;

    // Do nothing if notifications already exist
    if (assignment.notificationIds) return;

    // Check notification permissions before scheduling
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      if (newStatus !== "granted") {
        console.warn("Notification permission not granted");
        return;
      }
    }

    const dueDate = assignment.dueAt.toDate();
    const now = new Date();
    const notificationIds = {};

    /* 1 DAY BEFORE */
    const oneDayBefore = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
    if (oneDayBefore > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "📅 Assignment Due Tomorrow",
          body: `${assignment.title} (${assignment.subject})`,
        },
        trigger: {
          date: oneDayBefore,
        },
      });
      notificationIds.dayBefore = id;
    }

    /* 2 HOURS BEFORE */
    const twoHoursBefore = new Date(dueDate.getTime() - 2 * 60 * 60 * 1000);
    if (twoHoursBefore > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "⏰ Assignment Due Soon",
          body: `${assignment.title} is due in 2 hours`,
        },
        trigger: {
          date: twoHoursBefore,
        },
      });
      notificationIds.twoHoursBefore = id;
    }

    // Save notification IDs in Firestore
    await updateDoc(doc(db, "assignments", assignmentId), {
      notificationIds,
    });
  } catch (err) {
    // FIX #6: log error instead of crashing the app
    console.error("Notification scheduling failed:", err);
  }
} 