# 0072 A schedule change replaces the series

- **Date:** 2026-11-13
- **Status:** Accepted

## Context

A recurring room booking could only be cancelled and booked again, which lost its history and
let a one-off booking take the slot in between. `recurring_series.supersededBy` existed for this
since decision 0014 and nothing wrote it. Issue #2546 holds the proposal.

## Decision

1. Editing a series' day, time, length, frequency or end date writes a new series. Its prototype
   is the first session of the new schedule. The old series gets `cancelledAt` and
   `supersededBy`, so the chain is the history of one recurrence.
2. Old bookings before the day the new schedule starts stand.
3. From that day, an old booking that no money or record touches is removed, as when a series is
   cancelled. One that is paid, has a door code or is referenced is kept and listed to the editor,
   for the booker to keep or cancel. No refund runs in bulk.
4. A first session that is booked by someone else is waitlisted, as generation would waitlist it.
   One on a closure or show is refused, because generation would skip it and there would be no
   prototype.
5. The new series generates its window at once instead of waiting for the daily run.
6. Members edit their own series; staff edit any, with no booking window. A staff edit notifies
   the booker.

## Alternatives rejected

- **Leave every generated booking in place**, as the issue first proposed. The member would hold
  both schedules for the 17.5-day window and have to cancel the old sessions one by one.
- **Cancel every old booking, paid ones included.** A schedule change would refund sessions the
  member may still want.
- **Edit the series row in place.** The bookings already generated would no longer match their
  rule, and the history would be gone.

## Consequences

- A series page follows `supersededBy` to show the edit history.
- Recurrence stays two mechanisms: this applies to `recurring_series`, not to
  `maintenance_schedule`.
