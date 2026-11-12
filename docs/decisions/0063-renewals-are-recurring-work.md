# 0063 Renewals are recurring work

- **Date:** 2026-11-12
- **Status:** Accepted
- **Issue:** [#2611](https://github.com/corvmc/corvmc.org/issues/2611), superseding
  [#1597](https://github.com/corvmc/corvmc.org/issues/1597)

## Context

#1597 made CMC's permits, licenses and insurance policies a module of their own: a `renewal`
table, `/staff/renewals`, the `renewal.read` / `renewal.manage` capabilities, a private
certificate attachment and reminders sixty and fourteen days before expiry. Production held no
renewal rows when this was decided. The owner's decision on #2611: "I think renewals just become
recurring tasks, let's eliminate those".

## Decision

1. **A renewal is a `maintenance_schedule`** named "Renew <name>", on the Schedule's Recurring
   view. The interval is the term in days, 365 for a yearly policy. The issuer and the reference
   number go in its notes.
2. **The open work order is due about thirty days before the expiry date**, and the person who
   renews it is its assignee. Resolving it writes the next one, due one interval after the close.
3. **The Renewals module is removed:** the `renewal` table, its route, nav row, capabilities,
   `renewal_expiry` notification, reminders, certificate endpoint and seed. A cleanup migration
   deletes the `renewal.*` grants, `renewal_expiry` preferences, sent reminders and certificate
   attachments. The two production grants were on the Development Committee.
4. **Certificates are not kept in the app.** Recurring work holds no documents.

## Alternatives rejected

- **Keep the module.** It duplicates what recurring work already does: a due date, an assignee
  and a reminder on the Schedule.
- **A calendar-date mode on recurring work.** Generate-on-close dates the next occurrence from the
  close, not the certificate. Staff correct the open work order's due date by hand when they
  differ, which happens at most once a term.

## Consequences

- The Development Committee no longer sees renewals. Recurring work is read under
  `volunteer.read`; a committee keeps its own through `volunteer.manageRecurring` on schedules it
  owns.
- No reminder fires sixty days ahead. The open work order's due date is the only prompt.
