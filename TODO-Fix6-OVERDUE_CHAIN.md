# TODO: Fix 6 — Align OVERDUE_CHAIN between files

- [x] Step 1: Add `OVERDUE_CHAIN` export to `utils/deadlineConstants.js`
- [x] Step 2: Edit `utils/taskOverdueState.js` (import, remove local def, update `.key` → `.stage`)
- [x] Step 3: Edit `components/useDeadlineAlarmScheduler.jsx` (import, derive `OVERDUE_THRESHOLDS` from `OVERDUE_CHAIN`)
- [x] Step 4: Update root TODO.md (mark Fix 6 ✅)
- [x] Step 5: Test overdue advancement and scheduler detection
