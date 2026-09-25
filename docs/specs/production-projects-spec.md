# Productions are projects

> ## Status
>
> **Approved by the owner on 2026-09-25; being built on `feature/production-projects`** (#1673).
> Phase 0 is this document. The committee roles and the two capabilities are recorded as
> decisions for the owner to confirm in the issues linked from #1673.

## Purpose

[domain-model.md](../architecture/domain-model.md) says **a show is a project**, and
[project-spec.md](project-spec.md) drew the three layers that follow from it: `project` (a body
of work with a budget and an owner), `event_listing` (the advertisement) and `production` (a
show's back-of-house). The schema never joined the first and the third. A production today has:

- no budget and no burn — what a night cost lives in `production_expense`, what it took lives
  in `financial_entry`, and nothing adds them up against a ceiling;
- no owning committee — Booking and Production do the work, but `production` names neither;
- one guard for everything — every write on the console is `requireCapability('event.manage')`,
  a staff-wide power, so neither committee can be handed its own half of a show.

The fix is to make every production a project, specialised: the project carries what every
body of work has, and the production keeps what only a show has.

## The design

### 1. `project.kind`

`project.kind` is `'general' | 'production'`, default `'general'`. `production.project_id` is
**required and unique**: a production is always the specialisation of exactly one project, and
a project is specialised by at most one production.

| On the project (generic)           | On the production (the show layer)              |
| ---------------------------------- | ----------------------------------------------- |
| Name, description, status          | The production status machine                   |
| Budget and derived burn            | Slots, acts and deals (`production_slot`)       |
| Start and end dates                | Run of show, advance, load-in … load-out        |
| The committees taking part (below) | Door take and settlement, expenses, act payouts |
| Attached work orders, jobs, orders | The named producer                              |

**Creating a production creates its project in the same `db.batch`**: the project row
(`kind = 'production'`, named for the listing, dated from the listing's start and end), the
production row pointing at it, the `project_committee` rows for the show committees, and
`event_listing.project_id` set to the new project. There is no path that writes one without the
other.

`project.status` and `production.status` stay separate machines. A project's status is the
suggestion pipeline's vocabulary (`open … done`); a production's is the show's
(`draft … closed`). Advancing a production to `completed` moves its project to `done`, and
`cancelled` moves it to `declined`, in the same batch. Nothing moves the other way: a project
status change never drives the show.

The project's dates **mirror the listing** for a production: the listing's update path rewrites
`project.starts_at` and `ends_at` in the batch that moves the listing. They are not edited on the
project page for a production.

`event_listing.project_id` stays. For a listing that announces a production, it equals
`production.project_id`; the service keeps the two equal, and the backfill makes them so.

### 2. Several committees take part in one project

A `project_committee` join replaces the single owner in `project.group_id`:

| Column       | Notes                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `project_id` | cascade                                                               |
| `group_id`   | cascade; a committee (`group.kind = 'committee'`), checked by service |
| `role`       | `projectCommitteeRoles`: `'owner' \| 'booking' \| 'production'`       |
| `created_at` |                                                                       |

Primary key `(project_id, group_id)`: a committee takes part in a project once, in one role.
An index on `group_id` serves "my committee's projects".

- A **general** project has one `'owner'` row, which is what `project.group_id` said.
- A **show** has two rows: Booking as `'booking'` and Production as `'production'`. They are
  found by slug (`showCommitteeSlugs` in `config.ts`: `booking-committee`,
  `production-committee`). A missing or deleted committee is skipped rather than refused, so a
  show can still be created on a database without them.

**Grant reach.** A committee grant with `'owned'` reach now resolves against every project the
committee _takes part in_, whatever its role. The role records why the committee is there; the
committee's own grant list says what it may do. Booking holding `production.book` and Production
holding `production.run` is what divides a show between them — not the role column.

`project.group_id` is read by nothing once phase 2 lands and is dropped in phase 4, after the
landing PR has deployed. Until then the project service writes both, so a rollback between
phases leaves ownership intact.

### 3. Two new capabilities

```ts
production: ['book', 'run'];
```

Both are grantable to a committee with `'owned'` reach, and both are staff powers through the
derived `staffCapabilities`, so **staff keep full access** with no matrix edit.

| Capability        | Covers                                                 | Held by (seed and data migration) |
| ----------------- | ------------------------------------------------------ | --------------------------------- |
| `production.book` | Acts on the bill, offers, deals, billing, poster art   | Booking                           |
| `production.run`  | Run of show, advance, crew, door, expenses, settlement | Production                        |
| `event.publish`   | Publishing a project's draft listing (unchanged)       | Booking                           |

Every production guard moves onto one of these, through a new
`requireProjectCommittee(projectId, cap)`: an active member of a live committee that takes part
in the project and whose grant list carries `cap` passes; otherwise `can(cap)` covers staff;
otherwise 403.

| Remote function                                                              | Today            | Becomes                                                           |
| ---------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `createProduction`                                                           | `event.manage`   | `production.book` (position only — no project yet)                |
| `setStaffEventLineup` on a listing with a production                         | `event.manage`   | `production.book`                                                 |
| `setRunOfShowTerms` (the deal)                                               | `event.manage`   | `production.book`                                                 |
| `usePosterArt`, `usePosterArtWithFooter`, `useTemplateFlyerAsPoster`         | `event.manage`   | `production.book`                                                 |
| `updateProduction`: `actsWanted`, `billingNotes`                             | `event.manage`   | `production.book`                                                 |
| `updateProduction`: the five times, hospitality, internal notes              | `event.manage`   | `production.run`                                                  |
| `advanceProduction` to `offered`, `confirmed`, `draft`, `cancelled`          | `event.manage`   | `production.book`                                                 |
| `advanceProduction` to `completed`, `settled`, `closed`                      | `event.manage`   | `production.run`                                                  |
| `setProductionProducer`, `markSlotTiming`, `recordDoorTake`, `openHostShift` | `event.manage`   | `production.run`                                                  |
| Run-of-show slots: add, update, move, remove, build from lineup              | `event.manage`   | `production.run`                                                  |
| `addProductionExpense`, `removeProductionExpense`                            | `event.manage`   | `production.run`                                                  |
| `askForArtifact`, `dropArtifactRequest` (the advance)                        | `event.manage`   | `production.run`                                                  |
| `recordActPayout`                                                            | `finance.refund` | unchanged — paying an act is the treasurer's                      |
| `getStaffEventProduction` (the console's read)                               | `event.read`     | `event.read`, or either production capability through the project |

`updateProduction` guards on **what changed**, not on the form: it compares each submitted field
with the stored row and asks for `production.book`, `production.run` or both. The form renders
every current value into its field, so a field that arrives equal to the row is untouched.

**The named producer stays** as it is: a column saying who is running the night, claimed by
someone who can already run the show. It is not a capability and grants nothing.

The existing `requireCommitteeMember(project.groupId, cap)` call sites on projects —
`setCommitteeProjectStatusForm`, `createCommitteeProjectWorkOrderForm`,
`publishCommitteeProjectEventForm`, `applyDutyListToProjectForm` — move to
`requireProjectCommittee(project.id, cap)`. Markets, maintenance schedules and the reports tab
keep `requireCommitteeMember`, because what they guard is a committee's own record rather than a
project.

**Nobody loses access.** Phase 2 carries an idempotent data migration, in the shape of
`20260924235046_capability_grant_backfill`: Booking gains `production.book`, Production gains
`production.run`, each audited as `capability.grants_changed`. Before phase 2 only staff could
touch a production, and staff still can, so the migration only adds.

### 4. Crew work on the show's clock

`dutyListAnchors` already carries `load_in`, `first_set`, `curfew` and `load_out` (#697). This
adds **`soundcheck`**, resolved from `production.soundcheck_at` with the same "no production /
no time set" refusals as the other four.

**Shifts re-time when their anchor moves.** When `updateProduction` changes one of the five
production times, or the listing's update path changes doors, start or end, every live work
order on that listing whose duty list is anchored to the moved time shifts by the same delta —
`starts_at`, `ends_at` and `due_at` alike. A delta rather than a recomputation from the item's
offset, for two reasons: `work_order` does not record which `duty_list_item` produced it, and a
shift a coordinator moved by hand keeps its adjustment. Cancelled and resolved work orders do not
move. The shift is written in the same batch as the time that moved it.

Work orders may also anchor to the project: `work_order.project_id` already exists (#1418), and
the duty list applied to a show stamps its production's `project_id` alongside `event_id`, so a
show's crew counts toward its project's labour burn.

### 5. A show's money rolls up into its project's burn

`getProjectBurn` gains a `show` block, read from the ledger and the production's own tables:

| Figure         | Source                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| Ticket revenue | `financial_entry`, `subject_type = 'ticket'`, `kind = 'earned'`                       |
| Acts' pool in  | `financial_entry`, `subject_type = 'ticket'`, `kind = 'pass_through'`, positive       |
| Act payouts    | `financial_entry`, `subject_type = 'production'` (`act_payout`, `act_guarantee`)      |
| Show expenses  | `production_expense`, committed when recorded — as purchase orders count when ordered |
| Purchases      | `purchase_order` with this `project_id` — already counted, not added twice            |

Spend against the budget (`cash.totalCents`) gains show expenses and guarantee top-ups
(`act_guarantee`, the collective's own money). Pass-through money — the acts' pool coming in and
going out — is shown and never counted as spend, because it was never the collective's.

The ledger rows are found by `financial_entry.project_id`, which the writers now set:
`ticket-entries`, `checkout-entries-listener`, `payout-entries` and
`production-expense-entries` resolve the listing's project when they record. Phase 1's migration
fills `project_id` on existing show rows (matched by `settlement_group`, `metadata.eventId` or
the production subject). `project_id` is a classification the database already rewrites on
`set null`; filling it is not a correction to an entry, so the append-only rule is untouched.
`production_expense` ledger rows are skipped by burn, which reads the table directly.

### 6. Deferred: festivals

A parent project over several shows is the festival case project-spec.md always intended. It is
out of scope here. Nothing in this design prevents it: a show's project would gain a
`parent_project_id`, and burn would sum over children.

## The staff nav

The restructure the owner decided earlier, landing in phase 3:

- **Planning** (new section): Committees, Suggestions, Ballots, Projects, Agreements and the
  Annual Report.
  - **Committees** is `/staff/committees`, now a list of committees, each with a badge for its
    pending applications. It replaces the combined application queue; each committee's
    applications are on its own page (#1671).
  - **Agreements** groups Sponsors, Grants and Renewals.
- **People**: Clubs at `/staff/clubs`. The Groups entry is removed.
- **Moderation**: Content Flags and Classifieds only.
- **Events**: Productions stay here.
- Resource Tips stays a child of Local Resources, labelled "Tips", with the
  `resourceTipsPending` badge on both the child and the parent (#1672).

Moved URLs redirect (`/staff/groups` to `/staff/clubs`, and a committee's
`/staff/groups/[slug]` to its committee page), links are updated, and
`pnpm docs:routes && pnpm docs:check` runs.

## Phases

| Phase   | Content                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0       | This spec. Decision issues for the committee roles and the two capabilities                                                                                                                                                                |
| 1       | Schema: `project.kind`, `project_committee`, `production.project_id` (required, unique). Idempotent backfill: a project for every production, `project_committee` from `project.group_id`, ledger `project_id` on show rows. Drops nothing |
| 2       | `requireProjectCommittee`, services and guards on the join and the new capabilities; production creation in one batch; re-timing; the burn roll-up; the preserve-behaviour grant migration; allowed and denied spec matrices per committee |
| 3       | UI: budget and burn on the production page, a kind filter on Projects, the soundcheck anchor, the staff nav restructure with redirects                                                                                                     |
| Landing | One squashed commit onto current `main`, `Fixes` for every issue, one `snapshot.json` in the newest migration folder                                                                                                                       |
| 4       | After deploy: a drop-only migration removing `project.group_id`                                                                                                                                                                            |

## Backfill

Every step is idempotent, so a second run changes nothing:

1. For each production with no `project_id`: adopt its listing's `project_id` when that project
   announces no other production, otherwise create a project (`kind = 'production'`, named and
   dated from the listing). A scratch mapping table carries the pairs within the migration and is
   dropped at its end.
2. Mark adopted projects `kind = 'production'`, and set the listing's `project_id` to match.
3. `INSERT OR IGNORE` a `project_committee` `'owner'` row for every `project.group_id`, and
   `'booking'` and `'production'` rows for every production's project, where those committees
   exist.
4. Fill `financial_entry.project_id` on show rows that have none.

Production had two productions and no projects on 2026-09-25, so step 1 creates two projects.

## Open questions

- Whether a committee that takes part in a show should see the production console from
  `/member/groups/[slug]` rather than needing the staff panel. The guards in phase 2 already let
  it act; a committee-facing console is a follow-up surface, not part of this feature.
- Whether `production.book` should be split from `event.publish` for a show, or whether Booking
  publishing its own show remains one grant.

## Out of scope

- Festivals and seasons (parent projects).
- Changing `event_listing` or the gig guide. The advertisement layer is untouched.
- A committee-facing production console (see open questions).
