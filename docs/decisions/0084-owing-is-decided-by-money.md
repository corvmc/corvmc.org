# 0084 Owing is decided by money

- **Date:** 2026-11-14
- **Status:** Accepted
- **Issue:** [#3003](https://github.com/corvmc/corvmc.org/issues/3003)

## Context

[Decision 0082](0082-a-reservation-shows-one-status-track.md) kept the owing rule at
`status = confirmed`, so a booking staff marked complete while it still owed read Covered. This
record replaces its point 5 and its rejected alternative "Payment due for a completed booking
that still owes". The owner: "The user has used the time and owes payment for it."

Production held 3 such rows from 2 members when this was decided, all ended in June and July
2026 and none priced.

## Decision

1. **A booking owes while its balance is unpaid, confirmed or completed.** `owesMoney` and
   `owesMoneySql` (renamed from `confirmedUnpaidSql`) read `status` in `payableStatuses`,
   `paidAt` and `refundedAt` null, `cashDueCents` null or above zero, and not an event hold.
2. **A completed booking reads Paid, Payment due or Covered.** Payment due once it has ended.
3. **A no-show does not owe.** It reads No-show and stays out of the fee gate and reminders.
4. **Every write that settles a balance accepts both statuses.** Checkout, the card reader,
   credits, cash received and comp gate on `payableStatusSql()`. The member pay remotes gate on
   `isAwaitingPayment`. `scripts/reservation-settle-statuses.spec.ts` fails a settling write
   gated on `confirmed` alone.

## Alternatives rejected

- **Reopening the booking to confirmed when it owes.** The stored status records what happened
  to the session; payment is read from the payment columns.
- **Counting no-shows as owing.** Not asked for; a no-show is staff's call.

## Consequences

- The fee gate, payment reminders, the staff Payment due filter and count, the member Payment due
  list and the pay link include completed bookings that owe.
- Staff can record cash or comp on a completed booking that owes.
- Auto-complete is unchanged: it only moves confirmed rows.
