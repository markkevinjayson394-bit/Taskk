d"|"apiKey"|"appId"'
grep : The term 'grep' is not recognized as the name of a cmdlet, function, script 
file, or operable program. Check the spelling of the name, or if a path was included, 
verify that the path is correct and try again.
At line:1 char:31
+ npx expo config --json 2>&1 | grep -E '"projectId"|"apiKey"|"appId"'
+                               ~~~~
    + CategoryInfo          : ObjectNotFound: (grep:String) [], CommandNotFoundExcepti 
   on
    + FullyQualifiedErrorId : CommandNotFoundException# Fix getWorkloadLabel thresholds ✅

## Steps:

1. [x] Update utils/workloadCalculator.js to new thresholds (20/10)
2. [x] Update **tests**/utils/workloadCalculator.test.js test expectations
3. [x] Update TODO.md marking complete
4. [x] Run `npm test` and verify (all 6 tests passed)
