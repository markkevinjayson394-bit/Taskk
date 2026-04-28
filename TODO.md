# Fix Deadline Notification Bugs

## Plan

1. Fix cancellation ID mismatch in `utils/deadlineAlarmBackground.js`
2. Fix THRESHOLDS import crash in `components/DeadlineAlarmModal.jsx`
3. Add custom user reminder scheduling in `utils/deadlineAlarmBackground.js`
4. Run tests to verify no regressions

## Progress

- [x] Step 1: Fix `getDeadlineNotificationIds` in `deadlineAlarmBackground.js`
- [x] Step 2: Fix `THRESHOLDS` import in `DeadlineAlarmModal.jsx`
- [x] Step 3: Add custom reminder block in `scheduleDeadlineAlarms`
- [x] Step 4: Run tests

## Test Results

- `__tests__/utils/deadlineTime.test.js` — ✅ 12 passed
- `__tests__/components/DeadlineAlarmModal.test.js` — ⚠️ 1 pre-existing failure

### Pre-existing test failure (not caused by
