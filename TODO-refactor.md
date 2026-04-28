# Full App Modularization Plan

## Current Status (updated 2026-04-22)

### Done ✅

| File | Main file | Helper file | Component file | Actually wired up? |
|------|-----------|-------------|-----------------|-------------------|
| TaskManagerScreen.js | 2637 lines | 435 lines ✅ | 578 lines ✅ | ✅ Yes |
| home.js | 2089 lines | 136 lines ✅ | - | ⚠️ Partial (only `safeParseObject`) |
| schedule.js | 566 lines | 290 lines ✅ | 1071 lines ✅ | ✅ Yes |
| DeadlineAlarmModal.js | - | 107 lines ✅ | - | N/A (utility) |

### In Progress 🚧

| File | Main file | Status |
|------|-----------|--------|
| CalendarPlannerScreen.js | 2299 lines | ❌ Helper/component exist but NOT imported |
| assignments.js | 1383 lines | ❌ No helpers extracted |

### Not Started 📋

| File | Size | Priority |
|------|------|----------|
| ExamPrepPlanner.js | 1578 lines | Medium |
| NotificationSettings.js | 1903 lines | Low |
| profile.js | 1028 lines | Low |
| AnnouncementsScreen.js | 451 lines | Medium |
| review.js | 287 lines | Low |
| subjects.js | 627 lines | Low |

## Plan per File

### 1. CalendarPlannerScreen.js — highest priority
- Extract helpers (`CalendarPlannerScreen.helpers.js`) exist in `features/tab-modules/` but **not imported** in the screen
- Need to wire up the imports and move logic out
- Estimated reduction: ~500 lines

### 2. assignments.js — second priority
- 1383 lines, no helper/component files
- Pattern: create `assignments.helpers.js` and `assignments.components.js`

### 3. ExamPrepPlanner.js
- 1578 lines, no helpers

### 4. NotificationSettings.js
- 1903 lines, no helpers

### 5. profile.js
- 1028 lines, no helpers

### 6. AnnouncementsScreen.js
- 451 lines, no helpers (but already smallish)

### 7. review.js + subjects.js
- Small files, lower impact

## Progress: 3/10 screens fully modularized