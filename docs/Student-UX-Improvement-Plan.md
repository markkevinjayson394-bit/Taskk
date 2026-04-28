# Student UX Improvement Plan

Date updated: March 31, 2026

## Goal

Improve the student experience in a clear execution order so the app becomes faster to understand, faster to use, and easier to maintain.

## Current Product Read

Strengths:
- Strong feature coverage for student academic work
- Schedule, planner, tasks, reminders, and announcements already exist
- Offline and notification support add real student value

Weak points:
- Too much top-level information at once
- Core student screens are too large and hard to refine safely
- Planner, tasks, and schedule still feel like separate tools instead of one workflow

## Execution Order

### Step 1. Refactor the task editor flow

Goal:
- Make task capture easier to improve and test

Why first:
- Students use task creation constantly
- The create/edit modal is self-contained and can be extracted with low behavior risk

Implementation:
- Extract the create/edit task modal and subject picker from `TaskManagerScreen`
- Keep behavior the same
- Reduce the size and complexity of the screen file

Status:
- Implemented in this iteration

### Step 2. Turn Home into a decision screen

Goal:
- Help students decide what to do next in under 10 seconds

Changes:
- Show only next class, urgent tasks, and today plan
- Add one primary action such as `Start planning` or `Add task`
- Move secondary information behind links or cards

Target files:
- `app/(tabs)/home.js`

Status:
- Implemented in this iteration

### Step 3. Simplify navigation

Goal:
- Reduce cognitive load in the tab bar

Changes:
- Keep only the most-used student tabs visible
- Move secondary screens under Home or Profile
- Make Planner and Schedule clearly distinct in purpose

Target files:
- `app/(tabs)/_layout.js`

Status:
- Implemented in this iteration

### Step 4. Unify planner and tasks

Goal:
- Make students feel that plan items and tasks belong to one academic workflow

Changes:
- Show clearer planner-linked task indicators
- Add stronger `Plan -> task -> done` feedback
- Reduce duplicate terminology across Planner and Task Manager

Target files:
- `app/(tabs)/CalendarPlannerScreen.js`
- `app/(tabs)/TaskManagerScreen.js`
- `utils/plannerTaskSync.js`

Status:
- Implemented in this iteration

### Step 5. Improve fast capture and fast completion

Goal:
- Minimize friction for common student actions

Changes:
- Add better quick-add defaults
- Add clearer one-tap completion and snooze flows
- Keep due date/time choices obvious and fast

Target files:
- `app/(tabs)/TaskManagerScreen.js`
- `context/NotificationContext.js`

Status:
- Implemented in this iteration for quick-add defaults and task snooze in `TaskManagerScreen`
- Notification scheduling reused the existing reschedule path, so no direct `NotificationContext` change was required

### Step 6. Run student usability validation

Goal:
- Replace opinion with measured feedback

Changes:
- Test 5 to 10 representative students
- Record completion rate, time, confusion points, and feature usefulness
- Write results into `docs/Research-Evaluation.md`

Status:
- Validation kit prepared in `docs/Student-Usability-Validation-Kit.md`
- Raw data template prepared in `docs/Student-Usability-Results-Template.csv`
- Summary template prepared in `docs/Student-Usability-Summary-Template.md`
- Still pending: actual participant sessions and recorded results

## Working Rule

Only one UX step should change at a time. After each step:

1. Refactor or improve one workflow
2. Run lint and tests
3. Verify the screen manually
4. Record the next issue before moving on
