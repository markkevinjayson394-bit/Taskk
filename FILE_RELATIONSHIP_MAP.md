# Time Management App — File Relationship Map

> **Purpose:** Understand which files depend on each other so you can fix/test in logical groups.

---

## 📊 Group Overview

| #   | Group                   | Files                        | Risk Level |
| --- | ----------------------- | ---------------------------- | ---------- |
| 1   | **Root / App Shell**    | `app/_layout.jsx`            | 🔴 High    |
| 2   | **Auth Flow**           | `app/(auth)/*`               | 🟡 Medium  |
| 3   | **Student Tab Screens** | `app/(tabs)/*`               | 🔴 High    |
| 4   | **Admin Screens**       | `app/(admin)/*`              | 🟡 Medium  |
| 5   | **Shared Components**   | `components/*`               | 🟡 Medium  |
| 6   | **React Contexts**      | `context/*`                  | 🔴 High    |
| 7   | **Utilities**           | `utils/*`                    | 🔴 High    |
| 8   | **Feature Modules**     | `features/tab-modules/*`     | 🟢 Low     |
| 9   | **Configuration**       | `config/*`, `constants/*`    | 🟡 Medium  |
| 10  | **Hooks**               | `hooks/*`                    | 🟢 Low     |
| 11  | **Tests**               | `__tests__/*`, `__mocks__/*` | 🟡 Medium  |

---

## 1️⃣ ROOT / APP SHELL

### Files

- `app/_layout.jsx` — Root layout, auth bootstrap, OTA updates, Sentry, notification routing
- `app/index.jsx` — Entry redirect
- `app/eula.jsx` — EULA screen
- `app/tutorial.jsx` — Onboarding tutorial
- `app/+not-found.jsx` — 404 screen
- `app/modal.tsx` — Shared modal wrapper

### Dependency Graph

```
app/_layout.jsx
├── config/firebase.js          ← app, auth, db, isFirebaseConfigured
├── context/ThemeContext.jsx    ← ThemeProvider
├── utils/logger.js             ← errorIfDev, reportError, reportWarning, warnIfDev
├── utils/deadlineAlarmBackground.js ← bootstrapDeadlineAlarmChannel, DEADLINE_NOTIF_TYPE
├── utils/onboarding.js         ← hasCompletedOnboarding, getTutorialRoute, getPostOnboardingRoute
│   └── utils/logger.js         ← warnIfDev
│   └── constants/academics.js  ← getCollegeLabel
├── expo-router (Stack, useRouter)
├── expo-updates
├── expo-notifications
├── expo-constants
├── @sentry/react-native
├── @react-native-async-storage/async-storage
└── react-native-safe-area-context
```

### 🔗 Affected By

| If you change...                   | These break...                         |
| ---------------------------------- | -------------------------------------- |
| `config/firebase.js`               | **Everything** — auth, DB, all screens |
| `context/ThemeContext.jsx`         | All UI rendering (colors, dark mode)   |
| `utils/logger.js`                  | Error reporting across entire app      |
| `utils/deadlineAlarmBackground.js` | Notification channel bootstrapping     |
| `utils/onboarding.js`              | Initial route logic (new users)        |

### 🔗 Affects

- All child routes: `(auth)`, `(tabs)`, `(admin)`, `tutorial`, `eula`

---

## 2️⃣ AUTH FLOW

### Files

- `app/(auth)/_layout.jsx` — Auth stack layout
- `app/(auth)/login.jsx` — Login screen
- `app/(auth)/register.jsx` — Registration screen

### Dependency Graph

```
app/(auth)/_layout.jsx
├── hooks/useAndroidBackNavigation.jsx
└── react-native-safe-area-context

app/(auth)/login.jsx
├── config/firebase.js          ← auth, db, isFirebaseConfigured
└── react-native-safe-area-context

app/(auth)/register.jsx
├── config/firebase.js          ← auth, db, isFirebaseConfigured
└── react-native-safe-area-context
```

### 🔗 Affected By

| If you change...                     | These break...               |
| ------------------------------------ | ---------------------------- |
| `config/firebase.js`                 | Auth flow completely broken  |
| `hooks/useAndroidBackNavigation.jsx` | Back button behavior in auth |

### 🔗 Affects

- `app/_layout.jsx` — redirects here when no user
- `(tabs)` and `(admin)` — only accessible after auth success

