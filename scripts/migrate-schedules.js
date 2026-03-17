#!/usr/bin/env node

/**
 * Migration script to update existing schedule documents with new time fields
 * for compatibility with the updated createSchedule functionality.
 */

const admin = require("firebase-admin");
const fs = require("fs");

// Path to the Firebase service account JSON file
const serviceAccountPath =
  "C:\\Users\\miptac\\Downloads\\my-expo-auth-app-290eb-firebase-adminsdk-fbsvc-023d08e338.json";

// Load the service account key
let serviceAccount;
try {
  const serviceAccountData = fs.readFileSync(serviceAccountPath, "utf8");
  serviceAccount = JSON.parse(serviceAccountData);
} catch (error) {
  console.error("Error loading Firebase service account JSON:", error.message);
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
});

const db = admin.firestore();

const DEFAULT_TIME_BLOCKS = [
  { start: "7:00 AM", end: "8:00 AM", label: "Class" },
  { start: "8:00 AM", end: "9:00 AM", label: "Class" },
  { start: "9:00 AM", end: "12:00 PM", label: "Class" },
  { start: "12:00 PM", end: "1:00 PM", label: "Lunch" },
  { start: "1:00 PM", end: "2:00 PM", label: "Class" },
  { start: "2:00 PM", end: "3:00 PM", label: "Class" },
  { start: "3:00 PM", end: "4:00 PM", label: "Class" },
  { start: "4:00 PM", end: "5:00 PM", label: "Class" },
];

async function migrateSchedules() {
  console.log("Starting schedule migration...");

  try {
    const schedulesRef = db.collection("schedules");
    const snapshot = await schedulesRef.get();

    if (snapshot.empty) {
      console.log("No schedules found to migrate.");
      return;
    }

    let migratedCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const updates = {};

      // Check if new fields are missing
      if (!data.timeBlocks) {
        // Set default time blocks based on schedType
        if (data.schedType === "night") {
          updates.timeBlocks = [
            { start: "5:00 PM", end: "6:00 PM" },
            { start: "6:00 PM", end: "7:00 PM" },
            { start: "7:00 PM", end: "8:00 PM" },
            { start: "8:00 PM", end: "9:00 PM" },
          ];
        } else {
          updates.timeBlocks = DEFAULT_TIME_BLOCKS;
        }
      }

      if (Object.keys(updates).length > 0) {
        await doc.ref.update(updates);
        migratedCount++;
        console.log(
          `Migrated schedule: ${data.college} ${data.program} ${data.yearLevel} ${data.section}`
        );
      }
    }

    console.log(`Migration completed. ${migratedCount} schedules updated.`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    admin.app().delete();
  }
}

migrateSchedules();
