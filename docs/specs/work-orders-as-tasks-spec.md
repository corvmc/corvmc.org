# Work orders as project tasks

> ## Status
>
> **In progress.** Tracking issue #1806. Design settled in conversation with the owner on
> 2026-10-13, against a canvas mockup of the project page. Phase 1 (#1896), Phase 2
> (the engagement reshape, #1900) and Phase 3 (services, #1905) are built. Phase 6 is built
> except the job-detail redirect, which waits on Phase 5's task route. Phase 4 (the
> project page, 4a and 4b) is built. Phases 5 and 7 are not started.

## Purpose

Projects are run from spreadsheets today, and the staff project page reads as a set of
forms: typed records in fixed sections, each with its own create modal, its own status
machine and its own page. The people using it want a **checklist**: type a line, press
Enter, tick it off, fill in the rest later.

This spec makes the **work order** that checklist's item, makes a **contractor** one of
the ways a work order gets done, and rebuilds `/staff/projects/[id]` around the list.

It answers #1806 with that issue's option B — one model — and adds the task-list
interface on top.

## Decisions

Each of these was argued out and settled; the reasoning is in the section that follows.

1. **A work order is the task.** `work_task` stays what it is — the duties inside one —
   and is shown as subtasks.
2. **Assignment is one field with three modes:** assigned members, open to volunteers,
   or delegated to a contractor. The mode is derived from the rows behind it; only
   "posted to the claim board" is stored.
3. **Assigning a member is a staff-made volunteer signup** — the same row a claim makes,
   without posting the work to the claim board.
4. **A contractor job becomes the contractor's engagement on a work order**, shaped like
   `volunteer_signup`: who, their own status, and what they contributed (money where a
   signup contributes hours).
5. **The work order owns the status of the work.** The engagement's status is about the
   engagement.
6. **Sections are a table** (`project_section`), not a text column.
7. **Tasks are edited in place; the project is edited through one form.** Project fields
   have farther-reaching consequences and should not be easy to change by accident.

## The work order

### Assignment

The mode is **derived, not stored**. The one fact that cannot be derived is whether
staff opened the work to volunteers — a decision that exists before anyone signs up —
so that is the only new column:

```text
work_order
  + posted_at            integer (timestamp)
  + posted_by_user_id    text → user (set null)
```

A timestamp rather than a flag, matching `resolved_at` and `cancelled_at`, and it gives
the Activity tab "posted Oct 3 by Nia" for free. The mode reads, in this order:

| Mode           | When                                                                  | Who does it                             |
| -------------- | --------------------------------------------------------------------- | --------------------------------------- |
| **Contractor** | a live engagement exists (`contractor_job` not declined or cancelled) | the engagement, see below               |
| **Open**       | `posted_at is not null`                                               | `volunteer_signup` rows members created |
| **Members**    | live signups, not posted                                              | `volunteer_signup` rows staff created   |
| **Unassigned** | none of the above — including a task just typed into the list         | nobody yet                              |

Only one combination can disagree with itself — posted work with a live engagement —
and the switching rules below forbid it: delegating clears `posted_at`, and posting
refuses while an engagement is live. There is no stored mode to drift from the rows it
describes.

The UI shows one **Assigned** field. Its value is an avatar stack and `filled/capacity`
for Members and Open (with "Open on the claim board" for Open), the contractor's name
and engagement status for Contractor, and "Unassigned" otherwise. The list's mode, its
Unassigned filter and the panel all come from one query joining live signups and live
engagements.

- **Members.** Picking people calls `claimShift(id, userId, { assignedByStaff: true })`,
  which already lands a signup `confirmed` (volunteer-signup-service.ts:145). Hours are
  logged against the role exactly as for a claimed shift. Assigning past `capacity`
  raises `capacity` — staff naming a fourth person is the decision that four are needed.
- **Open.** Today's behaviour, unchanged: a role, a capacity, a window, and members
  claim.
- **Contractor.** One or more engagements; see [The engagement](#the-engagement).

**Who may be assigned:** staff, and members of the work order's committee — `group_id`,
falling back to the owning committee of its project. The picker lists only them.

**`volunteer_role_id` becomes nullable.** A role is required for Members and Open,
because hours are logged per role and clearances are checked per role. It is meaningless
for Contractor and not yet known for Unassigned. A CHECK holds
`posted_at is null or volunteer_role_id is not null`; Members, which has no column of
its own, is enforced in the service — assigning the first person requires a role.

**The claim board shows only posted work.** `listOpenShiftsForMember`
(work-order-service.ts:801) filters on `cancelledAt` and `startsAt >= now` and nothing
else, so a scheduled Members work order would appear there. It gains
`posted_at is not null`. The member `claimShift` form (volunteer.remote.ts:1792)
accepts any shift id today; it refuses unposted work.

**Backfill:** every existing work order gets `posted_at = created_at`. That is what each
of them is today — anything scheduled is on the board. Gating the board on a new column
without the backfill would empty it (the "gate change needs backfill" rule).

### Switching modes

Warn, record, allow — never delete.

- **Away from Members or Open** with live signups: say how many people are on it, then
  cancel their signups so they are notified the way a cancelled shift notifies them.
- **Open → Members** keeps the signups and clears `posted_at`: the people stay, the
  board listing goes.
- **Away from Contractor** with a `booked` engagement: say so, then leave the
  engagement as it is. Calling off a contractor is a phone call, and the engagement's
  own Cancel records it; this switch does not do it silently. Because a live engagement
  _is_ the Contractor mode, switching away first asks to cancel or decline it — the
  warning, then the engagement's own Cancel, in one step.
- **To Contractor** clears `posted_at`.
- Each switch writes an audit entry (below).

### Status

Unchanged columns, now the only status there is: `starts_at`/`ends_at` (the scheduled
window), `due_at` (a deadline, which is not a window), `resolved_at` (done) and
`cancelled_at`. They are independent — a work order can have a window and a due date
both. Where the window ends after the due date, the list flags it.

Ticking a task sets `resolved_at` — except where the task has a `done_when`, below. It
does **not** complete a contractor engagement: "done" and "invoiced" are different
facts, and the row reads "Awaiting invoice" until the engagement catches up. Completing
the engagement does tick the task: `completeJob` calls `resolveWorkOrder`, so the
equipment reports the task answered close with it. A task already ticked, or called
off, is left as it is.

### Derived completion

Committee deliverables (shipped in #1701,
[committee-deliverables-spec.md](shipped/committee-deliverables-spec.md)) are work
orders whose `done_when` names a fact about their show — the listing has a poster,
every act was asked for its artifacts, every crew shift is filled. `evaluateDone`
(done-conditions.ts:120) reads a task as done when `resolved_at` is set **or** the
condition holds, and stores nothing when the condition comes true, so an item goes
back to open if the fact goes away.

On a show's task list these are ordinary rows, with three differences:

- **The checkbox is the app's.** It is drawn as derived — filled when the condition
  holds — and clicking it does not toggle. It opens what is missing instead.
- **Ticking by hand is the override**, and it is what `resolved_at` already means for
  these rows: done regardless of the fact. Warn, record, allow — the tick asks for a
  reason, which goes in the existing `resolution_notes`, and the audit entry records it
  as an override. Unticking a hand-ticked one clears `resolved_at` and hands the row
  back to its condition.
- **The panel shows the condition** as a property row — "Done when: the listing has a
  poster" — and, while it does not hold, what is outstanding:
  - `artifacts_requested`: the acts not yet asked, and those asked whose artifact has
    not arrived, each linking to its `artifact_request`.
  - `poster_set` / `description_set`: a link to the listing's slot.
  - `shifts_filled`: the crew tasks still short, in this same list.
  - `tasks_ticked`: its own duties, already shown below.

Progress counts a derived-done task the same as a ticked one.

**The output lives on its subject, never on the task.** A poster is the listing's, a
rider is the act's, recap photos are the event's. The task reads its completion from
that thing appearing; work orders do not become an attachable type, which would store
the same file twice with nothing to say which copy is real. The one place a task
grants file access is the Show Documentation role (#1500): a confirmed signup lets the
member upload the event's recap photos.

**Artifact requests stay what they are** — asks to outside acts, with their own token
link and their own derived arrival. A show's list reaches them through its
`artifacts_requested` deliverable, not as rows of their own.

### Sections and order

```text
project_section
  id            text pk
  project_id    text not null → project (cascade)
  name          text not null
  sort_order    integer not null
  created_at, updated_at
  unique (project_id, name)

work_order
  + section_id  text → project_section (set null)
  + sort_order  integer not null default 0
```

- A section can be empty, renamed or reordered as a unit. Deleting one moves its work
  orders to the unlabelled group at the top; it never deletes them.
- `sort_order` is within the section. Moving a task between sections writes both
  columns.
- `duty_list_item` gains `section text`. `applyDutyList` creates or reuses sections by
  name, so applying "Standard Show" twice to one project cannot produce two "Load-in"
  headings.
- A work order with no project has no section. The column is unused there.

### Progress

Done work orders over live ones — every mode counts, cancelled ones do not, and "done"
is `evaluateDone`'s answer (ticked, or its condition holding).
This settles the progress question left open in [project-spec.md](project-spec.md).
Duties do not count toward the project's figure; they show as `2/3` on their own row.

## The engagement

`contractor_job` keeps its name — renaming a table with children is a rebuild for no
gain, the same call the `volunteer_shift` rename made — and changes meaning: it is now
**one contractor's engagement on one work order**, the way a `volunteer_signup` is one
person's place on one.

| `volunteer_signup`                 | `contractor_job`                                                  |
| ---------------------------------- | ----------------------------------------------------------------- |
| `shift_id` → work order, required  | `work_order_id` → work order, required (after migration)          |
| `user_id`                          | `contractor_id`                                                   |
| invited · claimed · confirmed · …  | `asked · declined · booked · completed · cancelled · no_show`     |
| `scheduled_starts_at` override     | `scheduled_for` (when they come), `expected_back_at` (promised)   |
| contributes hours via the hour log | contributes money: quote, cost, invoice, paid, donated fair value |

- **Several per work order.** Asking two electricians for a quote and booking one is
  two rows, one `declined`.
- **Statuses map** `draft → asked`, `scheduled → booked`; `completed` and `cancelled`
  keep their names. The enum is TypeScript-only in SQLite, so this is a data `UPDATE`
  plus every place that compares the strings (`contractorJobStatusLabels`,
  `contractorJobStatusBadge`, the overdue partial index's `where status = 'scheduled'`,
  e2e locators).
- **Late** stays derived: `booked` and `expected_back_at < now`.
- **Equipment side effects stay on the engagement.** Booking a repair takes the unit out
  of service and completing it brings it back (`scheduleJob`/`completeJob` in
  contractor-job-service.ts). The asset now comes from the work order.
- **Money stays here and keeps its rules:** donated work carries `fair_value_cents` and
  never `cost_cents`; `recordCompletedJob` writes the ledger entry. Project burn reads it
  through the work order's `project_id` instead of the job's, and leaves out `declined`
  and `cancelled` engagements, whose quotes and costs are nobody's spend.
- **Terminal:** `completed`, `cancelled`, `declined` and `no_show`. A contractor who
  declined or did not show is asked again as a new engagement.
- **Not attachable.** `contractor_job` left `attachToProject`'s map: it is on a project
  only through its work order, and detaching it from one detaches the work order.

**Moved to the work order and dropped from `contractor_job`:** `summary` (→ `title`),
`asset_id`, `project_id`. **`completed_at` stays:** it is when the contractor finished
their engagement, which is not when the task was ticked — staff may tick the task
first, the same reason `volunteer_signup` keeps its own `completed_at`.
`requested_by_user_id` stays — it is who engaged them.

### Reshaping the table

Production has **no contractor jobs** — no contractors and no ledger entries for them
either (read-only count against `corvmc-db`, 2026-10-13). So there is nothing to
backfill and no reason to stage the change: once Phase 1 has added
`contractor_job.work_order_id` as nullable, Phase 2 reshapes the table in one
migration — `work_order_id` NOT NULL, `summary`, `asset_id` and `project_id` dropped,
and the overdue partial index's condition moved from `'scheduled'` to `'booked'`.

The status rename is a code change with no rows to update. If a job is entered in
production before Phase 2 ships, recount first; the reshape is only lossless while the
table is empty.

## Null-role safety

These inner-joined `volunteer_role` on `work_order.volunteer_role_id` and would silently
drop contractor and unassigned work orders. They are left joins now, or filter to work
orders with a role where only volunteer work belongs (Phase 3):

- `shiftRowsQuery`, work-order-service.ts:490 — the staff list, queue and detail. A
  left join; `ShiftWithCounts.roleName`/`roleGroup` are nullable and the staff pages
  print "No role" (`NO_ROLE_LABEL`, shift-label.ts).
- `listProjectAttachments`, project-service.ts:569 — a left join; the title falls back
  to "Untitled task" after the work order's, event's and role's names.
- `readDeliverables`, deliverables-service.ts:66, and `listFinishedWorkToConfirm` plus
  the equipment report's open-work picker in work-request-service.ts — left joins: a
  committee's task or a contractor's repair has no role and is still listed.
- `unscheduledWorkWhere`, work-order-service.ts:698 — unanchored (the coordinator's
  queue and the sidebar badge) it lists only work with a role; anchored to a project or
  event it lists everything.
- `listShortStaffedShifts` (work-order-service.ts:1009) and the staff worklist's
  short-staffed card — only work with a role can be short of people (`isRoledShift`).
- `countUnfilledByRole` already skipped a null role; `getShiftCandidates` returns no
  candidates for one, and the shift page hides its candidate column.
- `listOpenShiftsForMember`, work-order-service.ts:827 — keeps its inner join: it lists
  posted work only, and posting requires a role.
- Signup, feedback, certification and hour-log joins (volunteer-signup-service.ts,
  volunteer-feedback-service.ts, member-certification-service.ts, hour-log-service.ts)
  — only reachable through a signup, and a signup can only exist where a role does.
  The service enforces that: `claimShift`, `inviteToShift` and member assignment refuse
  a work order with no role (`NoVolunteerRoleError`).
- `createWorkOrder` (work-order-service.ts:552) stops requiring a role.
- `duty_list_item.volunteer_role_id` stays NOT NULL; a duty list describes volunteer
  work. Contractor work from a template is out of scope.

## Activity

`audit_log` has no `work_order`, `contractor_job` or `project` subject today
(src/lib/types/audit.ts:37), and nothing records a work order changing.

- Add subject types `project` and `work_order`, and actions `work_order.created`,
  `.assigned` (mode change, with the from/to in `details`), `.member_assigned`,
  `.member_unassigned`, `.rescheduled`, `.resolved` (with `override: true` and the reason
  when it has a `done_when`), `.reopened`, `.cancelled`,
  `.moved` (section), and `contractor_job.status_changed`, `.invoice_recorded`.
  Engagement entries are written against their work order's id, so one query reads a
  task's whole history.
- Duty ticks are not audited; `work_task.done_by_user_id`/`done_at` already say who and
  when, and the timeline reads them directly.
- The **Activity** tab is the project's audit entries, its work orders' entries, the
  ticks, and the origin chain — suggestion, ballot, project — read from the existing
  tables rather than copied into the log.

## The project page

`/staff/projects/[id]`, rebuilt. Desktop first; at phone width the panel becomes a
sheet over the list.

**Header** (read-only): title, owning committee, a status line (status, `n of m tasks
done` with a bar, spent of budget, dates), and a collapsible **About** holding the
description. Actions: **Apply duty list**, **Edit project**, and a ••• menu with
**Change status** and **Put to a member ballot**. Change status stays its own action
because it moves the linked suggestion too.

**Edit project** is one form: name, description, owning committee, linked suggestion,
budget, dates.

**Tabs:** Tasks · Budget · Activity. Only the tab bar sticks while scrolling.

**Tasks:**

- Toolbar: All · Mine · Open to volunteers · Contractors · Unassigned, and show/hide
  done.
- Sections with a drag handle, a ••• menu, a `done/total` count and an add-a-task line
  at their foot. "Add section" at the end of the list.
- One row per work order: checkbox, title, a duties count that unfolds the duties as
  tickable subtasks, Assigned, When, Cost. **When** is the window if there is one,
  otherwise the due date.
- Typing a title and pressing Enter creates the work order with nothing else set.
- Clicking a row opens the **panel**, full height beside the list, with its own URL
  (`?task=<id>`):
  - checkbox and title; beneath, the section and a **Details** link to the
    [task page](#the-task-page).
  - property rows, each a click-to-edit value: **Assigned** (opens the picker),
    **Scheduled**, **Due**, **Committee** ("from the project" when inherited),
    **Equipment**, **From** (duty list), **Done when** (derived tasks only), then "+ Due date / Equipment / Event / Repeat"
    for anything unset. A contractor's quote, cost and invoice sit under Assigned.
  - duties, with add.
  - notes.
- The **assignment picker** is one popover with three tabs — Members (role, search the
  allowed list, tick people), Open to volunteers (role, spots), Contractor (pick one) —
  and Unassign.

**Budget:** today's Cash and Contributed cards, and the purchase orders and
acquisitions that are attached to the project rather than to a task.

## The task page

A project's work order gets its full page at `/staff/projects/[id]/tasks/[taskId]`,
under the project it belongs to — the panel's **Details** link goes there. It carries
what the panel leaves out: the roster (invites, confirmations, no-shows), hour
approval, feedback, linked equipment reports, the engagements with their money, the
cancellation history, and the task's own activity.

- **Show crew is project work.** A production is a project of kind `production`, and
  a duty list applied to a show already stamps the production's `project_id` alongside
  `event_id` ([production-projects-spec.md](production-projects-spec.md) §4). Event
  shifts therefore land on this route and in their show's task list; the event anchor
  stays for timing and re-timing.
- **One component, two homes.** Only work that belongs to no project — recurring
  maintenance, a first rehearsal's orientation, shifts on a listing with no production —
  keeps `/staff/volunteer/shifts/[id]`.
  Both routes render the same work order view; the project route adds the project's
  breadcrumb and back link.
- **The old URL redirects.** `/staff/volunteer/shifts/[id]` for a work order that has a
  project redirects to the task route, so existing links, notifications and emails
  keep working. Moving a work order onto or off a project changes which URL is
  canonical; nothing stores the URL.
- **The guard checks the pair.** The remote takes both ids from the client, so it
  loads the work order and refuses (404) when its `project_id` is not the project in
  the URL — otherwise a project the caller can read becomes a window onto a work order
  in one they cannot. Access is the project's: `project.read`, or a committee role on
  the project through `requireProjectCommittee`.
- `/staff/contractors/jobs/[id]` redirects to whichever of the two routes is canonical
  for its work order.

## Contractor Jobs page

`/staff/contractors/jobs` is a view of engagements across every work order, with tabs
Open (`asked`, `booked`, the default), Late (`booked` and `expected_back_at < now`),
Awaiting invoice (`completed`, `cost_cents` null, not donated) and All, each with its
count. The tab is mirrored into `?view=`. Each filter is one predicate
(`engagementViewWhere`) shared by the list and the counts. The overdue alert that sat
above the old list is gone: it repeated the Late tab's rows above every tab, and the Late
tab's count and each late row's badge and promised-back date carry the same warning. The
contractor index keeps its overdue list.

Each row's title opens the engagement (`/staff/contractors/jobs/[id]`), and a **Work
order** link beside it opens the work order. Once the redirect below lands, the title
leads to the work order too. Until Phase 3a's null-role safety merges, a work order
with no role (every one made from this page) 404s on `/staff/volunteer/shifts/[id]`,
which is why the title does not link there yet.

The engagement page's actions: **Book** (from `asked`; **Reschedule** once booked),
**Complete**, **Decline** (shown on `asked`), **No-show** (shown on `booked`),
**Cancel**, and **Invoice** (on `completed` only, since no other ending counts as
spend). Decline and No-show are terminal. The service refuses them only from a terminal
state, so a decline after booking is allowed even though the page offers it only on
`asked`. Neither touches the unit, the ledger or the work order: a no-show on a repair
leaves the unit out of service, as cancelling does, because it is still broken. The
work order stays open for the next engagement. `no_show` joined `declined` and
`cancelled` in `contractorJobStatusesWithoutSpend`.

Still to do: `/staff/contractors/jobs/[id]` redirects to the work order's page (above),
whose engagements section replaces the job detail page. Creating a job from the
contractor page creates a work order with no role, no posting, and its first engagement
(built in Phase 2).

## Phases

All staff-facing, so each phase goes straight to `main`.

1. **Schema, expand.** Nullable `volunteer_role_id` and its CHECK, `posted_at` and
   `posted_by_user_id` with the `posted_at = created_at` backfill, `project_section`,
   `section_id`, `sort_order`,
   `duty_list_item.section`, `contractor_job.work_order_id`. Seed: sections on the
   facility project, one task per assignment mode, a contractor engagement on a task.
2. **Engagement reshape.** The one-step migration above, the status rename, and
   `contractor-job-service`, the job pages, project burn and the seed reading through
   the work order.
3. **Services.** Assignment modes and switching, the claim-board filter and claim
   guard, null-role-safe queries, sections and ordering, inline create, progress, audit
   writes. Every pre-existing creation path (`createShift`, `createWorkOrder` with a
   role, duty lists, maintenance occurrences, the host shift) posts what it creates, so
   gating the board changes nothing for them; only the task list makes unposted work.
   The services are `project-task-service.ts` and `project-section-service.ts`
   (src/lib/server/project/). `tasks.remote.ts` exposes the list and picker reads and
   the drag-ordering commands; the forms for creating, assigning, ticking,
   rescheduling and cancelling land with Phase 4's UI, since a form no component
   submits is not shipped. Section names compare trimmed and case-insensitively, so
   a duty list's "load-in" reuses "Load-in". Members → Open keeps the
   people already on it, as Open → Members does; only unassigning cancels signups.
   Every switch away from Contractor is refused while the engagement is live, until
   the engagement's own Cancel exists to pair with it. Audit entries are written on
   the `work_order` subject only; `project` joins the vocabulary with its first writer.
4. **Project page.** The task list, panel, picker, header, About, tabs and edit form.
   Two PRs. **4a** is the page and a read-only list: header, About (the description,
   the origin chain and any events), Tasks · Budget tabs, filters and show/hide done
   in the URL, sections with counts, rows unfolding their duties, and the panel at
   `?task=<id>`. The list is read through `getProjectDetail`, the page's one query, so
   the task commands refresh that. The panel's **Details** link goes to
   `/staff/volunteer/shifts/[id]` until Phase 5. "+ Event" and "+ Repeat" are left
   out: no service sets either on an existing task. **4b** is editing in place: the
   add line, ticking (a derived task's box opens what it waits on; "Tick by hand" in the
   panel is the override, with a reason), duties, sections (add, rename, delete, move),
   ordering by drag or by arrow keys on a row's handle, the picker and the property
   rows. Delegating to a contractor is `engageContractor`: it asks the contractor
   (`createJob` with the work order), clears `posted_at`, and with live signups warns
   first, then cancels them on confirm. Equipment is set with `setTaskEquipment`;
   duties with `addDuty`/`setDutyDone`, which refuse a duty that is not the task's.
5. **Task page** at `/staff/projects/[id]/tasks/[taskId]`, the work order view shared
   with `/staff/volunteer/shifts/[id]`, and the redirect between them.
6. **Contractor Jobs view** and the job-detail redirect.
7. **Activity tab.**

## Open questions

- **Staff without a volunteer profile.** `claimShift` calls `requireActiveVolunteer`
  and the clearance check on the staff-assign path too (volunteer-signup-service.ts:158,
  :174). Assigning a staff member with no active profile is refused today. Either the
  assign path creates or activates a profile, or it skips that guard. Missing
  clearances should probably warn and record rather than refuse, per the workflow-gates
  convention.

## Out of scope

- Contractor work generated by duty lists or maintenance schedules.
- Board, calendar or timeline views of the same list.
- Custom fields per project.
- Where work orders with no project live (#1796): they keep
  `/staff/volunteer/shifts/[id]` until that issue decides.
