# 0070 A record shows its tasks and shifts

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2630](https://github.com/corvmc/corvmc.org/issues/2630)

## Context

The production page, the asset and contractor pages, the volunteer role page and the member group
page each built their own list of the work about them, with their own query and row markup. A
task belongs to a record through several columns (`event_id`, `project_id`, `group_id`,
`volunteer_role_id`, `maintenance_schedule_id`) or through `work_order_link` (0069), and a shift
belongs to a task.

## Decision

1. **One registry says how a record finds its tasks.** `src/lib/server/task/related-tasks.ts`
   holds a resolver per subject type, each returning relations closest first: a label and an
   indexed condition on `work_order`. A task appears once, under its closest relation. A type with
   no resolver has no related tasks.
2. **A record's shifts are the shifts of its related tasks.** `related-shifts.ts` runs the same
   relations joined to `volunteer_shift`; there is no second set of resolvers.
3. **Two shared cards draw them.** `RelatedTasks` uses the Tasks table's `TaskRow` in compact form
   and its chips; `RelatedShifts` uses Volunteering's `ShiftRow`. A page passes
   `subject={{ type, id }}`. View all opens `/staff/tasks` or `/staff/volunteering` with
   `?about=<type>:<id>`, which applies the same relations.
4. **The staff remotes check the record's own read guard, then the list's.** `getRelatedTasks`
   needs `project.read` and `getRelatedShifts` `volunteer.read`; a reader of the record without it
   gets no card rather than an error.
5. **Member pages use their own remotes and guards.** `getMemberRelatedTasks` and
   `getMemberRelatedShifts` (`member-related.remote.ts`) take a group or an event only. A group
   needs a seat on its roster (`requireProgramRole`, no staff bypass); an event needs a public
   listing. Tasks narrow to the viewer's own: assigned to them, owned by a club or committee they
   sit on, or on a project such a committee owns. Only assigned tasks link, to the member's task
   page. Shifts are the volunteer board's open shifts, and the row offers Sign up, the member's
   own status, or the clearance the role needs.
6. **The rows have a member mode rather than a member copy.** `TaskRow` takes `link`;
   `ShiftRow` takes `signup`. The sign-up modal is `ShiftSignUpAction`, shared with the board.

## Alternatives rejected

- **Reusing the staff remotes on member pages.** Their guards are capabilities a plain member
  does not hold, and widening them would hand committee members every task on a show.
- **A member card listing every task on the record, read-only.** Members could then read staff
  work they have no part in. The card shows what the member can act on.
- **Replacing the volunteer board with per-record cards.** The board lists every open shift
  across records; the cards list one record's. Both draw the same sign-up.
