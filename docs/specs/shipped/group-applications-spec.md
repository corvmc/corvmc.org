# Group applications: one way to apply to a club or a committee

> ## Status
>
> 📦 Built (#1700): behaviour is in `docs/development/business-workflows.md` §24. What survives
> here is the design and the options weighed. The choices an agent made are for the owner to confirm: #1727 (one mechanism, and the
> migration), #1728 (questions per kind), #1729 (accepting invites) and #1730 (who reviews).

## Purpose

A group whose `joinPolicy` is `by_application` takes **applications**. An application has answers,
can be withdrawn, and gets a decision for each group it names, with the reason kept. Clubs and
committees apply the same way, through one service, one table pair and one review card.

After this, `joinPolicy` means what it says for every kind. The six committees are
`by_application`, and a committee set to `invite_only` stops taking applications.

## Premise, checked against `main` on 2026-09-29

Checked at `752d940`.

- **There are two ways to apply, and neither knows about the other.**
  - The generic path (`joinGroup` → `group_member.status = 'requested'`) has no content.
    `approveApplication` flips the row to `active`, `declineApplication` deletes it, and
    `unique(groupId, userId)` means an applicant can never come back.
  - The committee path (`committee_application` + `committee_application_choice`, #1151,
    2026-09-14) has two board-set questions, withdrawal, several committees per submission, a
    decision per committee with notes, and acceptance by invitation.
- **The committee path ignores `joinPolicy`.** Production's committees were created `invite_only`
  (`scripts/db/backfill/committees.sql`). So `/member/groups` lists them under "Invite only… the way
  in is a conversation", while `/member/volunteer/committees` takes applications to them.
- **The dev seed has both queues on one committee.** Booking Committee is `by_application` in
  `scripts/seed/groups.ts`, with a `requested` row, and it also has committee applications from
  `scripts/seed/committee-applications.ts`.
