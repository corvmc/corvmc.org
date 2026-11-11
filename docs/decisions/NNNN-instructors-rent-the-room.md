# NNNN Instructors rent the room

- **Date:** 2026-08-31
- **Status:** Accepted

## Context

People who teach in the practice room had no tools. `directory_entry.teachesLessons` was a
self-declared badge, and `bookerType: 'lesson'` had never been written. A teacher needed to hold
a standing slot at a fair rate and be findable by someone outside CMC.

## Decision

CMC's relationship is with the teacher, not the student. CMC rents the room to an instructor,
who bills their own students.

1. An `instructor` row hangs off `user` (`userId` NOT NULL, unique), not `directory_entry`. It
   is an authorization record, and a directory entry can belong to a group or to nobody.
2. Status is staff-granted. A member may apply; the application is the draft listing, and a
   declined one returns as `rejected` with `reviewNotes` to fix and resubmit. Every consumer
   matches `status = 'active'` positively.
3. A teaching booking is `bookerType: 'instructor'` with `bookerId` = the instructor row.
   `'lesson'` was deleted, not renamed: no row used it.
4. Booking terms resolve by booker type through `termsFor()`. Teaching costs $5/hr, the rate a
   sustaining contribution already buys, with the monthly cap lifted. Credits apply.
5. The teaching horizon (90 days recurring) is longer than any member's, so a teaching series
   is generated before a member can book into its week.
6. `teachesLessons` stays as the member's own claim. The listing is a separate public route.
7. Pausing or retiring an instructor leaves future bookings in place.

## Alternatives rejected

- **Enrolment, lesson records or payouts.** Students are not a party to anything CMC records,
  and taking their fees would need Stripe Connect.
- **A cheaper teaching rate.** A third of the drop-in rate would be the cheapest rehearsal in
  the building. The member rate is defensible to members.
- **Replace or derive `teachesLessons`.** Either turns a member's description of their own life
  into a staff decision.
- **A separate `teaching.` config prefix.** A second config read on a hot path, and two places
  to look for the rate.
- **A filter on the member directory.** Different reader, different card, different truth.
- **An appeal for a declined application.** Appeals contest behaviour calls; an application is
  a proposal, returned with a reason.

## Consequences

- Staff can run the module curated, granting instructors directly, before opening applications.
- If teaching is overused, cap teaching hours; do not cut the rate.
- The public listing has three gates (active status, directory visibility, public contact view),
  each a place a mistake publishes someone.
