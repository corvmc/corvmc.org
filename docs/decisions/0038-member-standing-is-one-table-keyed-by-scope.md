# 0038 Member standing is one table keyed by scope

- **Date:** 2026-08-17
- **Status:** Accepted

## Context

Three tables recorded what an upheld report cost a member: `community_event_standing`,
`suggestion_standing` and `messaging_standing`. The suggestion board (#212) had copied the first
on purpose and set a rule: merge when a third domain needs standing. Direct messages (#213) added
the third. The first two tables had a `requiresReview` boolean. The messaging table had a
three-state `status` and a `source` column, because a member could switch their own messaging off
in the same row staff used to restrict it.

## Decision

One table, `member_standing`, keyed `(userId, scope)`. Merged in #224.

1. **Scope does not collapse.** An upheld report about a gig listing costs nothing on the
   suggestion board. Staff restore each scope separately.
2. **One ladder, `none` / `restricted` / `disabled`, for every scope.** `standingScopeConfig`
   lists the rungs each scope may hold, and `setStanding` throws on any other. `restricted`
   means "act behind a gate": staff review for posting scopes, reply-only for messaging.
3. **Standing records only what was done to a member.** `setStanding` requires a staff id, and
   no member-facing path writes a row. The member's own switch moved to
   `user.acceptsDirectMessages`, and `source` was dropped. `messagingIsDisabled` recombines the
   two and returns one boolean, so a sender cannot tell a staff decision from a preference.
4. **Restoring updates and never inserts.** It sets `none` and keeps `reason` and
   `triggeringFlagId`, so a cleared member reads differently from one never restricted.
5. **`scopeForFlag` is the one place a flag type maps to a scope.** An `event` report costs
   standing only for a community listing; profile reports cost none.

## Alternatives rejected

- **A single global standing per member.** One bad listing would cost a member the suggestion
  board too.
- **A per-scope status type.** It cannot be one SQLite text column, and every query would turn
  scope-conditional.
- **Keeping `requiresReview` beside `status`.** Two columns would encode one ladder.
- **Deriving `source` at read time and letting members keep writing rows.** A member could still
  write a moderation record.

## Consequences

- A new scope needs a code path that reads it, plus a line in `standingScopeConfig`.
- Every row is something an appeal can contest, because no row is self-imposed.
- The migration ran in three steps (additive migration, idempotent backfill, then the drop),
  because D1 has no transactions.
