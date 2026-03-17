/**
 * assignmentNotifications.js
 *
 * Schedules push notifications for an assignment:
 *   - 1 day before due
 *   - 2 hours before due
 *   - At due time (overdue)
 *
 * FIX: Emoji characters restored in notification titles
 * FIX: Cancel old notifications before rescheduling (handles edited due dates)
 */
import * as Notifications from "expo-notifications";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../config/firebase";

function parseDueDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function scheduleAssignmentNotifications(
  assignmentId,
  assignment
) {
  try {
    // Skip completed tasks
    if (assignment.completed) return;

    // Check / request permission
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      const { status: newStatus } =
        await Notifications.requestPermissionsAsync();
      if (newStatus !== "granted") {
        console.warn("Notification permission not granted");
        return;
      }
    }

    // Cancel existing notifications before rescheduling
    // (handles the case where the due date was edited)
    if (assignment.notificationIds) {
      for (const id of Object.values(assignment.notificationIds)) {
        try {
          await Notifications.cancelScheduledNotificationAsync(id);
        } catch (_err) {
          console.error("Failed to cancel notification:", id, _err);
        }
      }
    }

    const dueDate = parseDueDate(assignment.dueAt);
    if (!dueDate) {
      console.warn("Notification scheduling skipped: invalid due date");
      return;
    }
    const now = new Date();
    const notificationIds = {};

    /*  1 DAY BEFORE  */
    const oneDayBefore = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
    if (oneDayBefore > now) {
      const dueStr = dueDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "📅 Assignment Due Tomorrow", // FIX: emoji restored
          body: `${assignment.title} (${assignment.subject}) - Due ${dueStr}`,
          data: { assignmentId },
        },
        trigger: { date: oneDayBefore },
      });
      notificationIds.dayBefore = id;
    }

    /*  2 HOURS BEFORE  */
    const twoHoursBefore = new Date(dueDate.getTime() - 2 * 60 * 60 * 1000);
    if (twoHoursBefore > now) {
      const dueStr = dueDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "⏰ Assignment Due Soon", // FIX: emoji restored
          body: `"${assignment.title}" (${assignment.subject}) is due in 2 hours! (Due ${dueStr})`,
          data: { assignmentId },
        },
        trigger: { date: twoHoursBefore },
      });
      notificationIds.twoHoursBefore = id;
    }

    /*  AT DUE TIME  */
    if (dueDate > now) {
      const dueStr = dueDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "🚨 Assignment Overdue!", // FIX: emoji restored
          body: `"${assignment.title}" (${assignment.subject}) is due RIGHT NOW. (Due ${dueStr})`,
          data: { assignmentId },
        },
        trigger: { date: dueDate },
      });
      notificationIds.atDue = id;
    }

    // Save updated notification IDs to Firestore
    await updateDoc(doc(db, "assignments", assignmentId), { notificationIds });
  } catch (_err) {
    console.error("Notification scheduling failed:", _err);
  }
}

/**
 * Cancel all scheduled notifications for an assignment.
 * Call this when a task is deleted or marked as completed.
 */
export async function cancelAssignmentNotifications(assignment) {
  if (!assignment.notificationIds) return;
  for (const id of Object.values(assignment.notificationIds)) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch (_err) {
      console.error("Failed to cancel notification:", id, _err);
    }
  }
}