---

## 3️⃣ STUDENT TAB SCREENS

### Files

- `app/(tabs)/_layout.jsx` — Tab bar layout, FAB, providers
- `app/(tabs)/home.jsx` — Home dashboard
- `app/(tabs)/schedule.jsx` — Schedule viewer
- `app/(tabs)/CalendarPlannerScreen.jsx` — Calendar/planner
- `app/(tabs)/TaskManagerScreen.jsx` — Task manager
- `app/(tabs)/assignments.jsx` — Assignments list
- `app/(tabs)/subjects.jsx` — Subjects view
- `app/(tabs)/ExamPrepPlanner.jsx` — Exam prep
- `app/(tabs)/profile.jsx` — User profile
- `app/(tabs)/review.jsx` — Reviews/feedback
- `app/(tabs)/NotificationSettings.jsx` — Notification settings
- `app/(tabs)/AnnouncementsScreen.jsx` — Announcements

### Dependency Graph — Tab Layout

```
app/(tabs)/_layout.jsx
├── context/NotificationContext.jsx   ← NotificationProvider
├── context/OfflineContext.jsx        ← OfflineProvider
├── context/ThemeContext.jsx          ← useTheme
├── hooks/useAndroidBackNavigation.jsx
├── utils/logger.js                   ← warnIfDev
├── utils/deadlineAlarmBackground.js  ← bootstrapDeadlineAlarmChannel
└── components/DeadlineAlarmModal.jsx ← DeadlineAlarmModal (inline import for types/docs)
```

### Dependency Graph — Home Screen

```
app/(tabs)/home.jsx
├── components/EmptyStateCard.jsx
├── components/LoadingState.jsx
├── config/firebase.js               ← auth, db
├── context/NotificationContext.jsx  ← useNotifications
├── context/OfflineContext.jsx       ← OfflineBanner, useOffline
├── context/ThemeContext.jsx         ← useTheme
├── features/tab-modules/home.helpers.jsx
├── utils/academicTaskModel.js       ← buildTaskCompletionUpdate
├── utils/assignmentNotifications.js ← cancelAssignmentNotifications
├── utils/deadlineTime.js            ← formatDeadlineCountdown
├── utils/logger.js                  ← reportError, reportWarning
├── utils/scheduleMatcher.js         ← findBestScheduleDoc
└── react-native-safe-area-context
```

### Dependency Graph — Schedule Screen

```
app/(tabs)/schedule.jsx
├── components/EmptyStateCard.jsx
├── components/OfflineBanner.jsx
├── config/firebase.js               ← auth, db
├── context/OfflineContext.jsx       ← useOffline
├── context/ThemeContext.jsx         ← useTheme
├── utils/academicTaskModel.js       ← buildSubjectIdFromName
├── utils/scheduleMatcher.js         ← findBestScheduleDoc
└── react-native-safe-area-context
```

### Dependency Graph — Task Manager

```
app/(tabs)/TaskManagerScreen.jsx
├── components/EmptyStateCard.jsx
├── components/OfflineBanner.jsx
├── components/task-manager/TaskEditorModal.jsx
├── config/firebase.js               ← auth, db
├── context/NotificationContext.jsx  ← useNotifications
├── context/OfflineContext.jsx       ← OfflineBanner, useOffline
├── context/ThemeContext.jsx         ← useTheme
├── utils/academicTaskModel.js
├── utils/assignmentNotifications.js ← cancelAssignmentNotifications
├── utils/deadlineAlarmBackground.js
├── utils/logger.js                  ← reportError, reportWarning, warnIfDev
├── utils/scheduleMatcher.js         ← findBestScheduleDoc
└── react-native-safe-area-context
```

### Dependency Graph — Calendar Planner

```
app/(tabs)/CalendarPlannerScreen.jsx
├── config/firebase.js               ← auth
├── context/NotificationContext.jsx  ← useNotifications
├── context/ThemeContext.jsx         ← useTheme
├── utils/deadlineTime.js            ← formatDeadlineCountdown
├── utils/nativeAlarm.js             ← native alarm functions
├── utils/plannerTaskSync.js         ← syncCalendarDayPlans
├── utils/logger.js                  ← warnIfDev
├── components/DeadlineAlarmModal.jsx
└── react-native-safe-area-context
```

