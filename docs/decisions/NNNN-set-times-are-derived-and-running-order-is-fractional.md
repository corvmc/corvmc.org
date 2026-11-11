# NNNN Set times are derived and running order is fractional

- **Date:** 2026-08-02
- **Status:** Accepted
- **Issue:** [#1133](https://github.com/corvmc/corvmc.org/issues/1133)

## Context

A production's run of show is the acts in playing order, each with a set length and a changeover.
Staff reorder acts and change lengths often in the weeks before a show. Two shapes needed deciding:
whether set times are stored or computed, and how running order is kept.

## Decision

1. **Set times are derived, with no override.** `computeSetTimes` in
   `src/lib/server/production/run-of-show.ts` walks the slots from `firstSetAt`, adding each set
   length and changeover. A production with no `firstSetAt` has no set times. There is no lock flag
   and no recalculate button.
2. **`sortOrder` is a `real` with no unique constraint.** Placing a slot between two neighbours
   takes the midpoint of their values, so an insert or a move is one write. A tie breaks on
   `createdAt`.
3. **Running order is not billing order.** `production_slot.sortOrder` is who plays when;
   `event_band.billingOrder` is who is on the poster and how large.
4. **Problems are warnings, not refusals:** running past curfew, a first set before doors, a set
   of zero or over 240 minutes, a soundcheck after the first set.

## Alternatives rejected

- **Storing set times and letting staff edit one.** The column would be sometimes derived and
  sometimes not, with no way to tell which, and editing any set length would leave the lineup
  disagreeing with itself. Day-of changes happen on a clipboard.
- **An integer `sortOrder` with `unique (productionId, sortOrder)`.** SQLite checks a unique index
  row by row during an `UPDATE` and cannot defer it, so swapping two slots trips the constraint
  mid-statement. `db.batch()` does not change constraint timing. A temporary offset works but costs
  extra round trips and a half-written state on every drag.

## Consequences

- The unique constraint on `sortOrder` looks correct and must not be added back.
- Repeated midpoints eventually run out of precision; the service renumbers when two neighbours get
  too close.
