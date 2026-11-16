# 0077 A removal is a record of an upheld report

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2552](https://github.com/corvmc/corvmc.org/issues/2552)

## Context

A ban (#1345) wrote `bannedAt`, `bannedById` and `banReason` on the `user` row and then
deactivated the account. It had no term, no report behind it, and no appeal; the member was told
to email staff. A second ban overwrote the first, so the history of removals lived only in the
audit log, which is best-effort and pruned at 24 months. Nothing stopped a banned address from
creating a new account after a purge.

## Decision

**A suspension or ban is an `account_removal` row resting on an upheld report.** Built in #2707
and on `feature/suspensions`.

1. `user.deletedAt` stays the only enforcement predicate. The row explains it and never enforces
   by itself, so no second predicate has to agree with the ~190 `deletedAt` readers.
2. One row per removal, never upserted. The open removal is the row with no `liftedAt`; a partial
   unique index allows one per member and refuses a concurrent second removal.
3. Every row carries a `flagId`. A staffer acting alone files a `staff_action` report, as
   standing does ([0039](0039-moderation-appeals-hang-off-the-upheld-report.md)), so a removal
   is appealed like any other decision.
4. A suspension has a term. It cancels only bookings that start before the term ends, pauses
   billing rather than cancelling it, and a 15-minute job lifts it when the term ends. A ban
   cancels everything future and lasts until lifted.
5. The ledger records what the removal cancelled, so lifting it gives back exactly that.
6. The removal email carries a signed link that works for 60 days without a session. It names
   one removal; it is single-use because a report admits one appeal. The page never shows the
   staff reason.
7. A ban blocks the address in `email_blocklist`, which has no FK to `user` so a purge keeps it.
   Sign-up reads the list; sign-in never does, so only a recorded removal locks out a member.

## Alternatives rejected

- **An independent ban flag beside `deletedAt`.** Every `deletedAt` reader would have to learn it.
- **A removal kind for self-deletion.** It has no report to appeal, and deactivation already
  records it in the audit log.
- **An appeal through a session.** A removed member cannot sign in.
- **Re-creating a lapsed subscription on lift.** Billing resumes only when it was paused; a lapsed
  membership needs the member's own checkout.

## Consequences

- Restoring an account on appeal needs `user.ban` as well as `moderation.reviewFlags`.
- A removed member keeps a cached session for up to 60 seconds after removal (`session.cookieCache`).
- Bans recorded before this table have no row. Lifting them still works.
- Rebook and resubscribe offers after a lift, and a `reservation` standing scope, are not built.