### Dependency Graph — Other Tab Screens

```
app/(tabs)/assignments.jsx
├── utils/academicTaskModel.js, utils/assignmentNotifications.js, utils/deadlineTime.js
app/(tabs)/subjects.jsx
├── utils/academicTaskModel.js
app/(tabs)/ExamPrepPlanner.jsx
├── config/firebase.js
app/(tabs)/profile.jsx
├── utils/version.js                 ← APP_VERSION
app/(tabs)/review.jsx
├── constants/academics.js           ← getCollegeLabel
app/(tabs)/NotificationSettings.jsx
├── context/NotificationContext.jsx
app/(tabs)/AnnouncementsScreen.jsx
├── components/EmptyStateCard.jsx, components/OfflineBanner.jsx
```

### 🔗 Cross-Cutting Dependencies (ALL Tab Screens)

| File                              | Used By                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `context/ThemeContext.jsx`        | **ALL 12 tab screens**                                                   |
| `context/OfflineContext.jsx`      | home, schedule, assignments, subjects, TaskManager, Announcements        |
| `context/NotificationContext.jsx` | home, TaskManager, CalendarPlanner, NotificationSettings                 |
| `config/firebase.js`              | **ALL tab screens**                                                      |
| `utils/logger.js`                 | home, TaskManager, CalendarPlanner                                       |
| `components/EmptyStateCard.jsx`   | home, schedule, TaskManager, assignments, CalendarPlanner, Announcements |
| `components/OfflineBanner.jsx`    | schedule, assignments, TaskManager, Announcements, subjects              |

### 🔗 Feature Modules Used by Tabs

| Tab Screen                  | Feature Module                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `home.jsx`                  | `features/tab-modules/home.helpers.jsx`                                                          |
| `schedule.jsx`              | `features/tab-modules/schedule.components.jsx`, `schedule.helpers.jsx`                           |
| `CalendarPlannerScreen.jsx` | `features/tab-modules/CalendarPlannerScreen.components.jsx`, `CalendarPlannerScreen.helpers.jsx` |
| `TaskManagerScreen.jsx`     | `features/tab-modules/TaskManagerScreen.components.jsx`, `TaskManagerScreen.helpers.jsx`         |

---

## 4️⃣ ADMIN SCREENS

### Files

- `app/(admin)/_layout.jsx` — Admin stack layout
- `app/(admin)/home.jsx` — Admin dashboard
- `app/(admin)/announcements.jsx` — Manage announcements
- `app/(admin)/createSchedule.jsx` — Create schedule
- `app/(admin)/viewSchedules.jsx` — View schedules
- `app/(admin)/WeeklySchedule.jsx` — Weekly schedule editor
- `app/(admin)/students.jsx` — Student list
- `app/(admin)/reviews.jsx` — Review submissions

### Dependency Graph

```
app/(admin)/announcements.jsx
├── components/admin-announcements/AnnouncementComposerTab.jsx
├── components/admin-announcements/AnnouncementHeader.jsx
├── components/admin-announcements/AnnouncementManageTab.jsx
├── config/firebase.js
└── context/ThemeContext.jsx

app/(admin)/createSchedule.jsx
├── components/admin-schedule/ScheduleActionBar.jsx
├── components/admin-schedule/ScheduleClonePanel.jsx
├── components/admin-schedule/ScheduleDetailsSection.jsx
├── components/admin-schedule/ScheduleValidationAlerts.jsx
├── components/admin-schedule/ScheduleDaySection.jsx
├── constants/academics.js
├── config/firebase.js
└── context/ThemeContext.jsx

app/(admin)/viewSchedules.jsx
├── components/admin-schedule/ScheduleBrowseCard.jsx
├── components/admin-schedule/ScheduleBrowseHeader.jsx
├── components/admin-schedule/ScheduleFiltersBar.jsx
├── utils/adminScheduleBrowse.js
├── utils/scheduleHelpers.js
├── constants/academics.js, constants/courseColors.js
└── context/ThemeContext.jsx

app/(admin)/WeeklySchedule.jsx
├── components/InputField.jsx
├── constants/academics.js
├── context/ThemeContext.jsx
└── utils/adminSchedule.js ← DEFAULT_SCHOOL_YEAR

app/(admin)/reviews.jsx
├── constants/academics.js ← getCollegeLabel
├── utils/logger.js ← warnIfDev
└── context/ThemeContext.jsx
```

