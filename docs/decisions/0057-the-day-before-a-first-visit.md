# 0057 The day before a first visit

- **Date:** 2026-11-11
- **Status:** Accepted
- **Issues:** [#2567](https://github.com/corvmc/corvmc.org/issues/2567),
  [#2569](https://github.com/corvmc/corvmc.org/issues/2569)

## Context

[0055](0055-space-training-is-a-clearance-and-sets-booking-notice.md) gave a member without the
Practice space clearance 3 days' notice so a volunteer can be found to show them around. Nothing
told staff when no volunteer had signed up, and the member got the same reservation reminder as
everyone else.

## Decision

1. **Two reminder definitions, no new job.** Both are entries in `reminders/registry.ts`,
   drained by the existing 15-minute `/api/cron/reminders` run and stamped once in
   `reminder_sent`.
2. **Unclaimed orientation is a staff digest.** A live orientation shift starting within 24 hours
   with no claimed, confirmed or completed sign-up goes to every `volunteer.manageShifts` holder,
   in-app and by email. The subject id carries the shift's start, so a moved shift alerts again.
3. **The clearance decides the first visit.** A member's own confirmed booking starting within 24
   hours while they hold no current Practice space clearance gets `first_visit`, not
   `reservation_reminder`. The reservation reminder also skips any booking already sent
   `first_visit`, so a clearance granted in between does not produce a second mail.
4. **Parking and house rules are staff text.** `volunteer.firstVisitNotes`, edited under
   Settings → Orientation, goes into the generic `notification` template as `body_plain`, which
   the email layer escapes. Empty leaves it out.

## Alternatives rejected

- **A scheduled job per shift or booking.** Reminders derive from rows that exist; a stored
  future send would need moving whenever the booking moves.
- **Parking and rules in code.** They are facts about the building that staff change without a
  deploy.
- **One alert per staffer per shift.** Two orientations on one day would be two mails; the
  digest makes it one.

## Consequences

- The first-visit email says nothing about parking or house rules until staff fill in the
  setting.
- A booking made less than 24 hours ahead by staff for an uncleared member gets the first-visit
  email on the next drain.
