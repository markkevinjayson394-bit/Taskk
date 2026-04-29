# Full-Screen Intent Permission (Alarm Popups) Support

## Steps:

- [ ] 1. Edit `utils/nativeAlarm.js`: Add Alert import + 3 new exported functions (canUseFullScreenIntent, openFullScreenIntentSettings, checkAlarmPopupPermission)
- [ ] 2. Integrate `await checkAlarmPopupPermission();` call at first alarm enable point (e.g. utils/deadlineAlarmBackground.js bootstrapDeadlineAlarmChannel())
- [ ] 3. Test: Run app on Android, check permission prompt/settings open
- [ ] 4. Mark complete

**Status:** In progress