### 🔗 Affected By

| If you change...                   | Admin Screens Broken                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `components/admin-announcements/*` | `announcements.jsx`                                                            |
| `components/admin-schedule/*`      | `createSchedule.jsx`, `viewSchedules.jsx`                                      |
| `utils/adminSchedule.js`           | `WeeklySchedule.jsx`, `viewSchedules.jsx`                                      |
| `utils/adminScheduleBrowse.js`     | `viewSchedules.jsx`                                                            |
| `utils/scheduleHelpers.js`         | `viewSchedules.jsx`                                                            |
| `constants/academics.js`           | `createSchedule.jsx`, `viewSchedules.jsx`, `WeeklySchedule.jsx`, `reviews.jsx` |

---

## 5️⃣ SHARED COMPONENTS

### Files by Subgroup

#### UI Primitives

- `components/themed-view.tsx`
- `components/themed-text.tsx`
- `components/haptic-tab.tsx`
- `components/hello-wave.tsx`
- `components/external-link.tsx`
- `components/parallax-scroll-view.tsx`
- `components/ui/collapsible.tsx`
- `components/ui/icon-symbol.tsx` / `icon-symbol.ios.tsx`

#### Common Components

- `components/EmptyStateCard.jsx` — Used by **6+ screens**
- `components/LoadingState.jsx` — Uses `context/ThemeContext.jsx`
- `components/OfflineBanner.jsx` — Uses `context/OfflineContext.jsx`, `context/ThemeContext.jsx`
- `components/ErrorBoundary.jsx` — Uses `utils/logger.js`
- `components/UpdateBanner.jsx` — Uses `utils/logger.js`
- `components/SectionCard.jsx`
- `components/InputField.jsx`

#### Task / Deadline Components

- `components/DeadlineAlarmModal.jsx` — Uses `./DeadlineAlarmModal.helpers.jsx`, `./useDeadlineAlarmScheduler.jsx`
- `components/DeadlineAlarmModal.helpers.jsx` — Uses `utils/logger.js`
- `components/useDeadlineAlarmScheduler.jsx` — Uses `./DeadlineAlarmModal.helpers.jsx`, `utils/logger.js`
- `components/task-manager/TaskEditorModal.jsx`

#### Admin Components

- `components/admin-announcements/AnnouncementComposerTab.jsx` — Uses `constants/academics.js`
- `components/admin-announcements/AnnouncementHeader.jsx`
- `components/admin-announcements/AnnouncementManageTab.jsx`
- `components/admin-schedule/ScheduleActionBar.jsx`
- `components/admin-schedule/ScheduleBrowseCard.jsx`
- `components/admin-schedule/ScheduleBrowseHeader.jsx`
- `components/admin-schedule/ScheduleClonePanel.jsx`
- `components/admin-schedule/ScheduleDaySection.jsx`
- `components/admin-schedule/ScheduleDetailsSection.jsx`
- `components/admin-schedule/ScheduleFiltersBar.jsx`
- `components/admin-schedule/ScheduleValidationAlerts.jsx`

### 🔗 Impact Analysis

| Component                       | Used By                                                                  | If Changed, Fix...           |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `EmptyStateCard.jsx`            | home, schedule, TaskManager, assignments, CalendarPlanner, Announcements | All those screens            |
| `LoadingState.jsx`              | home                                                                     | home.jsx                     |
| `OfflineBanner.jsx`             | schedule, assignments, TaskManager, subjects, Announcements              | Those 5 screens              |
| `ErrorBoundary.jsx`             | (wrapped in \_layout)                                                    | Entire app error handling    |
| `DeadlineAlarmModal.jsx`        | CalendarPlannerScreen, \_layout (notification routing)                   | CalendarPlanner, root layout |
| `useDeadlineAlarmScheduler.jsx` | DeadlineAlarmModal.jsx                                                   | DeadlineAlarmModal           |
| `AnnouncementComposerTab.jsx`   | admin/announcements.jsx                                                  | Admin announcements          |
| `ScheduleActionBar.jsx`         | admin/createSchedule.jsx                                                 | Admin createSchedule         |

---

## 6️⃣ REACT CONTEXTS (🔴 High Risk)

### Files

