# 0055 A task is the work, and a shift is when volunteers show up

- **Date:** 2026-11-10
- **Status:** Accepted
- **Issue:** [#2518](https://github.com/corvmc/corvmc.org/issues/2518)
- **PRs:** [#2528](https://github.com/corvmc/corvmc.org/pull/2528),
  [#2530](https://github.com/corvmc/corvmc.org/pull/2530),
  [#2563](https://github.com/corvmc/corvmc.org/pull/2563),
  [#2577](https://github.com/corvmc/corvmc.org/pull/2577),
  [#2578](https://github.com/corvmc/corvmc.org/pull/2578)

## Context

One `work_order` row held both the work ("fix the PA") and a time people show up to do it ("Door,
Saturday 6–10pm"). Because the two shared a row, `close_reports_on_completion` asked staff in
advance whether a time ending meant the equipment was fixed. Production on 2026-11-10 had 48 work
orders, 3 of them timed, and no sign-ups, reports or contractor jobs naming one. This replaces two
parts of [A work order is the task](0054-a-work-order-is-the-task.md) (2026-10-13): posting as a
stored flag, and assignment as a staff-made sign-up.

## Decision

1. **A task is the work.** `work_order` stays the task and keeps its name; the interface says
   "task". It owns its role, owner, due date and whether it is done.
2. **A shift is when volunteers show up.** `volunteer_shift` holds a start, an end and places. A
   task has zero or more shifts. A shift is open by existing; there is no posted flag.
3. **Volunteers sign up for shifts; staff assign tasks.** `volunteer_signup.shift_id` names a
   shift. `work_order_assignee` is who staff or a committee put on a task. The interface never
   says "claim".
4. **The clock never closes an equipment report.** A report resolves when its task is marked
   done. A shift ending completes its sign-ups and nothing else.
5. **Hours can name a task.** `volunteer_hour_log` names a shift, a task (`work_order_id`) or
   neither.
6. **The role, orientation and contractor engagements stay on the task.**

## Alternatives rejected

- **Keeping one row in two states.** The setting that closed reports on a time existed only
  because of it.
- **Renaming `work_order` to `task`.** A table with children rebuilds on rename, and every index
  and check name moves with it.
- **Signing up for a task.** A task with two shifts would need a second choice inside the sign-up.

## Consequences

- `work_order` lost `starts_at`, `ends_at`, `capacity`, `posted_at`, `posted_by_user_id` and
  `close_reports_on_completion`, with their checks and indexes. `pending_capacity` holds the places
  for a shift not yet opened.
- A task's list row shows its latest live shift. The member board lists each shift as its own row.
