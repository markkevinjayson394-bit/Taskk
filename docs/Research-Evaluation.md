# CTU Academic Task Manager Research Evaluation Pack

Date updated: March 31, 2026

## 1. Research Context

### Problem

Students often manage deadlines, class schedules, study plans, and announcements across multiple disconnected tools. This increases missed deadlines, weak planning habits, and poor visibility into academic workload.

### Proposed Solution

CTU Academic Task Manager consolidates academic task tracking, planner views, schedules, reminders, announcements, and exam-preparation support into a single mobile application.

### Intended Beneficiaries

- Students who need day-to-day academic planning support
- Academic staff or administrators who manage schedules and announcements

## 2. Research Objectives

- Build a mobile-based academic task management system for CTU students
- Provide integrated task, planner, schedule, and reminder workflows
- Support offline-friendly usage through caching and queued actions
- Provide a role-based admin workflow for schedules and announcements

## 3. Scope of the Artifact

Implemented and documented scope is described in [System-Design.md](System-Design.md).

In scope:
- Student task management
- Planner and calendar-aligned task synchronization
- Schedule-aware task context
- Notifications and reminders
- Announcements
- Exam preparation support
- Admin schedule and announcement management

Out of scope:
- Device usage monitoring
- App usage locking or guard controls

## 4. Technical Evidence Included in the Repository

### Design and data documentation

- System architecture and navigation: [System-Design.md](System-Design.md)
- Firestore schema notes: [Data-Model.md](Data-Model.md)
- Firestore security rules: [firestore.rules](../firestore.rules)

### Implementation evidence

- Role-gated startup and routing: [app/_layout.js](../app/_layout.js)
- Student tab composition: [app/(tabs)/_layout.js](../app/(tabs)/_layout.js)
- Offline cache and queue handling: [context/OfflineContext.js](../context/OfflineContext.js)
- Notification engine: [context/NotificationContext.js](../context/NotificationContext.js)
- Planner-to-task synchronization: [utils/plannerTaskSync.js](../utils/plannerTaskSync.js)
- Workload scoring logic: [utils/workloadCalculator.js](../utils/workloadCalculator.js)

### Automated checks

Current repository verification commands:

```bash
npm run lint
npm test
```

GitHub Actions workflow:

- [ci.yml](../.github/workflows/ci.yml)

## 5. Current Validation Status

The repository currently supports technical validation better than empirical validation.

Current technical evidence:
- Source code for the working application
- Architecture and data model documentation
- Unit tests for selected planner and workload utilities
- Linting and CI automation

Current gap:
- No participant-based study results are stored in the repository yet
- No survey summary, SUS score, task completion study, or measured before/after outcome is documented yet

Prepared validation assets now included:
- Student study protocol: [Student-Usability-Validation-Kit.md](Student-Usability-Validation-Kit.md)
- Raw capture sheet: [Student-Usability-Results-Template.csv](Student-Usability-Results-Template.csv)
- Summary template: [Student-Usability-Summary-Template.md](Student-Usability-Summary-Template.md)

This means the repository is a credible software artifact, but not yet a complete research package on its own.

## 6. Recommended Empirical Evaluation Method

Use this section as the study structure for the final paper or defense document. Replace placeholders with real collected data.

### Evaluation design

- Method: usability and effectiveness evaluation
- Setting: guided hands-on trial using the mobile application
- Respondents: students and optionally faculty/admin users
- Instruments:
  - task-completion checklist
  - Likert-scale questionnaire
  - optional System Usability Scale
  - short qualitative interview

Use the repository study pack directly:

1. Run the scenarios in [Student-Usability-Validation-Kit.md](Student-Usability-Validation-Kit.md).
2. Record each participant session in [Student-Usability-Results-Template.csv](Student-Usability-Results-Template.csv).
3. Summarize measured outcomes in [Student-Usability-Summary-Template.md](Student-Usability-Summary-Template.md).
4. Copy the final metrics into the results section below.

### Suggested measures

- Task completion rate
- Average completion time per scenario
- Number of user errors
- Reminder usefulness rating
- Planner usefulness rating
- Overall usability score
- User satisfaction score

### Suggested scenarios

- Add and prioritize a task
- View upcoming work in the planner
- Check schedule-linked academic context
- Complete a task and verify reminder behavior
- Review announcements
- Create or update a schedule as an admin

Recommended student-facing tasks are already specified in:
- [Student-Usability-Validation-Kit.md](Student-Usability-Validation-Kit.md)

## 7. Results Template

Do not invent values. Replace the placeholders below only with actual collected results.

### Participants

- Total respondents: `TBD`
- Student respondents: `TBD`
- Admin respondents: `TBD`

### Quantitative results

| Metric | Result | Notes |
| --- | --- | --- |
| Task completion rate | `TBD` | |
| Average completion time | `TBD` | |
| Overall usability score | `TBD` | |
| Reminder usefulness rating | `TBD` | |
| Planner usefulness rating | `TBD` | |

### Task-level results template

| Task | Completion Rate | Median Time | Average Errors | Avg. Ease |
| --- | --- | --- | --- | --- |
| Quick capture | `TBD` | `TBD` | `TBD` | `TBD` |
| Day planning | `TBD` | `TBD` | `TBD` | `TBD` |
| Planner to task workflow | `TBD` | `TBD` | `TBD` | `TBD` |
| Complete or postpone work | `TBD` | `TBD` | `TBD` | `TBD` |
| Find next action on Home | `TBD` | `TBD` | `TBD` | `TBD` |
| Find announcements | `TBD` | `TBD` | `TBD` | `TBD` |

### Qualitative findings

- `TBD: strongest positive finding`
- `TBD: main pain point`
- `TBD: requested improvement`

## 8. Analysis Guidance

When real data is available, interpret it using:

- whether students complete planning tasks faster
- whether reminders reduce missed deadlines
- whether the integrated planner/schedule workflow is easier than fragmented tools
- whether admin workflows are efficient enough for operational use
- whether the Home screen helps students identify the next action quickly
- whether task capture and snooze actions reduce friction in common workflows

Include both strengths and observed weaknesses. A credible research output is explicit about limits.

## 9. Replication Checklist

For another evaluator to replicate the technical artifact:

1. Clone the repository.
2. Create `.env` from [.env.example](../.env.example).
3. Install dependencies with `npm install`.
4. Run `npm run lint`.
5. Run `npm test`.
6. Start the app with `npm start`.
7. Use the system design and data model docs to verify feature coverage.
8. Run the student usability study using [Student-Usability-Validation-Kit.md](Student-Usability-Validation-Kit.md).
9. Record raw data in [Student-Usability-Results-Template.csv](Student-Usability-Results-Template.csv).

## 10. Present Assessment

Based on repository evidence alone:

- The implementation depth is strong enough for a capstone-level software artifact.
- The research packaging now includes a ready-to-run usability validation kit, but empirical results are still missing until real participant data is attached.
- The repository is now structured to support both technical review and later research reporting.
