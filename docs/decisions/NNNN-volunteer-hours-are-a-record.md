# NNNN Volunteer hours are a record, not a currency

- **Date:** 2026-08-08
- **Status:** Accepted
- **Issue:** [#235](https://github.com/corvmc/corvmc.org/issues/235), [#171](https://github.com/corvmc/corvmc.org/issues/171)

## Context

Nothing in the app recorded volunteer labour. The board and grant applications ask for hours by
member, role and month over a date range. Volunteering arrived on the contact form and was handled
by email. The `role` name was already taken by the auth roles, and a seeded `volunteer` auth role
was read by no code.

## Decision

1. **Hours are a record.** Approving a log writes no `credit_transaction`. A spec asserts it.
2. **A report counts approved logs only.** Approval is what makes a figure defensible to a funder.
3. **Hours are stored as integer minutes**, and `worked_on` is a calendar date anchored at noon
   club time, so a UTC month bucket always matches the local date.
4. **A volunteer role is a job description in its own table.** It grants nothing. Staff add roles
   without a migration, and shifts and logs reference them.
5. **A role with logs is archived, never deleted.** The foreign key restricts, and archiving hides
   the role only from the member's log form.
6. **A member withdraws a log by deleting it.** Nothing references a log, so a `withdrawn` status
   would be a value no report selects.
7. **The minor block is enforced in the service**, in `claimShift`, `submitHours` and
   `updateHourLog`. A route redirect does not stop a direct call to a remote function.
8. **`volunteer_profile.is_adult` is separate from `status`.** Approving a minor moves `status`
   and keeps the fact that they are a minor.
9. **The `volunteer` auth role is not revived.** Who volunteers is a query over approved logs.
   Clearance to work unsupervised is a certification.

## Alternatives rejected

- **Hours that earn practice-room credits.** A plausible later feature, and a non-goal. The test
  exists so the choice is not reversed by accident.
- **Roles as an enum or a config string.** It cannot carry the markdown job descriptions, and
  adding a role would need a deploy.
- **Midnight as the `worked_on` anchor.** In a UTC-ahead zone midnight local is the previous UTC
  day, and every log on the 1st would bucket into the prior month.
- **Gating logging on an auth role.** It shrinks who can contribute, and staff would have to grant
  the role before anyone filed a first log.

## Consequences

- A figure on any report is approved minutes, whatever the screen.
- Retiring a role keeps every past report resolving its name.
- Any new path that lets a member file time must call `requireActiveVolunteer`.
