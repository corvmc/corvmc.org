# Member Standing

## Purpose

One record of what an upheld report, or a staff decision, has cost a member —
scoped to the domain it happened in.

This replaces three tables that were the same record three times over:
`community_event_standing`, `suggestion_standing` and `messaging_standing`.
`member-suggestions-spec.md` recorded the first duplication as knowing, and set
the trigger for undoing it: _"Two domains is not a pattern; when a third needs
standing, merge all three into a scoped `member_standing`."_ PR #213 (direct
messages) added the third, so the trigger fired and this is the merge.

The merge was not a rename. The first two tables were byte-identical; the third
had a different shape — a three-state `status` ladder instead of a
`requiresReview` boolean, and a `source` column recording who imposed it, because
messaging standing was the one a member could set on themselves. Reconciling
that is most of what follows.

## Scope

**In:**

- `member_standing`, keyed `(userId, scope)`.
- One service — `src/lib/server/moderation/standing-service.ts` — replacing nine
  functions spread across three domain services.
- `scopeForFlag`: the single place a flag's entity type maps to the standing an
  upheld report costs.
- `user.acceptsDirectMessages`: the member's own switch, moved out of standing.
- A backfill (`scripts/db/backfill/member-standing.sql`) and the drop of the
  three old tables.

**Out:**

- Appeals. `docs/specs/moderation-appeals-spec.md` (PR #217) designs an appeal
  against a standing decision and proposes a facade shaped like this table. That
  draft argues the rule-of-three trigger has **not** fired, which this change
  makes false — **it needs revising once this lands.** Nothing here builds an
  appeal, but `restoreStanding({ userId, scope, staffId })` is deliberately the
  signature one would call.
- New scopes. There are exactly three, and each has a code path that reads it.

## Decisions

### Scope does not collapse

The key is `(userId, scope)`, and a single global standing is explicitly
rejected. An upheld report about a gig listing must not put someone on probation
for suggestions: those are unrelated judgements about unrelated behaviour, and
folding them together would mean one bad night on the calendar quietly costing a
member the suggestion board too. This was the original argument for keeping the
tables apart, and it survives the merge intact — it is now a column instead of a
table name.

The staff UI follows from it. `/staff/users/[id]` → Comms still shows a separate
card per restricted scope with its own restore button, rather than one merged
"standing" card, because they are separate decisions and staff forgive them
separately.

### The ladder is shared; each scope declares which rungs are legal

`requiresReview: true` and messaging's `restricted` turned out to be the same
idea wearing two names: **you may still act, but with a gate.** For the two
posting scopes the gate is staff review; for messaging it is reply-only. One rung
up, `disabled` means **you may not act at all.**

So the merged table carries the three-state ladder for every scope, and
`standingScopeConfig` in `src/lib/config.ts` declares which statuses each scope
may actually hold:

| Scope             | Legal statuses                   |
| ----------------- | -------------------------------- |
| `community_event` | `none`, `restricted`             |
| `suggestion`      | `none`, `restricted`             |
| `messaging`       | `none`, `restricted`, `disabled` |

`setStanding` throws `StandingStatusNotAllowedError` on anything else. Nothing in
the app means "you may not post community listings at all", so `disabled` on a
posting scope is an error rather than a value sitting unreachable in the column —
the same reasoning that keeps `member_profile` from being a scope. If a posting
scope ever needs the top rung, adding it is one line in config plus the reader
that acts on it, and the guard is what forces the second half to happen.

Rejected: **a per-scope status union.** It cannot be one SQLite text column, and
it makes every query scope-conditional for a distinction only one scope cares
about. Rejected: **keeping `requiresReview` beside `status`.** Two columns
encoding one ladder is precisely the duplication being removed.

### `source` is dropped, and the member's switch moves out of standing

`messaging_standing` needed a `source` column because it held two unlike things
in one row: a moderation decision, and a member's own preference about who may
contact them. That conflation is what forced the column, the
`MessagingStandingNotYoursError` guard, and a UI branch on `source !== 'member'`.

The fix is the split, not the column. **`member_standing` is now purely a record
of what was done _to_ a member.** Every row is imposed by staff or by an upheld
report; no member-facing path writes one. `setStanding` takes a required
`staffId`, which is the structural form of the rule — there is no argument shape
that expresses a member write, so the self-service axis cannot leak to the
posting scopes by accident. Nobody can take themselves off posting review because
there is no call to make.

What is left carries the provenance already: `triggeringFlagId` non-null means a
report caused it, and `updatedByUserId` names the staffer otherwise. Storing that
a third time is a column that can disagree with its own row, and the seed proved
it could — the old member-sourced row had `source: 'member'` with
`updatedByUserId: null`.

The member's own switch became **`user.acceptsDirectMessages`** (boolean, default
true), sitting beside `directoryVisibility`, `lookingForBand` and
`openToCollaboration` — which is what it always was, a directory-profile
preference about being reachable. `community-events-spec.md` argues standing
belongs in its own table rather than on `user`, which already carries auth,
billing and profile concerns; that argument is untouched, and its mirror puts the
preference on `user`.

