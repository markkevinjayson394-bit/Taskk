# Fix parseTimeToMinutes ISO String Bug

## Steps

- [x] 1. Analyze bug in `parseTimeToMinutes` (only handles "HH:MM", not ISO strings)
- [x] 2. Update `utils/parsing.js` - modify `parseTimeToMinutes` to detect and parse ISO date strings
- [x] 3. Update `__tests__/utils/scheduleHelpers.test.js` - add tests for ISO string parsing and `getClassRangeMinutes`
- [x] 4. Run tests to verify the fix
