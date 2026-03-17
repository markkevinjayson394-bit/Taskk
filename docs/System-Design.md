# CTU Danao Time Manager - System Design Documentation

Date: March 15, 2026

## 1) Output / System Design

### 1.1 Architecture Overview
- Client: Expo React Native app using Expo Router for navigation.
- Backend: Firebase Auth for authentication and Firestore for data storage.
- Local: AsyncStorage for caching and offline queues.
- Notifications: Expo Notifications (scheduled reminders and announcements).
- Device Usage: Android AppUsageModule for usage insights (Android only).

```mermaid
flowchart LR
  Student["Student"] --> App["CTU Danao Time Manager (Expo React Native App)"]
  Admin["Admin"] --> App
  App --> Router["Expo Router (role-gated routes)"]
  App --> Theme["Theme Context (light/dark)"]
  App --> Offline["Offline Context (NetInfo + cache)"]
  App --> Notif["Notification Engine (expo-notifications)"]
  App --> Usage["Android AppUsageModule"]
  App --> Auth["Firebase Auth"]
  App --> DB["Firestore"]
  App --> Storage["AsyncStorage (cache + queues)"]
  DB --> Users["users"]
  DB --> Assignments["assignments"]
  DB --> Schedules["schedules"]
  DB --> Announcements["announcements"]
  DB --> UserSubs["users/{uid}/settings, task_templates, exam_plans"]
```

### 1.2 Core Data Entities (Firestore)
- `users/{uid}`
  - Fields: `fullName`, `email`, `role`, `photoBase64`, `studentInfo`.
  - Used by: role routing, schedules, announcements filtering, profile.
- `assignments/{id}`
  - Fields: `userId`, `title`, `subject`, `dueAt`, `completed`, `type`, `priority`, `createdAt`.
- `schedules/{id}`
  - Fields: `course`, `year`, `section`, `semester`, `scheduleType`, `weekSchedule`.
- `announcements/{id}`
  - Fields: `title`, `message`, `audience`, `college`, `course`, `year`, `section`, `imageBase64`, `createdAt`, `createdBy`.
- Subcollections:
  - `users/{uid}/task_templates/{id}`
  - `users/{uid}/exam_plans/{examId}`
  - `users/{uid}/settings/notification`

### 1.3 Offline Strategy
- Cached data per user: schedule, assignments, announcements, profile.
- Offline queues:
  - New assignments (create queue)
  - Task completion (update queue)
- On reconnection, queued changes are synced to Firestore.

### 1.4 Notifications
- Scheduled notifications:
  - Class reminders
  - Deadline warnings
  - Morning briefing
  - Daily audit
  - Sunday planning
  - Break reminder and app usage checks (Android)
- Notification settings sync to Firestore for cross-device continuity.

## 2) Process Flowchart

```mermaid
flowchart LR
  A["App Launch"] --> B["Startup checks (OTA update scan + auth state)"]
  B --> C{"Authenticated?"}
  C -- "No" --> D["Login / Register"]
  D --> E{"EULA accepted?"}
  E -- "No" --> F["EULA consent screen"]
  E -- "Yes" --> G["Load user profile + role"]
  F --> G
  C -- "Yes" --> G
  G --> H{"Role?"}
  H -- "Admin" --> I["Admin dashboard"]
  H -- "Student" --> J["Student dashboard"]
  J --> K{"Online?"}
  K -- "Yes" --> L["Sync schedule, tasks, announcements"]
  K -- "No" --> M["Load cached data + queue changes"]
  L --> N["Use features + notifications rescheduled"]
  M --> N
  I --> O["Manage schedules, announcements, students"]
```

## 3) System User Interface

### 3.1 Navigation Map

```mermaid
flowchart LR
  Login["Login"] --> Register["Register"]
  Login --> EULA["EULA"]
  Register --> Login
  EULA --> StudentTabs["Student Tabs"]
  EULA --> AdminStack["Admin Stack"]

  subgraph "Student Tabs"
    Home["Home"]
    Schedule["Schedule"]
    Planner["Planner"]
    AddTask["Add Task"]
    Tasks["Tasks"]
    Profile["Profile"]
  end

  Home --> Announcements["Announcements"]
  Home --> ExamPrep["Exam Prep Planner"]
  Home --> AppUsage["App Usage"]
  Profile --> Notifications["Notification Settings"]
  Profile --> Announcements
  Profile --> ExamPrep
  Profile --> AppUsage

  subgraph "Admin Stack"
    AdminHome["Admin Home"]
    CreateSchedule["Create Schedule"]
    ViewSchedules["View Schedules"]
    Students["Students"]
    AdminAnnouncements["Announcements"]
  end

  AdminHome --> CreateSchedule
  AdminHome --> ViewSchedules
  AdminHome --> Students
  AdminHome --> AdminAnnouncements
```

### 3.2 Screen Summary (Student)
- Login/Register: authentication + EULA gating.
- Home: today classes, tasks, announcements, exam plans, usage summary.
- Schedule: weekly grid by day/time.
- Planner: day/week/month planning + analytics.
- Add Task: task creation with type, priority, and due date.
- Tasks: list of pending + completed tasks.
- Exam Prep Planner: study sessions and progress tracking.
- App Usage: device usage insights (Android).
- Profile: stats, profile updates, quick links.

### 3.3 Screen Summary (Admin)
- Admin Home: stats and quick actions.
- Create Schedule: weekly schedule builder.
- View Schedules: manage and edit schedules.
- Students: grouped student listings.
- Announcements: create and manage announcements.

## 4) Mockups Based on Code

These are simplified wireframes derived from the implemented UI layouts.

- Login: `docs/mockups/login.svg`
- Student Home: `docs/mockups/home.svg`
- Schedule: `docs/mockups/schedule.svg`
- Planner: `docs/mockups/planner.svg`
- Add Task: `docs/mockups/add-task.svg`
- Admin Home: `docs/mockups/admin-home.svg`

Embedded previews (if supported by your viewer):

![Login Mockup](mockups/login.svg)
![Home Mockup](mockups/home.svg)
![Schedule Mockup](mockups/schedule.svg)
![Planner Mockup](mockups/planner.svg)
![Add Task Mockup](mockups/add-task.svg)
![Admin Home Mockup](mockups/admin-home.svg)\n![Notifications Mockup](mockups/notifications.svg)
![Exam Prep Mockup](mockups/exam-prep.svg)
![Announcements Mockup](mockups/announcements.svg)
![Tasks Mockup](mockups/tasks.svg)
![Profile Mockup](mockups/profile.svg)
![Admin Create Schedule Mockup](mockups/admin-create-schedule.svg)
