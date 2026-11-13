# 0078 A show names one event lead

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2726](https://github.com/corvmc/corvmc.org/issues/2726)

## Context

A show named committees and crew but no single person as its event lead. `production` already
carried `producer_user_id`, set only by a "take it myself" button that granted nothing.

## Decision

1. **The lead is `production.producer_user_id`.** No new column and no migration. The interface
   calls it the event lead.
2. **Booking names the lead.** `setShowLead` is guarded by `production.book` on the show's
   project, and takes any live member, found by name through `searchShowLeadCandidates` on the
   same guard. Clearing the picker and saving removes the lead.
3. **The lead holds `production.run` on that show.** `leadsProject` in `capability-grants.ts` is
   checked in `grantedBeyondPositions` and in `requireProjectCommittee`, so every production guard
   and `can()` agree. It never grants `production.book`.
4. **The console is the lead's page.** A member who leads a show that is not closed or cancelled
   may open the staff panel; its rows still follow their capabilities.
5. **The lead is shown** beside the date on the console, on the staff event page, and on the
   lead's member dashboard until 12 hours after the show starts.
6. **The lead hears when somebody else names them** (`show_lead_assigned`), not when they name
   themselves.

## Alternatives rejected

- **A lead role on `project_committee`.** It names committees; a lead is a person.
- **A host shift as the lead.** The host works the night through the volunteer pipeline; the lead
  is appointed by booking before any shift exists.

## Consequences

- `show-lead.spec.ts` pins the grant, the panel gate, the notice and the dashboard window against
  real SQLite; `productions.remote.spec.ts` pins the guard.
- Routing show-day reminders to the lead is not built here.
