# Student Usability Validation Kit

Date updated: March 31, 2026

## Purpose

Use this kit to run a small usability study for the student experience of CTU Academic Task Manager.

This kit is designed for:
- capstone validation
- thesis defense evidence
- iterative product testing after UX changes

## Recommended Sample

- Minimum participants: `5`
- Target range: `5 to 10`
- Recommended participant profile:
  - currently enrolled students
  - mixed year levels if possible
  - at least some students with real assignment-heavy schedules

## Test Setup

- Device: Android phone used for the app demo
- Session length: `15 to 25 minutes`
- Moderator: `1`
- Recorder/observer: optional but useful
- Data to capture:
  - completion status
  - completion time
  - number of wrong turns or errors
  - verbal confusion points
  - post-test ratings

## Moderator Script

Use this exact sequence:

1. Explain that the test is for the app, not for the participant.
2. Ask the participant to think aloud while using the app.
3. Do not teach the flow unless the participant is blocked.
4. Record where the participant hesitates, backtracks, or asks for help.
5. After each scenario, record:
   - completed or not completed
   - time
   - errors
   - help needed

## Student Test Scenarios

### Task 1. Quick capture

Prompt:
- Create a new task for an upcoming assignment using the Task Manager.

Success criteria:
- task is created
- title is correct
- due date is set
- subject is reasonable

### Task 2. Day planning

Prompt:
- Open the Planner and add a plan for today.

Success criteria:
- plan is added to the selected day
- participant understands where the plan appears
- participant can identify how it relates to tasks

### Task 3. Planner-to-task workflow

Prompt:
- From Planner or Task Manager, find a planner-linked task and go back to its source.

Success criteria:
- participant reaches the matching planner item
- participant understands that the planner item and task are connected

### Task 4. Complete or postpone work

Prompt:
- Mark one task as done or postpone one task using the quickest method you notice.

Success criteria:
- participant uses the task list directly
- participant completes or snoozes without opening unnecessary screens

### Task 5. Check academic context

Prompt:
- Find what you should do next using the Home screen.

Success criteria:
- participant can identify next class, urgent work, or today's plan
- participant can choose one next action quickly

### Task 6. Find announcements

Prompt:
- Check the latest announcement and open the announcements list.

Success criteria:
- participant finds the latest announcement from Home
- participant reaches the full announcements screen

## Metrics To Record

For each participant and task, record:
- `completed`: yes or no
- `time_sec`: task completion time in seconds
- `errors`: count of wrong taps, wrong screens, or false starts
- `help_level`:
  - `0` = no help
  - `1` = minor hint
  - `2` = strong guidance needed
- `confidence_rating` from `1 to 5`
- `ease_rating` from `1 to 5`

## Recommended Success Thresholds

Use these as a practical benchmark:

- Overall task completion rate: `>= 85%`
- Median completion time:
  - quick capture: `<= 60 sec`
  - planner add: `<= 75 sec`
  - planner-to-task return: `<= 45 sec`
  - complete or snooze: `<= 20 sec`
  - Home next-action identification: `<= 15 sec`
- Average errors per task: `< 1`
- Average ease rating: `>= 4/5`

## Post-Test Interview Questions

Ask these after all tasks:

1. Which part of the app felt easiest to use?
2. Which part felt slow or confusing?
3. Did Home help you decide what to do next?
4. Did Planner and Task Manager feel like one workflow or two separate tools?
5. What one improvement would matter most to you?

## Rating Form

Ask participants to rate each item from `1` to `5`.

- The Home screen made it clear what I should do next.
- Adding a task was fast.
- Planner and Task Manager felt connected.
- Completing or postponing a task was easy.
- The app would be useful for my real student workload.
- I would use this app if it were available to me.

## Analysis Method

After collecting results:

1. Compute completion rate per task.
2. Compute average and median time per task.
3. Compute average error count per task.
4. Group qualitative feedback into:
   - navigation issues
   - clarity issues
   - speed/friction issues
   - feature requests
5. Identify the top three usability problems by frequency and severity.

## Reporting Format

Report findings in four parts:

1. Participants
2. Quantitative results
3. Qualitative findings
4. Design actions taken or planned

## Files To Use

- Study protocol and tasks: [Student-Usability-Validation-Kit.md](Student-Usability-Validation-Kit.md)
- Raw capture sheet: [Student-Usability-Results-Template.csv](Student-Usability-Results-Template.csv)
- Research summary pack: [Research-Evaluation.md](Research-Evaluation.md)