- **This was a decision that drifted, not an accident.** `committees-and-roles-spec.md` (#607)
  said a committee is a `by_application` group. Two weeks later #1151 built a separate entity
  instead, because the `requested` row carries no content and cannot be re-applied. The schema
  comment on `committee_application` says so.
- **Nobody is told when someone applies**, on either path. That is filed separately as #1726.

## The handoff

1. **A member finds a group** on `/member/groups`, on its public page, or, for committees, on
   `/member/volunteer/committees`.
2. **They apply.** They answer the kind's questions and, for committees only, may tick several.
3. **A reviewer answers for each group.** The reviewer is the group's owner or an admin, or for a
   committee a holder of `committee.reviewApplications`. They can mark the applicant contacted,
   accept, or decline with a reason.
4. **Acceptance is an invitation.** The applicant takes the seat by accepting it.
5. **The applicant sees every decision** and its reason on their own list. They may withdraw an
   open application, and may apply again once nothing for that group is open.

## The design

### 1. Tables: `group_application` and `group_application_choice`

The committee tables' shape, under the name of the thing they now are. Both are new tables. The
committee tables stay until [the contract PR](#phases).

| `group_application`        | Type                   | Notes                                |
| -------------------------- | ---------------------- | ------------------------------------ |
| `id`                       | text PK                |                                      |
| `user_id`                  | FK `user`, cascade     | Indexed                              |
| `answers`                  | JSON `{ [qid]: text }` | Keyed by question id, default `'{}'` |
| `withdrawn_at`             | timestamp, nullable    | Withdraws the whole application      |
| `created_at`, `updated_at` | timestamp              |                                      |

| `group_application_choice`               | Type                            | Notes                                            |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `id`                                     | text PK                         |                                                  |
| `application_id`                         | FK `group_application`, cascade |                                                  |
| `group_id`                               | FK `group`, cascade             |                                                  |
| `status`                                 | `groupApplicationStatuses`      | `submitted`, `contacted`, `accepted`, `declined` |
| `review_notes`                           | text, nullable                  | Shown to the applicant                           |
| `decided_by_user_id`                     | FK `user`, set null             |                                                  |
| `decided_at`, `created_at`, `updated_at` | timestamp                       |                                                  |

The indexes are `unique(application_id, group_id)` and `(group_id, status)`, as on the committee
table. Add both tables to `scripts/d1-table-order.mjs`.

`committeeApplicationStatuses` and its labels become `groupApplicationStatuses` in `config.ts`.
Nothing else about them changes.

### 2. Questions belong to the kind

`groupApplicationQuestions: Record<'club' | 'committee', readonly { id; prompt }[]>` in
`config.ts`:

- `committee`: `experience` and `vision`, the board's two questions, unchanged.
- `club`: `note`, "Anything the leaders should know?". The club's `joinInstructions` are shown
  above it.

Every answer is optional and capped at `COMMITTEE_ANSWER_MAX`, which is renamed
`APPLICATION_ANSWER_MAX`. `config.spec.ts` keeps the Zod fields and this list together, as it does
today.

### 3. The service: `src/lib/server/group/application-service.ts`

`committee-application-service.ts` is renamed and generalised. Its rules become the rules:

- **`submitApplication(userId, { groupIds, answers })`**
  - Every group must exist, be undeleted, and be `by_application`. The policy is read from the row,
    never from the request.
  - Several `groupIds` are allowed only when every one of them is a committee. Otherwise it throws
    `OneGroupPerApplicationError` (422).
  - Answers are filtered to the kind's question ids.
  - Groups the applicant is already on (any `group_member` row, including a pending invitation),
    or already has an open choice for, are dropped. If nothing is left, it throws
    `NothingToApplyForError`.
  - It writes one application and one choice per remaining group.
- **`withdrawApplication`**, `listForApplicant`, `listForGroup` (was `listForCommittee`),
  `markContacted`, `acceptApplication` and `declineApplication` are unchanged apart from the
  table names. Accepting still calls `invite(groupId, userId, 'member', null, actorId)`.
- **Re-applying:** only open choices block a new one, so a declined or accepted-then-left
  applicant can apply again. There is no cooldown.
- `openApplicationCount` and `countOpenForGroup` feed the badges, for any kind.
- `listOpenByCommittee` stays committee-only, for `/staff/committees`.

`joinGroup` loses its `by_application` branch. It handles `open` only, and throws
`ApplyInsteadError` (422) for a `by_application` group, which the UI never triggers.
`approveApplication` and the old `declineApplication` in `group-service.ts` are deleted.

### 4. Who reviews: `requireApplicationReviewer(ref)`

`requireCommitteeReviewer` in `group-context.ts` becomes `requireApplicationReviewer(ref)`:

1. The caller's role on the group is `owner` or `admin`, for any kind, or
2. the group is a committee and the caller holds `committee.reviewApplications`.

Otherwise it returns 403. `group.manage` alone does not qualify. Every review write re-scopes the
choice id to the group the guard resolved, as `takeOpenChoice` does now.

### 5. Remotes: `src/lib/remote/group-applications.remote.ts`

`committee-applications.remote.ts` is renamed.

- **`applyToGroups`** (form): `requireUser`, then `groupIds[]` plus one optional field per question
  id, spelled out rather than generated so the fields keep their types. It replaces
  `applyToCommittees`, and the club apply dialog uses the same form.
- **`withdrawGroupApplication`** (form): the applicant's own application.
- **`markApplicantContacted`**, **`acceptGroupApplication`** and **`declineGroupApplication`**
  (forms): these go through `requireApplicationReviewer`. They refresh `getMemberGroup`, the staff
  group page and the committee queue.
- **`getCommitteeApplyPage`** (query): unchanged apart from reading the new service.
- **`getCommitteeApplicationQueue`** (query): unchanged, still `committee.reviewApplications`.
- `approveApplicationForm` and `declineApplicationForm` in `groups.remote.ts` are deleted.
  `joinGroupForm` serves `open` groups only.

`getMemberGroup` and `getStaffGroupPage` return `applications` (from `listForGroup`) when the
viewer may review, in place of the roster's `requested` partition. They stay one query each.

### 6. What members and reviewers see

- **`JoinGroupAction`**, `policy="by_application"`: for a club, **Apply** opens a dialog with
  `joinInstructions`, the `note` field and a submit button, posting `applyToGroups` with one group
  id. For a committee, **Apply** links to `/member/volunteer/committees?committee=<slug>`, which
  ticks it.
- **`/member/volunteer/committees`**: unchanged in layout. It is the committee kind's apply page,
  and "your applications" lists only committee applications.
- **`/member/groups`**: the "you asked to join" list reads open choices (any kind) instead of
  `requested` rows. Each row gets **Withdraw**, and shows the decision and the reason once there
  is one. The six committees move from "Invite only" to "Apply to join".
- **`/member/groups/[slug]`** and **`/staff/groups/[id]`**: one `ApplicationsCard` in
  `$lib/components/groups/` replaces `CommitteeApplicationsCard` and `CommitteeApplicationsSection`.
  It shows the answers under the kind's prompts, and each row has **Contacted**, **Accept** and
  **Decline** (with an optional reason). The roster no longer has an applicants partition.
- **`/staff/committees`**: unchanged.

Forms use `$lib/components/ui/Form/`. No gradients.

### 7. The migration

One custom migration, made with `pnpm exec drizzle-kit generate --custom` in the same PR as the
tables. Every statement is idempotent on its target id:

1. Copy `committee_application` into `group_application`, and `committee_application_choice` into
   `group_application_choice`. The ids are the same, so a re-run collides and writes nothing.
2. Each `group_member` row with `status = 'requested'` becomes a `group_application`
   (`id = 'migrated-request-' || group_member.id`, `answers = '{}'`, `created_at` kept) with one
   `submitted` choice.
3. Delete those `requested` rows. `invite()` would otherwise hit `unique(group_id, user_id)` when
   such an applicant is accepted.
4. `UPDATE "group" SET join_policy = 'by_application' WHERE kind = 'committee'`.

The old Worker keeps writing committee applications to the old tables for the minute between the
migration and the publish. The contract PR copies again, with the same statement 1, before it
drops anything.

## Seed

- `scripts/seed/committee-applications.ts` becomes `group-applications.ts`, writing the new tables.
  It keeps a multi-committee application, a declined choice with notes, and a withdrawn
  application.
- `scripts/seed/groups.ts` writes Booking Committee's applicant as an application, not a
  `requested` row. It also adds one `by_application` **club** with an open application carrying a
  `note`, since no club path is seeded today.
- `scripts/seed/group-leaders.ts` keeps one leader per policy.

## Tests

- `application-service.spec.ts`: renamed from the committee spec, plus
  - `invite_only` and `open` groups refuse applications, and a club refuses a second group id;
  - re-applying after a decline creates a new choice and keeps the old one;
  - a pending invitation counts as "already on".
- `group-context.spec.ts`: `requireApplicationReviewer` admits an owner or admin of any kind, and
  the capability holder on a committee only. It refuses a `group.manage` holder, and refuses the
  capability holder on a club.
- `group-applications.remote.spec.ts`: guards first, and the choice id is re-scoped to the guarded
  group.
- A migration spec on `migratedSqlite()`, in the shape of `capability-grant-backfill.spec.ts`:
  committee rows copied once, `requested` rows moved and deleted, committees flipped, a second run
  a no-op.
- `groups.remote.roster.spec.ts`: the `requested` partition is gone.
- Run `pnpm vitest --run --project=server src/lib/server/group` for the blast radius.

## Phases

1. **Switch** (member-facing, one PR): §1 to §7, the seed, the tests, and
   `docs/development/business-workflows.md`, and any help article that describes joining a group. Add a feature
   catalog row. The flow is usable the moment it deploys.
2. **Contract** (its own PR, since a drop runs after publish): copy stragglers again, drop
   `committee_application` and `committee_application_choice`, and remove `'requested'` from
   `groupMemberStatuses`. That enum change emits no SQL; its cost is every place that splits a
   roster by status.

## Out of scope

- Notifying reviewers of a new application (#1726).
- Per-group questions. #1728 records them as a later, additive option.
- Bands. They stay `invite_only`, and the service keeps refusing any other policy for them.
