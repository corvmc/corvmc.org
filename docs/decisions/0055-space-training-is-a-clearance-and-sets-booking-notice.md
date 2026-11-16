# 0055 Space training is a clearance and sets booking notice

- **Date:** 2026-11-11
- **Status:** Accepted
- **Issue:** [#2565](https://github.com/corvmc/corvmc.org/issues/2565)

## Context

A member's first booking comes with a tour of the space. With the room's 1-hour minimum notice
there was no time to find a volunteer to run it, so the owner ran it. Between January and
November 2026, 33 of 46 first bookings were made less than 3 days ahead. The orientation shift
(`volunteer.orientationRoleId`) existed but was switched off. This applies
[Certifications are an append-only catalog](0047-certifications-are-an-append-only-catalog.md)
(2026-08-08) to the member's own training.

## Decision

1. **Training on the space is a clearance.** "Practice space" is a `volunteer_certification` row
   with the fixed id `practice-space` (`PRACTICE_SPACE_CLEARANCE_ID`) and no expiry. Code finds it
   by id, so staff can rename it.
2. **The clearance sets the notice.** A member's own booking needs
   `reservation.newMemberMinAdvanceMinutes` (default 3 days) while they hold no current grant,
   and the room's minimum once they do. Booking history does not decide it.
3. **Completing or waiving an orientation grants it.** One append-only `member_certification`
   row, not repeated while one is current. A waiver's reason becomes the grant's note.
4. **A cancelled first booking counts for nothing.** Only a completed or waived orientation
   grants the clearance.
5. **Staff bypass both minimums** when booking for a member. There is no exception for an
   earlier slot when a volunteer happens to be free.
6. **Existing members were backfilled.** Every member with a completed booking of their own, and
   every completed or waived orientation, got the clearance from the migration.

## Alternatives rejected

- **Count prior bookings.** `isFirstReservationSql` already says who is booking for the first
  time, but a member shown around before the app tracked it would wait 3 days anyway, and a
  cancelled first booking would make the next one look like a repeat visit.
- **A flag on `member_orientation`.** It would duplicate a fact the clearances view, the grant
  history and revocation already handle for every other clearance.
- **Look the entry up by name.** A rename would switch the rule off without warning.

## Consequences

- The orientation shift has to be on for the 3 days to be used. Staff set the role under
  Settings → Orientation; the local seed sets it.
- Revoking a member's Practice space clearance puts them back on the 3-day notice.
- Only `'user'` bookings are checked. Band, teaching and event bookings keep the room minimum,
  because none of them raise an orientation shift.
