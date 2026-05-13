# CTU Academic Task Manager

CTU Academic Task Manager is a mobile academic planning application for students and administrators. It is built with Expo React Native and Firebase and focuses on task management, schedule awareness, planner workflows, announcements, exam preparation, reminders, and offline resilience.

## Project Summary

This repository contains the implementation artifact for a student-focused time management system with separate student and admin flows.

Student capabilities:

- Create, edit, prioritize, and complete academic tasks
- View class schedules and planner timelines
- Receive deadline and class reminders
- Track announcements and exam preparation plans
- Use cached data and queued actions while offline

Admin capabilities:

- Manage schedules
- Publish announcements
- View student-related administrative screens

## Tech Stack

- Client: Expo, React Native, Expo Router
- Backend: Firebase Auth, Firestore
- Local persistence: AsyncStorage
- Connectivity: NetInfo
- Notifications: Expo Notifications plus native exact-alarm helpers
- Testing: Jest
- Linting: Expo ESLint

## Architecture References

- System design: [docs/System-Design.md](docs/System-Design.md)
- Data model: [docs/Data-Model.md](docs/Data-Model.md)
- Research evaluation pack: [docs/Research-Evaluation.md](docs/Research-Evaluation.md)
- Student UX plan: [docs/Student-UX-Improvement-Plan.md](docs/Student-UX-Improvement-Plan.md)

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm
- Expo CLI tooling through `npx expo`
- Firebase project credentials

### Install

```bash
npm install
```

### Configure Environment

Copy `.env.example` to `.env` and provide Firebase values:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

The app also supports `EXPO_PUBLIC_FIREBASE_*` aliases.

### Run the App

```bash
npm start
```

Useful variants:

```bash
npm run android
npm run ios
npm run web
```

### EAS Cloud Builds

To build for production using EAS (Expo Application Services):

1. Set up environment variables for your build profile. You can use `eas env` to manage secrets:

```bash
eas env:create --scope production --name EAS_PROJECT_ID --value your-eas-project-id
eas env:create --scope production --name FIREBASE_API_KEY --value your-firebase-api-key
eas env:create --scope production --name FIREBASE_PROJECT_ID --value your-firebase-project-id
eas env:create --scope production --name FIREBASE_APP_ID --value your-firebase-app-id
```

2. Trigger the cloud build:

```bash
eas build --platform android --profile production
eas build --platform ios --profile production
```

For local EAS builds (using your machine's resources), the app will use environment variables from your `.env` or `.env.local` file. For EAS cloud builds, use the `eas env` commands above to set secrets in the EAS servers.

## Verification

Run the local quality checks:

```bash
npm run lint
npm test
```

CI runs the same checks on GitHub Actions through [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Repository Structure

- [app](app): Expo Router screens and route groups
- [components](components): shared UI components
- [context](context): theme, offline, and notification providers
- [utils](utils): task model, planner sync, workload, alarms, logging
- [docs](docs): architecture, data model, diagrams, mockups, research notes
- [**tests**](__tests__): unit tests

## Current Quality Status

- `expo lint` is part of the standard verification flow
- Unit tests cover core planner analytics and workload calculation utilities
- Firestore access rules are defined in [firestore.rules](firestore.rules)
- The repo now includes a basic CI workflow for lint and test validation

## Known Limits

- The repository currently documents the technical artifact better than the empirical study results
- Research participant data and measured usability outcomes must be added with real study results rather than invented values
- Some large screen/context files still need modularization for long-term maintainability