- `context/ThemeContext.jsx` — Dark/light mode, colors
- `context/NotificationContext.jsx` — All notification logic
- `context/OfflineContext.jsx` — Network state, caching

### Dependency Graph

```
context/ThemeContext.jsx
└── utils/logger.js          ← warnIfDev

context/NotificationContext.jsx
├── config/firebase.js       ← auth, db
├── utils/academicTaskModel.js    ← buildTaskCompletionUpdate
├── utils/backgroundAlarmChecker.js ← startBackgroundAlarmChecker, BACKGROUND_ALARM_TASK
├── utils/deadlineAlarmBackground.js ← rescheduleAllDeadlineAlarms, THRESHOLDS
├── utils/deadlineTime.js    ← formatDeadlineCountdown
├── utils/logger.js          ← reportError, reportWarning, warnIfDev
├── utils/nativeAlarm.js     ← scheduleNativeAlarm, cancelNativeAlarmByScheduledId, etc.
├── utils/scheduleMatcher.js ← findBestScheduleDoc
└── context/OfflineContext.jsx    ← CACHE_KEYS, loadFromCache, saveToCache

context/OfflineContext.jsx
├── config/firebase.js       ← auth
└── utils/logger.js          ← reportWarning, warnIfDev
```

### 🔗 Impact Analysis

| Context                   | Consumers                                                                                          | If Changed, Fix...        |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| `ThemeContext.jsx`        | **Every screen + component**                                                                       | Entire app UI             |
| `NotificationContext.jsx` | home, TaskManager, CalendarPlanner, NotificationSettings, tab layout                               | All notification features |
| `OfflineContext.jsx`      | tab layout, home, schedule, assignments, subjects, TaskManager, Announcements, NotificationContext | Offline behavior, cache   |

---

## 7️⃣ UTILITIES (🔴 High Risk)

### Files by Subgroup

#### Core / Infrastructure

- `utils/logger.js` — **Used by 20+ files**
- `utils/version.js` — `APP_VERSION` constant
- `utils/test-utils.jsx` — Test wrappers using `context/ThemeContext.jsx`

#### Firebase / Data

- `utils/academicTaskModel.js` — Task normalization, validation
  - Used by: home, TaskManager, assignments, NotificationContext
- `utils/plannerStorage.js` — Planner data persistence
  - Uses: `config/firebase.js`, `utils/logger.js`
- `utils/plannerTaskSync.js` — Sync planner tasks
  - Uses: `config/firebase.js`, `utils/dateHelpers.js`, `utils/logger.js`

#### Schedule

- `utils/scheduleMatcher.js` — Find best schedule document
  - Uses: `constants/academics.js`, `utils/logger.js`
  - Used by: home, schedule, TaskManager, NotificationContext
- `utils/scheduleHelpers.js` — Text/year normalization
  - Used by: adminScheduleBrowse, viewSchedules
- `utils/adminSchedule.js` — Admin schedule operations
  - Used by: WeeklySchedule.jsx, adminScheduleBrowse
- `utils/adminScheduleBrowse.js` — Browse/filter schedules
  - Uses: `utils/scheduleHelpers.js`, `constants/courseColors.js`

#### Notifications / Alarms

- `utils/assignmentNotifications.js` — Assignment notification scheduling
  - Uses: `config/firebase.js`, `utils/nativeAlarm.js`, `utils/logger.js`
- `utils/deadlineAlarmBackground.js` — Background deadline alarms
  - Uses: `utils/nativeAlarm.js`, `utils/logger.js`
  - Used by: \_layout, tabs layout, TaskManager, NotificationContext
- `utils/backgroundAlarmChecker.js` — Background task checker
  - Uses: `config/firebase.js`, `utils/deadlineAlarmBackground.js`, `utils/logger.js`
- `utils/nativeAlarm.js` — Native Android alarms
  - Uses: `utils/logger.js`
  - Used by: assignmentNotifications, deadlineAlarmBackground, NotificationContext, CalendarPlanner
- `utils/deadlineTime.js` — Countdown formatting
  - Used by: CalendarPlanner, TaskManager, assignments, home, NotificationContext

#### Date / Time

- `utils/dateHelpers.js` — Date manipulation
  - Used by: plannerTaskSync, workloadCalculator

#### Workload / Analytics

