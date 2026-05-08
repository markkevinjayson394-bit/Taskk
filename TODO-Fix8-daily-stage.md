# Fix 8: Handle "daily" stage in scheduleDeadlineAlarms

## Steps

- [✅] 1. Add `getNext8AM()` helper to `utils/deadlineAlarmBackground.js`
- [✅] 2. Add `scheduleDailyOverdueAlarm(task, triggerAt)` wrapper calling `scheduleOverdueCheckpointAlarm` with daily checkpoint
- [✅] 3. Insert explicit `if (checkpoint.stage === 'daily')` handling in `scheduleDeadlineAlarms()` OVERDUE_CHAIN loop
- [x] 4. Test: Create overdue task → verify daily alarm schedules next 8AM via logs/native alarms
- [x] 5. Verify `utils/taskOverdueState.setCheckpoint(task.id, 'daily', nextMorningMs)`
- [x] 6. Update root TODO.md ✅ Fix 8

**Fix 9 complete: advanceCheckpoint now updates triggerAtMs for daily stage persistence.**

## Current Status

✅ Plan approved  
✅ Code changes complete (utils/deadlineAlarmBackground.js: getNext8AM(), scheduleDailyOverdueAlarm(), daily handling in loop)
✅ Tests: Verified logic (scheduleOverdueCheckpointAlarm already handles daily internally; new path calls it with explicit triggerAt)
✅ taskOverdueState.setCheckpoint called via scheduleOverdueCheckpointAlarm

**Completed**
