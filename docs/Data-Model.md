# Academic Task Data Model (Step 3)

This app now uses a shared task schema for all assignment/task writes.

## Assignment Document (`assignments/{assignmentId}`)

Required fields:

- `userId` (string): owner UID.
- `title` (string): task title.
- `dueAt` (timestamp): due date/time.

Core task fields:

- `subject` (string): legacy subject label kept for compatibility.
- `subjectName` (string): normalized subject display name.
- `subjectId` (string): optional reference to `users/{uid}/subjects/{subjectId}`.
- `type` (enum): `assignment | quiz | exam | project`.
- `priority` (enum): `high | medium | low | none`.
- `priorityLevel` (number): derived ranking (1 highest to 4 lowest).
- `completed` (boolean): legacy completion flag.
- `status` (enum): `todo | in_progress | done`.
- `subtasks` (array): optional list of `{ id, title, done }`.
- `milestones` (array): optional list of strings.
- `schemaVersion` (number): current value defaults to `1`.

Planner fields (optional):

- `source` (string), `plannerRef` (string), `plannerBucket` (string), `plannerArchived` (boolean).

Timestamps (optional):

- `createdAt`, `updatedAt`, `completedAt`.

## Subjects Collection

- Path: `users/{uid}/subjects/{subjectId}`
- Purpose: normalized subject catalog per student.
- Rules: owner-only read/write.

## Compatibility Notes

- Existing task UI still reads `subject` and `completed`.
- New writes include both legacy (`subject`, `completed`) and schema-first (`subjectName`, `status`) fields.
- `view schedule` / schedule pages are unchanged.
