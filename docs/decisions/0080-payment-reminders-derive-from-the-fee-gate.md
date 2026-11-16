# 0080 Payment reminders derive from the fee gate

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2876](https://github.com/corvmc/corvmc.org/issues/2876),
  [#2981](https://github.com/corvmc/corvmc.org/issues/2981)

## Context

A member with an outstanding fee learned of it only when their next booking was refused (#2859)
or their door code was held (#2874). Nothing told them when the session ended unpaid.

## Decision

1. **Three reminder registry stages, 1, 7 and 21 days after the session ended.** Bands, as the
   overdue loan stages: each runs to the next, and the last ends at 35 days, so one drain sends one
   stage and fees older than five weeks get none. `reminder_sent` makes each stage once per
   reservation.
2. **The fee gate's rows, not a rule of their own.** `listFeesEndedBetween` reads
   `confirmedUnpaidSql` and the **Count from** cutoff, as `listOutstandingFees` does. Paying,
   comping or refunding drops a session before its next stage; with no cutoff set, none are sent.
3. **Through the dispatcher, as a mandatory type.** `reservation_payment_due` has no member
   preference (#2981): it is a notice of a debt, and the email carries nothing promotional. The
   email is the generic `notification` template and links to the reservation's pay page. Staff are
   not copied.
4. **Every attempt is an audit row** (`reservation.payment_reminder`, actor System, subject the
   member), with outcome `sent`, `skipped` (the account was removed) or `failed`. `dispatch` now returns what became of the
   email so the caller can record it. A failed outbox insert throws after the row is written, so
   the drain leaves the stage owed and the next pass tries again.

## Alternatives rejected

- **A member preference for the reminder.** Built in #2967 and removed in #2981: a member who
  turned it off would again learn of the fee only when a booking was refused.
- **A dedicated Postmark template.** The generic template carries subject, details and a button;
  a second template would be a second layout to keep in step.
- **One reminder with a "reminded already" counter.** The registry keys sent-marks per stage, so
  the stages stay declarative.

## Consequences

- An outbox outage writes one `failed` row per pass until it recovers, and may repeat the in-app
  notification.
- `registry.payment-due.spec.ts` pins stages, idempotency, stop-after-paid, the cutoff and the
  audit rows against real SQLite.
