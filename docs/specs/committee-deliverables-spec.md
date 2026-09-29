# Committee-owned deliverables

> ## Status
>
> **The owner ruled on all four open questions on 2026-09-29** (#1701). This document implements
> those rulings and does not reopen them. Phase 0 is this document. Nothing is built yet.
>
> Building starts **only once `feature/production-projects` has landed on `main`** (#1673); see
> [Sequencing](#sequencing). The choices an agent made inside the rulings are recorded as
> decision issues for the owner to confirm: #1706, #1707, #1708 and #1709.

## Purpose

A committee's _responsibility_ for a piece of show work and a member's _permission_ to do it are
two different facts, and the app has been storing the first as the second.

- **Permission** says whether this person is _allowed_ to do X. It changes rarely and is coarse. It
  is restricted only where the harm is real: money, member data, publishing to the public, and
  moderation. It lives in capability grants (`grantableCapabilities`, a committee's
  `capabilityGrants`).
- **Responsibility** says whose job X is _on this show_, who hears about it, and who gets chased
  when it is late. It is specific to one item and changes often. It drives the workflow: queues,
  notices, "waiting on" and reminders.

The target for a volunteer organisation is **generous permission and explicit responsibility**.
Anyone who can do the work may cover for someone else, and everyone can see who owns what.

This spec models responsibility as an **owning committee on a work order**. It adds a derived
condition saying when the work is done, and a default set of those work orders for every show.
It adds no permission.

## Premise, checked against `main` on 2026-09-29

I checked the issue's claims at `c0233d3`, and against `origin/feature/production-projects` at
`7969570`.

- **The pieces exist, and nothing connects them to a committee.**
  - `duty_list` and `duty_list_item` stamp work orders out relative to an anchor, with a window or
    a due offset (#405, 2026-09-02).
  - `work_task` is the checklist on a work order.
  - `artifact_request` already derives its own completion from the artifact.
  - `work_order` names a volunteer _role_ and never a committee. `volunteer_role.group` is
    presentational ("Nothing branches on it").
  - The one work shape a committee owns is `maintenance_schedule.group_id`, a committee's
    recurring work (#1585, 2026-09-24).
- **The facts a deliverable would be "done" on are already computed, as gates.**
  - `publishBlockers` (#851, 2026-09-09) refuses to publish a CMC listing that has no confirmed
    production, no poster or no description. Those are three rows of the ruled table.
  - `outstandingCloseOutTasks` (#844, 2026-09-09) refuses `closed` while any load-out task is
    open. That is a fourth row.
  - Both gates read the facts directly. Neither asks whose job the fact was.
- **Responsibility sits inside one role's checklist.** The seeded "Standard Show" (#405) gives the
  Booking Lead a single advance item a week out. Its tasks include _"Poster to social and the
  mailing list"_ (Communications' job) and _"Collect tech riders and stage plots"_ (the advance,
  which the ruling gives to Production). The committee each task belongs to is written nowhere.
- **No committee has a queue.** The committee page lists projects, markets and recurring work.
  Its remote says so: _"The committee page lists no work orders."_ Show work reaches a committee
  only if someone tells them.
- **The one cancellation notice is a special case.** Phase 2b of production-projects (#1702, open
  against the feature branch) sends `production_cancelled` to the committees taking part as
  `'production'`. That is the one-off this spec replaces.
- **Cancelling a show does not cancel its work.** No cancel path touches `work_order`, so a
  cancelled show's shifts stay claimable and keep sending reminders. That is filed separately as
  #1705. This spec cancels the _deliverables_ on a cancelled show and leaves crew shifts to #1705.
- **Committees in production** on 2026-09-29, as #1702 recorded from a read-only query: Booking,
  Communications, Facility, Art and Merchandise, Production and Development. Only Development held
  grants at that point. The dev seed has Booking, Facilities, Production and Development, but no
  Communications and no Art and Merchandise.

## A show as handoffs between committees

This is written without reference to the code. Each row is one handoff: what one committee must
finish before another can start, and what waits on it.

| #   | Owner             | Hands over                                                | To                      | Gates                          |
| --- | ----------------- | --------------------------------------------------------- | ----------------------- | ------------------------------ |
| 1   | Booking           | An agreed lineup and deal                                 | Everyone                | Announcing the show            |
| 2   | Booking           | Asks to each act for riders, press kits and art           | Production, Art & Merch | The advance; the poster        |
| 3   | Art & Merchandise | Poster art                                                | Communications, Booking | Announcing; distribution       |
| 4   | Booking           | The description                                           | Communications          | Announcing                     |
| 5   | Communications    | The show published, the poster out, social, press, letter | The public              | Ticket sales                   |
| 6   | Production        | An advanced show: times, backline, load-in with each act  | Crew, the acts          | The night                      |
| 7   | Production        | A crewed show                                             | The night               | Doors                          |
| 8   | Production        | A reset room                                              | Tomorrow's bookings     | `closed`                       |
| 9   | Production        | A settlement                                              | Treasurer (payouts)     | `settled`, then paying the act |

Rows 1, 3, 4 and 8 are the facts the two existing gates already check. Only the "whose job" part
is missing. The other rows are work nobody chases today.

## The design

### 1. An owning committee on a work order and its template item

| Table            | New column  | Type                                      | Notes                                                                         |
| ---------------- | ----------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `work_order`     | `group_id`  | text → `group.id`, set-null, nullable     | The committee answerable for it. Null keeps today's meaning: staff's work     |
| `work_order`     | `done_when` | text, enum `workDoneConditions`, nullable | See §2                                                                        |
| `duty_list_item` | `group_id`  | text → `group.id`, set-null, nullable     | Copied onto the work order at apply time                                      |
| `duty_list_item` | `done_when` | text, enum `workDoneConditions`, nullable | Copied likewise                                                               |
| `duty_list_item` | `title`     | text, nullable                            | Copied to `work_order.title`. Without it, three Booking Lead items read alike |

- All the new columns are nullable and have no default, so each one is a plain `ADD COLUMN`.
- The group must have `kind = 'committee'`. The service checks this, as `maintenance_schedule`
  and `project_committee` already do.
- The foreign keys are set-null, matching `maintenance_schedule.group_id`. A disbanded committee
  leaves its items unowned, and they fall back to staff.
- A copied value is a copy, the same bargain `duty_list_id` already makes. Editing a template
  never reaches back into a show's items.
- A new partial index serves the queue:
  `work_order_group_open_idx ON (group_id, due_at) WHERE group_id IS NOT NULL AND resolved_at IS NULL AND cancelled_at IS NULL`.
- `applyDutyList` copies all three columns.
- **A person** within the committee is a `volunteer_signup` on the work order. A member claims it
  (`claimShift` already accepts an unscheduled work order) or is invited to it (`inviteToShift`).
  The existing assignee rules for ticking tasks apply unchanged.
- `volunteer_role_id` stays `NOT NULL`. A deliverable is still volunteer work that someone logs
  hours against, so it keeps a role (#1707).

### 2. Done is derived: `done_when`

`workDoneConditions` is a **closed enum in `config.ts`, evaluated by one registry in code**. Each
member names a fact about the work order's show. A template decides _which_ condition an item
uses, and that choice is data. _How_ a condition is evaluated is a typed, reviewed function. A
predicate stored as data could not be validated or typed, and it would be SQL that no review
reads. Adding a condition is one entry in the enum and one in the registry, the same pattern as
`reminders` in `src/lib/server/reminders/registry.ts`.

| Condition              | Holds when                                                                                                  | Shares its predicate with  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------- |
| `production_confirmed` | The show's production status is `confirmed`, `completed`, `settled` or `closed`                             | `publishBlockers`          |
| `artifacts_requested`  | Every act `requestableActs(eventId)` returns has at least one live `artifact_request` on this show          | `artifact-request-service` |
| `poster_set`           | The listing has a poster (`eventPosterKeySql`)                                                              | `publishBlockers`          |
| `description_set`      | The listing's description is non-empty after trimming                                                       | `publishBlockers`          |
| `event_published`      | The listing's status is `published`                                                                         | —                          |
| `shifts_filled`        | Every live, scheduled work order on the show that has **no** `group_id` has claims at or above its capacity | `listShortStaffedShifts`   |
| `close_out_done`       | `outstandingCloseOutTasks(productionId)` is empty                                                           | The `closed` gate          |
| `production_settled`   | The production's status is `settled` or `closed`                                                            | —                          |
| `tasks_ticked`         | Always holds. The work order's own tasks carry the whole condition                                          | —                          |

The derived state of a work order is:

```text
cancelled  if cancelled_at is set
done       if resolved_at is set
           or (done_when is set, its condition holds, and every task on it is ticked)
overdue    if not done and due_at < now
open       otherwise
```

- **The tasks count too.** A condition says the fact exists, and the ticks say the rest was done.
  Communications' item is done once the show is published _and_ its four promotion tasks are
  ticked. That is the ruling's "published, then ticked by hand".
- **Nothing is stored when the condition comes true.** If the poster is removed, the item is open
  again, as `artifact_request` behaves. `resolved_at` remains the hand override ("done anyway"),
  with `resolved_by_user_id` saying who.
- `evaluateDone(workOrders)` in `src/lib/server/volunteer/done-conditions.ts` takes a batch. It
  groups the work orders by show and runs one query per condition kind in use, so a queue of forty
  items is a handful of selects, not forty.
- **Where two readers check the same fact, they share it.** The confirmed-status list and the
  poster and description checks move into shared helpers. `publishBlockers` and the registry both
  call them, so the gate and the deliverable cannot disagree. The gate's messages do not change.
- **Deliverables never gate anything.** `publishBlockers` and the `closed` gate keep reading the
  facts. An item marked done by hand does not let an unposted show publish.

### 3. Default deliverables for a show

A show's defaults are **one duty list**, `Show deliverables`, with these settings:

- `subject = 'event'` and `anchor = 'start'`.
- `auto_apply_on = 'production.created'`, a new value in `dutyListAutoApplyTriggers`, emitted by
  a new `production.created` domain event after the production's batch is written.
- It is applied by a listener, as `reservation.first` applies the orientation list.
  `DutyListAlreadyAppliedError` makes a re-delivered event harmless.
- General projects have no default list. "Defaults by `project.kind`" is exactly one kind today.

The template is data, so a committee can change an offset, a task or an owner on
`/staff/volunteer/duty-lists` without a deploy. It is written by a data migration and seeded
with the same rows:

| Order | Title                                                      | Owner             | Role            | Due                       | `done_when`            | Tasks                                                                                                                  |
| ----- | ---------------------------------------------------------- | ----------------- | --------------- | ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 10    | Lineup confirmed, deal agreed                              | Booking           | Booking Lead    | −28 days (`-40320`)       | `production_confirmed` | —                                                                                                                      |
| 20    | Act artifacts requested                                    | Booking           | Booking Lead    | −21 days (`-30240`)       | `artifacts_requested`  | —                                                                                                                      |
| 30    | Poster art made                                            | Art & Merchandise | Poster Art      | −21 days (`-30240`)       | `poster_set`           | —                                                                                                                      |
| 40    | Description written                                        | Booking           | Booking Lead    | −21 days (`-30240`)       | `description_set`      | —                                                                                                                      |
| 50    | Poster distributed; announced on social, press, newsletter | Communications    | Show Promotion  | −14 days (`-20160`)       | `event_published`      | Poster distributed · Announced on social · Sent to press · In the newsletter                                           |
| 60    | Advance with the acts                                      | Production        | Production Lead | −7 days (`-10080`)        | `tasks_ticked`         | Set times confirmed with every act · Riders and stage plots in · Backline agreed · Load-in details and door split sent |
| 70    | Crew shifts filled                                         | Production        | Production Lead | −3 days (`-4320`)         | `shifts_filled`        | —                                                                                                                      |
| 80    | Load-out and room reset                                    | Production        | Production Lead | The morning after (`720`) | `close_out_done`       | —                                                                                                                      |
| 90    | Settlement recorded                                        | Production        | Production Lead | +3 days (`4320`)          | `production_settled`   | —                                                                                                                      |

- Offsets are in minutes from the listing's start. The ruling calls them starting defaults.
- "Night of" is measured from the show's start, because the list has one anchor.
- The load-out _crew_ keeps its own list, anchored at `load_out`.
- **Roles.** Booking Lead exists. The migration adds **Poster Art**, **Show Promotion** and
  **Production Lead**, using `INSERT OR IGNORE` on the unique `volunteer_role.name`, in group
  `away-from-shows` (#1707).
- **Owners** are found by slug, falling back to name, which is the lookup #1702's migration
  uses. The slugs are `booking-committee` and `production-committee` (`showCommitteeSlugs`), plus
  the Communications and Art and Merchandise slugs. Phase 2 confirms those two against production,
  read-only, before writing the migration. A committee that is missing leaves its item's
  `group_id` null rather than failing the migration.
- **Existing shows get no deliverables.** Production had two productions on 2026-09-25. Staff can
  apply the list to one by hand, through the existing `applyDutyList` form.
- **The seed** adds the Communications and Art and Merchandise committees and the list. It also
  takes the advance item out of "Standard Show", which becomes crew only, because its tasks now
  live on row 60.

### 4. What an assignment drives: queues

- **The committee's own queue.** `/member/groups/[slug]` gains an **Open items** tab, for
  committees only and hidden while empty, as Projects is.
  - It lists every item this committee owns that is `open` or `overdue`, across every show. Each
    row shows the title, the show and its date, when it is due (overdue in red), and its assignee
    or "Nobody yet".
  - Members holding `volunteer.manageShifts` get row actions: _Take it_, which claims the item;
    ticking its tasks; _Done anyway_, which resolves it; and _Hand to another committee_, which
    reassigns it.
  - It is served by `listCommitteeOpenItems(groupId)` behind the tab rather than by the page's
    load-bearing query.
- **The show's view.** The production console's Overview gains a **Deliverables** card. It shows
  every item on the show with its owner, assignee, due date and derived state. Staff and anyone
  who can manage the show's work orders can reassign an item there.
- **The coordinator's queue does not flood.** `listWorkOrders()` called with no anchor filter is
  the coordinator's "work nobody has found a time for". It excludes work orders with a
  `group_id`, because those are on their committee's queue instead. Without the exclusion, nine
  items a show would bury it. When it is called with an `eventId` or `projectId`, it still
  returns them, and the Deliverables card is built on that call.
- **A member's own list** already shows work they hold a signup for. Nothing changes there.

### 5. What an assignment drives: notices

**Cancellation.** When a show is cancelled, either by moving the production to `cancelled` or by
cancelling its listing, one batch does the following:

1. It reads the show's `open` and `overdue` committee-owned items.
2. It cancels them, setting `cancelled_at` and `cancelled_by_user_id` to the canceller.
3. It notifies the active members of **every committee that had one**. Each person gets one
   notice, which lists their committee's open items on that show.

There is no special case: a committee with nothing open hears nothing. This replaces the
recipient rule of #1702's `production_cancelled`, which was "committees taking part as
`'production'`". The catalogue type, the listener, the template and the "who cancelled it" line
stay as they are, and so do the two choices #1702 made: the canceller gets no notice, and a
listing cancel counts as cancelling the show. A show with no deliverables, which today means a
show created before phase 2, notifies no committee (#1709).

**Reminders are derived, not scheduled.** There are two new entries in the reminders registry.
Both are over committee-owned work orders that are open and have a due date:

| Key                   | Band                 | Subject id            |
| --------------------- | -------------------- | --------------------- |
| `deliverable_due_3d`  | Due in 0 to 3 days   | `{workOrderId}:{due}` |
| `deliverable_overdue` | Due 1 to 14 days ago | `{workOrderId}:{due}` |

- `due()` runs `evaluateDone` over the candidates and drops the done ones, so an item finished
  early is never chased.
- The bands do not overlap, so one drain sends one stage.
- The subject carries the due date, so an item whose date moves is owed its reminders again.
- The recipients are the item's live assignees if it has any, and otherwise the active members of
  the owning committee.
- They send one new event, `volunteer.deliverable_due`, which carries a `stage`, and one new
  catalogue type, `deliverable_due`, in category `shows`.
- An item overdue by more than 14 days gets no further reminders. The queue shows it in red.

### 6. Permission: responsibility never narrows it

- **An assignment grants nothing and takes nothing away.** Owning "Poster art made" does not give
  Art and Merchandise the power to set a poster, and it does not take that power from Booking. The
  tight gates stay where the harm is: settlement and payouts (`finance.refund`), member data and
  moderation. A dangerous action gets its own capability, never an ownership check.
- **An assignment adds no reach.** Owning an item on a show does not write a `project_committee`
  row, so the owning committee's `'owned'` grants do not extend to the show (#1708).
- **What the owning committee may do to its own items** is resolved by the grant machinery that
  already exists. A work order with `group_id` set is a record that committee owns, so
  `requireCommitteeMember(workOrder.groupId, 'volunteer.manageShifts')` covers taking it, ticking
  it, resolving it and handing it on. Staff hold the capability, and a live assignee can still
  tick tasks as today.
- `volunteer.manageShifts` changes label to "Open and keep its work orders". Its `'owned'` reach
  already means records the committee owns, and that now includes the items it owns.
- **The grant migration only adds.** It grants `volunteer.manageShifts` to Booking, Art and
  Merchandise, Communications and Production where they lack it. Each change is audited as
  `capability.grants_changed` by System, and a second run is a no-op. This is the shape of
  `20260924235046_capability_grant_backfill`.
- **Until the re-cut, some items wait on another committee.** Promoting Art and Merchandise's art
  to the poster is still `production.book`, which Booking and staff hold. The Deliverables card
  shows "Art is in; waiting for it to be used" when a delivered `poster_art` request exists and the
  show has no poster. That is honest about where the item is waiting, and it grants nothing.

### 7. What does not change

- `artifact_request` stays the way to ask _acts_. The work order for row 20 is done when those
  requests exist.
- `publishBlockers` and the `closed` gate keep their behaviour and their messages.
- `project_committee`, its roles, and the production-projects capabilities are untouched.
- Crew duty lists, shifts, hours and the member shift board are untouched, apart from the queue
  exclusion in §4.

## Sequencing

`feature/production-projects` is mid-flight: phase 2b is #1702, and phase 3 is being built by
another session. This spec **requires no change to that branch**, and nothing here merges until
its landing PR is on `main`.

- **What this reads from production-projects:** `production.project_id`, `project_committee`,
  `requireProjectCommittee`, the phase 2b cancellation notice, and the rule that a show's duty
  lists stamp `project_id`.
- **Work lands on `feature/committee-deliverables`,** cut from `main` after that landing. The
  committee queue is member-facing, and the feature needs several PRs before it is usable. Phases
  are squash-merged into the branch, and `main` gets one landing PR.
- **No migrations go to `main` before that landing.** A migration on `main` while the
  production-projects branch is open would fork the snapshot lineage its landing has to squash.

## Phases

| Phase   | Content                                                                                                                                                                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | This spec, and the decision issues #1706, #1707, #1708 and #1709. To `main`, docs only                                                                                                                                                                                                                                     |
| 1       | Schema: the five columns and the partial index. `workDoneConditions`, and `production.created` in `dutyListAutoApplyTriggers`. `applyDutyList` copies the new columns. The service checks the group is a committee. Specs against migrated SQLite                                                                          |
| 2       | `done-conditions.ts` and `evaluateDone`, with the shared predicates extracted from `publishBlockers`. The `production.created` event and its auto-apply listener. The data migration (roles, the `Show deliverables` list, the `volunteer.manageShifts` grants) and the seed. A spec per condition, run on migrated SQLite |
| 3       | Queues: `listCommitteeOpenItems`, the Open items tab, the Deliverables card, the reassign, take, tick and done-anyway actions under §6's guard, and the coordinator-queue exclusion. Allowed and denied matrices for each committee                                                                                        |
| 4       | Notices: the cancellation rule replacing #1702's recipients, the two registry reminders, `deliverable_due` in the catalogue, and email previews                                                                                                                                                                            |
| Landing | One squashed commit onto `main`, with `Fixes #1701` and the decision issues. Feature-catalog row, `pnpm docs:routes && pnpm docs:check`, and this spec moves to `shipped/`                                                                                                                                                 |
| Later   | The re-cut below. Not scheduled here, and it gets its own amendment and decision issue                                                                                                                                                                                                                                     |

## Later: re-cut `production.book` and `production.run` by consequence

The owner kept the split for now (ruling 4). Once deliverables carry "whose job", the two
production capabilities no longer need to say it. They can be re-cut by what an action commits
the collective to:

- **"Works on this show"**: `'owned'` reach to every committee on the show. It covers the
  day-to-day edits: times, run of show, the advance, expenses, poster art and the description.
- **"Commits CMC externally"**: the deal terms, confirming the lineup, and cancelling the show.
- **Payouts stay `finance.refund`**, and `production.create` stays at org reach.

That phase decides whether owning an item puts a committee on the show (#1708). It also carries
the preserve-behaviour grant migration that every gate change needs. None of it is built by the
phases above.

## Out of scope

- Deliverables for general projects, festivals and markets. The mechanism is general and the
  defaults are shows only.
- Crew shifts on a cancelled show (#1705).
- A committee-facing production console. That is production-projects' open question, and the
  Deliverables card is staff-side.
- Backfilling deliverables onto shows that already exist.