Rejected: **deriving `source` at read time and letting members keep writing
standing rows.** It removes the column but leaves a member able to write a
moderation record, which is the part worth removing.

Two halves now decide whether someone can be messaged, and `messagingIsDisabled`
is the one place they recombine: standing `disabled` **or** preference off. The
caller gets one boolean and cannot tell which, deliberately — telling a sender
would leak either a moderation decision or a personal choice.

### Restoring updates, it never inserts

`restoreStanding` is an `UPDATE … WHERE (userId, scope)`, so restoring someone who
was never restricted is a no-op. Absence of a row means good standing; inserting
one here would manufacture a history that did not happen.

It flips the status and leaves `reason` and `triggeringFlagId` in place, so "why
was I in review?" is still answerable after forgiveness. And it sets `none` rather
than deleting the row, so "we looked at this and cleared it" keeps reading
differently from "this never came up".

### `scopeForFlag` is the single mapping site, and is not the identity function

An upheld report is the only thing that costs a member standing, and `resolveFlag`
is the only place that is wired. It used to be wired three times, once per branch,
with the interesting part buried inline: an `event` report touches standing **only
when `event.source === 'community'`**, because a CMC or band gig has no member to
hold responsible.

That mapping is now `scopeForFlag(entityType, { eventSource })` — pure, so it
takes the source the caller already fetched rather than querying, and unit-tested
directly rather than only through `resolveFlag`. `member_profile` and
`band_profile` map to null: staff act on the profile itself, and a scope nothing
reads is a column that lies.

_Who_ pays stays a per-branch lookup in `standingSubjectOf`, because it is a
genuinely different question per entity — the listing's submitter, the
suggestion's author, or the participant who is not the reporter.

One ordering change fell out of the merge: the standing write now happens **after**
the visibility changes rather than interleaved with them. `resolveFlag` marks the
flag resolved first and has no transaction to protect the rest, so a crash part-way
is possible; doing content first means it can never leave someone on probation for
a post that is still up. The suggestion branch already had this order.

## Schema delta

`src/lib/server/db/schema/standing.ts` (new — standing is cross-domain, so it
belongs in none of `event.ts` / `suggestion.ts` / `moderation.ts`):

- **`member_standing`** — `userId` + `scope` composite PK (which is also what
  `onConflictDoUpdate` targets), `status`, `reason`, `triggeringFlagId` →
  `content_flag` (set null), `updatedByUserId` → `user` (set null), `updatedAt`.
  Indexed on `(scope, status)`. **Absence of a row means good standing.**

`src/lib/server/db/schema/authentication.ts`:

- **`user.acceptsDirectMessages`** — boolean, not null, default true.

Dropped: `community_event_standing`, `suggestion_standing`, `messaging_standing`,
along with `messagingStatuses` and `messagingStandingSources`.