- `utils/workloadCalculator.js` — Daily workload calculation
  - Uses: `utils/dateHelpers.js`
  - Used by: TaskManagerScreen.helpers.jsx

#### Onboarding

- `utils/onboarding.js` — Onboarding flow logic
  - Uses: `utils/logger.js`, `constants/academics.js`
  - Used by: app/\_layout.jsx

#### Admin Announcements

- `utils/adminAnnouncements.js` — Admin announcement operations
  - Uses: `constants/academics.js`

### 🔗 Cross-Util Dependencies

```
utils/logger.js
  └── (no internal deps — leaf node, but highest impact)

utils/nativeAlarm.js
  └── utils/logger.js

utils/deadlineAlarmBackground.js
  ├── utils/nativeAlarm.js
  └── utils/logger.js

utils/assignmentNotifications.js
  ├── config/firebase.js
  ├── utils/nativeAlarm.js
  └── utils/logger.js

utils/scheduleMatcher.js
  ├── constants/academics.js
  └── utils/logger.js

utils/plannerTaskSync.js
  ├── config/firebase.js
  ├── utils/dateHelpers.js
  └── utils/logger.js
```

---

## 8️⃣ FEATURE MODULES

### Files

- `features/tab-modules/home.helpers.jsx`
- `features/tab-modules/schedule.components.jsx` / `schedule.helpers.jsx`
- `features/tab-modules/CalendarPlannerScreen.components.jsx` / `CalendarPlannerScreen.helpers.jsx`
- `features/tab-modules/TaskManagerScreen.components.jsx` / `TaskManagerScreen.helpers.jsx`

### Dependency Graph

```
features/tab-modules/home.helpers.jsx
  ← (self-contained helpers, no project imports found)

features/tab-modules/schedule.components.jsx
  ├── components/EmptyStateCard.jsx
  └── context/ThemeContext.jsx

features/tab-modules/schedule.helpers.jsx
  ← (self-contained)

features/tab-modules/CalendarPlannerScreen.helpers.jsx
  └── utils/deadlineTime.js ← formatDeadlineCountdown

features/tab-modules/TaskManagerScreen.components.jsx
  └── utils/deadlineTime.js ← formatDeadlineCountdown

features/tab-modules/TaskManagerScreen.helpers.jsx
  ├── utils/academicTaskModel.js
  └── utils/workloadCalculator.js ← calculateDailyWorkload
```

### 🔗 Impact

| Feature Module                      | Used By                                | Risk                             |
| ----------------------------------- | -------------------------------------- | -------------------------------- |
| `home.helpers.jsx`                  | `app/(tabs)/home.jsx`                  | Low                              |
| `schedule.components.jsx`           | `app/(tabs)/schedule.jsx`              | Low                              |
| `CalendarPlannerScreen.helpers.jsx` | `app/(tabs)/CalendarPlannerScreen.jsx` | Low                              |
| `TaskManagerScreen.helpers.jsx`     | `app/(tabs)/TaskManagerScreen.jsx`     | Medium (uses workloadCalculator) |

---

## 9️⃣ CONFIGURATION & CONSTANTS

### Files

- `config/firebase.js` — Firebase app init
  - **Used by:** \_layout, all auth, all tabs, all admin, NotificationContext, OfflineContext, plannerStorage, plannerTaskSync, assignmentNotifications, backgroundAlarmChecker, adminAnnouncements, adminScheduleBrowse
- `constants/academics.js` — College/course constants, `getCollegeLabel`
  - **Used by:** createSchedule, viewSchedules, WeeklySchedule, reviews, adminAnnouncements, AnnouncementComposerTab, scheduleMatcher, onboarding
- `constants/courseColors.js` — Course color mapping
  - **Used by:** viewSchedules, adminScheduleBrowse
- `constants/theme.ts` — Theme constants

---

## 🔟 HOOKS

### Files

- `hooks/useAndroidBackNavigation.jsx` — Android back button handling
  - **Used by:** auth layout, tabs layout, admin layout
- `hooks/use-theme-color.ts` — Theme-aware colors
- `hooks/use-color-scheme.ts` / `use-color-scheme.web.ts` — System theme detection

---

## 1️⃣1️⃣ TESTS

### Files

- `__mocks__/expo-router.js` — Router mock
- `__tests__/navigation/authFlow.test.js` — Tests auth routing
  - Uses: `utils/test-utils.jsx`, `app/_layout.jsx`
