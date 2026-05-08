# TODO

## Alarm modal cold-launch from notification tap (Home tab)

- [ ] Update `app/(tabs)/home.recovered.jsx`:
  - [ ] Import `useLocalSearchParams` from `expo-router`.
  - [ ] Import `getPendingAlarmAction` and `clearPendingAlarmAction` from `utils/nativeAlarm`.
  - [ ] Add route-param effect: when `showAlarm === "1"` + `focusTaskId`, call `showAlarmForTask(task, null)`.
  - [ ] Add cold-launch effect: call `getPendingAlarmAction()`, find task in `upcomingAssignments`, call `showAlarmForTask`, then `clearPendingAlarmAction()`.
- [ ] Run tests / lint (if available) to ensure no syntax errors.
