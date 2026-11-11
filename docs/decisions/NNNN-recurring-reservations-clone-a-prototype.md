# NNNN Recurring reservations clone a prototype

- **Date:** 2026-05-15
- **Status:** Accepted

## Context

Sustaining members with a regular rehearsal rebooked by hand each week, competing with one-off
bookings for the same slot. A recurring booking had to hold the slot automatically, and each
session still had to be an ordinary reservation that could be paid, cancelled or resolved on
its own.

## Decision

1. A `recurring_series` row holds an RRULE and points at a **prototype**: the first real
   reservation of the series. Generation clones the prototype's booker, owner, duration and
   notes onto each new occurrence. The series table holds only scheduling.
2. `prototypeType` names what the series clones, so other bookable things can recur through
   the same table.
3. A daily job generates occurrences 17.5 days ahead; one-off bookings reach only 14 days. A
   recurring slot is therefore booked before any one-off booking can reach its day.
4. A monthly series repeats on the nth weekday of the month, not a fixed date.
5. An occurrence that already exists for a day, cancelled ones included, is never generated
   again.
6. A series has no status column. It is active while `cancelledAt` and `supersededBy` are both
   null.
7. When the member's subscription ends, their series are cancelled.

## Alternatives rejected

- **Store booking fields on the series.** Every booker type's fields would have to be copied
  onto the series table, and kept in step with `reservation`.
- **Monthly on a fixed date.** The 15th falls on a different weekday each month, which is
  rarely what a band means.
- **Skip cancelled occurrences in the existence check.** Re-running the job would recreate an
  occurrence the member had cancelled.

## Consequences

- Cancelling one occurrence leaves the series running; cancelling the series leaves generated
  occurrences in place.
- The priority holds only while the recurring window stays longer than the one-off window.