- `__tests__/screens/home.test.js` — Tests home screen
  - Uses: `utils/test-utils.jsx`, `app/(tabs)/home.jsx`
- `__tests__/screens/tutorial.test.js` — Tests tutorial
  - Uses: `utils/test-utils.jsx`, `app/tutorial.jsx`
- `__tests__/components/DeadlineAlarmModal.test.js`
  - Uses: `utils/test-utils.jsx`
- `__tests__/utils/adminAnnouncements.test.js`
- `__tests__/utils/adminSchedule.test.js`
- `__tests__/utils/adminScheduleBrowse.test.js`
- `__tests__/utils/plannerTaskSync.test.js`
- `__tests__/utils/workloadCalculator.test.js`

### Test Utilities

```
utils/test-utils.jsx
└── context/ThemeContext.jsx ← ThemeProvider
```

---

## 🎯 Fix Groups (Recommended Workflow)

When fixing a bug, work in this order:

### Group A: Infrastructure (Fix First)

1. `config/firebase.js`
2. `utils/logger.js`
3. `context/ThemeContext.jsx`
4. `context/OfflineContext.jsx`

> **Why:** These are leaf dependencies with the highest blast radius. A bug here breaks everything.

### Group B: Notification System

1. `utils/nativeAlarm.js`
2. `utils/deadlineAlarmBackground.js`
3. `utils/assignmentNotifications.js`
4. `utils/backgroundAlarmChecker.js`
5. `context/NotificationContext.jsx`
6. `components/DeadlineAlarmModal.jsx` + helpers

> **Why:** Deep dependency chain. `nativeAlarm` → `deadlineAlarmBackground` → `NotificationContext` → screens.

### Group C: Task / Assignment Core

1. `utils/academicTaskModel.js`
2. `utils/deadlineTime.js`
3. `utils/scheduleMatcher.js`
4. `utils/plannerTaskSync.js`
5. `app/(tabs)/home.jsx`
6. `app/(tabs)/TaskManagerScreen.jsx`
7. `app/(tabs)/assignments.jsx`

### Group D: Schedule System

1. `constants/academics.js`
2. `utils/scheduleHelpers.js`
3. `utils/scheduleMatcher.js`
4. `utils/adminSchedule.js`
5. `utils/adminScheduleBrowse.js`
6. `app/(tabs)/schedule.jsx`
7. `app/(admin)/createSchedule.jsx`, `viewSchedules.jsx`, `WeeklySchedule.jsx`

### Group E: Admin Components

1. `components/admin-schedule/*`
2. `components/admin-announcements/*`
3. `app/(admin)/*` screens

### Group F: Feature Modules (Safest to Change)

1. `features/tab-modules/*`

> These have the narrowest scope and lowest risk.

---

## 📋 Quick Reference: "If I change X, test Y"

| Change This File                    | Must Test These                                               |
| ----------------------------------- | ------------------------------------------------------------- |
| `config/firebase.js`                | Entire app (auth, all screens)                                |
| `utils/logger.js`                   | Entire app                                                    |
| `context/ThemeContext.jsx`          | All screens and components                                    |
| `context/NotificationContext.jsx`   | home, TaskManager, CalendarPlanner, NotificationSettings      |
| `context/OfflineContext.jsx`        | All screens using OfflineBanner, NotificationContext          |
| `utils/academicTaskModel.js`        | home, TaskManager, assignments, NotificationContext           |
| `utils/nativeAlarm.js`              | CalendarPlanner, NotificationContext, deadlineAlarmBackground |
| `utils/deadlineAlarmBackground.js`  | \_layout, TaskManager, NotificationContext                    |
| `utils/scheduleMatcher.js`          | home, schedule, TaskManager, NotificationContext              |
| `constants/academics.js`            | Admin screens, schedule screens, reviews                      |
| `components/EmptyStateCard.jsx`     | home, schedule, TaskManager, assignments, CalendarPlanner     |
| `components/DeadlineAlarmModal.jsx` | CalendarPlanner, \_layout notification routing                |
| `app/_layout.jsx`                   | Entire app bootstrap, auth flow                               |
| `app/(tabs)/_layout.jsx`            | All tab screens, FAB, back navigation                         |
| `features/tab-modules/*`            | The specific parent screen only                               |
