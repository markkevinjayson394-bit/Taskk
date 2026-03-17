/* eslint-disable no-console */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG_INDEX = process.argv.indexOf("--limit");
const LIMIT =
  LIMIT_ARG_INDEX >= 0 ? Number(process.argv[LIMIT_ARG_INDEX + 1]) : null;

const COURSES_BY_COLLEGE = {
  COT: [
    "BSIT",
    "BSMX",
    "BIT Computer",
    "BIT Drafting",
    "BIT Electrical",
    "BIT Electronics",
  ],
  CED: [
    "BEEd",
    "BTLEd Home Economics",
    "BSEd Mathematics",
    "BSEd Science",
    "BSEd English",
    "BSEd Social Studies",
  ],
  COE: ["BSIE", "BSME", "BSCE", "BSEE", "BSCpE"],
  CME: ["BSHM", "BSTM", "BSBA Marketing"],
};

const COURSE_ALIASES = {
  "BTLED HOME EC": "BTLEd Home Economics",
  "BSED MATH": "BSEd Mathematics",
};

const COURSE_CANONICAL = Object.values(COURSES_BY_COLLEGE)
  .flat()
  .reduce((acc, course) => {
    acc[String(course).toUpperCase()] = course;
    return acc;
  }, {});

function normalizeCourse(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toUpperCase();
  return COURSE_ALIASES[key] || COURSE_CANONICAL[key] || raw;
}

function loadProjectId() {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  const rcPath = path.join(__dirname, "..", ".firebaserc");
  try {
    const data = JSON.parse(fs.readFileSync(rcPath, "utf8"));
    const projects = data.projects || {};
    return projects.default || projects.marked || Object.values(projects)[0] || null;
  } catch {
    return null;
  }
}

function initAdmin() {
  const projectId = loadProjectId();
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credential = serviceAccountPath
    ? admin.credential.cert(require(path.resolve(serviceAccountPath)))
    : admin.credential.applicationDefault();
  admin.initializeApp({ credential, projectId: projectId || undefined });
}

async function commitBatch(batch, pending) {
  if (!pending) return;
  await batch.commit();
}

async function migrateUsers(db) {
  const snap = await db.collection("users").get();
  let scanned = 0;
  let updated = 0;
  let batch = db.batch();
  let pending = 0;
  let reported = 0;

  for (const doc of snap.docs) {
    if (LIMIT && scanned >= LIMIT) break;
    scanned += 1;
    const info = doc.data()?.studentInfo || {};
    const course = info.course;
    const normalized = normalizeCourse(course);
    if (!course || normalized === course || !normalized) continue;
    updated += 1;

    if (DRY_RUN) {
      console.log(`[users] ${doc.id}: "${course}" -> "${normalized}"`);
    } else {
      batch.update(doc.ref, { "studentInfo.course": normalized });
      pending += 1;
      if (pending >= 450) {
        await commitBatch(batch, pending);
        batch = db.batch();
        pending = 0;
      }
    }

    reported += 1;
  }

  if (!DRY_RUN) {
    await commitBatch(batch, pending);
  }

  return { scanned, updated, reported };
}

async function migrateSchedules(db) {
  const snap = await db.collection("schedules").get();
  let scanned = 0;
  let updated = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    if (LIMIT && scanned >= LIMIT) break;
    scanned += 1;
    const course = doc.data()?.course;
    const normalized = normalizeCourse(course);
    if (!course || normalized === course || !normalized) continue;
    updated += 1;

    if (DRY_RUN) {
      console.log(`[schedules] ${doc.id}: "${course}" -> "${normalized}"`);
    } else {
      batch.update(doc.ref, { course: normalized });
      pending += 1;
      if (pending >= 450) {
        await commitBatch(batch, pending);
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (!DRY_RUN) {
    await commitBatch(batch, pending);
  }

  return { scanned, updated };
}

async function migrateAnnouncements(db) {
  const snap = await db.collection("announcements").get();
  let scanned = 0;
  let updated = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    if (LIMIT && scanned >= LIMIT) break;
    scanned += 1;
    const course = doc.data()?.course;
    const normalized = normalizeCourse(course);
    if (!course || normalized === course || !normalized) continue;
    updated += 1;

    if (DRY_RUN) {
      console.log(`[announcements] ${doc.id}: "${course}" -> "${normalized}"`);
    } else {
      batch.update(doc.ref, { course: normalized });
      pending += 1;
      if (pending >= 450) {
        await commitBatch(batch, pending);
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (!DRY_RUN) {
    await commitBatch(batch, pending);
  }

  return { scanned, updated };
}

async function main() {
  initAdmin();
  const db = admin.firestore();

  console.log(
    `Course migration starting (${DRY_RUN ? "dry-run" : "write"})` +
      (LIMIT ? ` with limit ${LIMIT}` : "")
  );

  const users = await migrateUsers(db);
  const schedules = await migrateSchedules(db);
  const announcements = await migrateAnnouncements(db);

  console.log("Course migration summary:");
  console.log(`- users: scanned ${users.scanned}, updated ${users.updated}`);
  console.log(
    `- schedules: scanned ${schedules.scanned}, updated ${schedules.updated}`
  );
  console.log(
    `- announcements: scanned ${announcements.scanned}, updated ${announcements.updated}`
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