The vocabularies (`standingScopes`, `standingStatuses`, `standingScopeConfig`,
`STANDING_REASON_MAX`) live in `src/lib/config.ts` so client code can label a
scope without importing the schema, and the schema imports them **by relative
path** — `$lib/config` breaks `pnpm db:generate`, because jiti has no alias map.

## Migrating the data

Three ordered steps, because `pnpm db:generate` writes DDL from a schema diff and
would otherwise create the new table and drop the old ones in one migration,
taking the rows with them. D1 has no transactions, so ordering is the safety
property — the same discipline as the merge algorithm in `suggestion-service.ts`:
additive first, destructive last, every step re-runnable.

1. **`20260817220002_wonderful_gambit`** — creates `member_standing`, adds
   `user.accepts_direct_messages`. Purely additive.
2. **`scripts/db/backfill/member-standing.sql`**, run with `wrangler d1 execute`.
   Not a migration and deliberately not one. Every statement is idempotent: the
   inserts collide on `(user_id, scope)` and do nothing, and the preference
   update is absolute rather than relative.
3. **`20260817220046_kind_ultimatum`** — drops the three old tables.

The mapping:

| From                                       | scope             | status                                     |
| ------------------------------------------ | ----------------- | ------------------------------------------ |
| `community_event_standing`                 | `community_event` | `requires_review ? 'restricted' : 'none'`  |
| `suggestion_standing`                      | `suggestion`      | same                                       |
| `messaging_standing` where source ≠ member | `messaging`       | copied verbatim                            |
| `messaging_standing` where source = member | —                 | `user.accepts_direct_messages = 0`, no row |

A `requires_review = 0` row is kept as a cleared standing rather than dropped:
it means staff restored it, which is history worth preserving. A member-sourced
row with `status = 'none'` (switched off, then back on) maps to nothing, because
the preference already defaults to true.

Crash states are all obvious. After step 1 the old code still works and the new
table is empty; re-run step 2. After step 2 both shapes exist and re-running
cannot clobber a post-cutover write. Only step 3 is destructive, and it runs last.

`INSERT … SELECT … ON CONFLICT` needs a `WHERE` clause on the SELECT or SQLite
parses the `ON` as the start of a join and fails; two of the statements carry
`WHERE true` for exactly that reason, and the comment there says so.

## Behaviour changes

Everything else is behaviour-preserving. These two follow from splitting standing
from preference, and are choices rather than drift:

1. **A restricted member can now change their own messaging preference.** Under
   the old model `setMessagingStanding` refused any member write once staff or a
   report had set a row, so a restricted member could not even switch themselves
   _off_. Their preference was never staff's to hold, and the restriction stands
   regardless of how the preference is set.
2. **`/member/account` shows the staff notice and the toggle together**, rather
   than hiding the toggle behind the notice. Same reason: they are two different
   things, and the page now says so.

## Permissions

| Who        | Can                                                                       |
| ---------- | ------------------------------------------------------------------------- |
| Signed out | Nothing. Every remote in `standing.remote.ts` starts with `requireStaff`. |
| Any member | Read their own standing in one scope; set `acceptsDirectMessages`.        |
| Staff      | Read every scope, impose a standing, restore one.                         |

Members reach standing only through the read-only, single-scope queries in their
own domain remotes (`getMySuggestionStanding`, `getMyMessagingStanding`, the
`standing` field on their listings). The cross-scope reads and every write live in
`src/lib/remote/standing.remote.ts`, staff-guarded, and pinned by
`standing.remote.spec.ts`.

## Tests

- `standing-service.spec.ts` — the storage and the `scopeForFlag` mapping,
  including the not-identity `event`+`community` case and the illegal-status
  guard.
- `flag-service.spec.ts` — which scope an upheld report charges, and that a
  dismissed one charges nothing. `scopeForFlag` is left unmocked there on
  purpose: stubbing it would assert the community-listing rule against a fake.
- `moderation-service.spec.ts` — that both halves of "unreachable" are consulted
  and stay independent.
- `standing.remote.spec.ts` — the staff guard on every export.
