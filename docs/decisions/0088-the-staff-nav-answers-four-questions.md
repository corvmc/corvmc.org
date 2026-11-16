# 0088 The staff nav answers four questions

- **Date:** 2026-11-16
- **Status:** Accepted
- **Issue:** [#3112](https://github.com/corvmc/corvmc.org/issues/3112); supersedes
  [0081](0081-the-staff-panel-is-four-systems.md) and the four systems of
  [#2763](https://github.com/corvmc/corvmc.org/issues/2763); amends the single Events list of
  [#2766](https://github.com/corvmc/corvmc.org/issues/2766)

## Context

[0081](0081-the-staff-panel-is-four-systems.md) grouped the staff sidebar into Relationships,
Community, Programs and Operations. Operations held Tasks, Committees, Volunteering, Equipment,
Supplies and Money, which share no question a staffer would ask before opening one of them.
Community held governance rows (Suggestions, Ballots) beside members and their posts. Moderation
held incident reports, which are building and safety records rather than member posts.

## Decision

1. **Each section answers one question.**
   - **Outreach:** outward, to the public and outside parties. Inbox, Contacts, Funding,
     Marketing, and Content with Local resources beneath it.
   - **Community:** members and what they post. Members, Bands, Calendar, Moderation,
     Classifieds.
   - **Programs:** what CMC offers. Practice space, Equipment, Clubs, Music, Productions.
   - **Governance:** how CMC runs itself. Tasks, Shifts, Committees, Incidents, Suggestions,
     Ballots.

   Dashboard sits above the four; Reports and System below. A new module joins the section whose
   question it answers.

2. **Renames.** The section takes the name Outreach, so the marketing row is **Marketing**.
   Volunteering is **Shifts**: the page is shift control, not a list of volunteers. Money is
   **Transactions**, a System row: it is a payment log opened to troubleshoot a payment, and most
   of that is reached from a member's page.
3. **Moves inside rows.** Incidents leave Moderation for their own Governance row. Supplies is a
   tab of Equipment. Local resources is a sub-row of Content. The calendar poster leaves Marketing
   and is a **Print poster** action in the Calendar header.
4. **Row keys do not change.** Starred rows store them: Marketing is `outreach`, Shifts is
   `volunteer-schedule`, Transactions is `payments`, Equipment is `gear`.
5. **Old URLs redirect** with a 308: `/staff/money/**` to `/staff/system/transactions/**`,
   `/staff/moderation/incidents` to `/staff/incidents`, `/staff/marketing/posters` to
   `/staff/events/poster`. `/staff/incidents` once 308'd to Moderation, so the redirect into it
   carries `via` past a browser's cached copy.
6. **Productions and Calendar are two lists.** This amends #2766, which made Productions a view
   on one Events list. Calendar (`/staff/events`) lists every `event_listing` staff may see,
   unpublished ones included; it is mostly member-submitted events, so it sits in Community.
   Productions (`/staff/productions`) lists every `production` with its status from draft to
   closed, listed or not; productions are the events CMC runs, so it sits in Programs. Each
   production row opens its listing, and a listing with a production links to it.
   [0003](0003-a-production-is-a-child-of-its-listing.md) already keeps their fields apart. The
   record pages under `/staff/events/[id]` are unchanged. `/staff/events?view=productions`
   308s to Productions.
7. **Interface moves only.** No table merges, and no capability changes.

## Alternatives rejected

- **Split Equipment.** Items and supplies share the stock ledger, intake and orders.
- **Keep Inbox above the sections.** Inbox is outward correspondence, and its badge shows when a
  staffer opens it, which opens its section.

## Consequences

- `nav-items.spec.ts` pins the four sections, places every row in exactly one of the top, a
  section or the bottom, and gates every row but the Dashboard.
- A nav parent whose capability passes but whose children all fail renders as a plain row, so a
  holder of `help.read` alone keeps Content.
- The System row shows for `finance.read` and `credit.read`, which open Transactions.
- `help-nav-paths.spec.ts` checks help articles against the new row labels.
- Productions loses the old view's listing-status, venue and date filters and its lineup column: a
  production may have no listing to carry them. The console still shows the bill.
