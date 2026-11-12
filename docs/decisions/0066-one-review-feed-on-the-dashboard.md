# 0066 One review feed on the dashboard

- **Date:** 2026-11-12
- **Status:** Accepted

## Context

Fourteen kinds of record wait on a staff decision: suggestions, suggestion edits, event listings,
classified posts, resource tips, content reports, appeals, reported problems, group and vendor
applications, volunteer hours, shift claims and minor sign-offs. Each had its own page. Some had a
nav badge, five had no count anywhere, and the dashboard showed a table of counts that disagreed
with the badges (#2623).

## Decision

1. **One feed on `/staff`**, oldest first, lists everything waiting on the viewer. There is no
   separate review page.
2. **A registry defines each kind** (`src/lib/server/review/review-registry.ts`): its capability,
   an optional surface, and one waiting predicate from which both `count` and `list` are built.
   The Dashboard nav badge, the filter chips and the rows come from that registry.
3. **A viewer sees only the kinds their capabilities let them decide.**
4. **Decisions stay on each kind's own page.** A row links there.
5. **A kind whose decision is approve or decline is decided from the row** as well. The row
   submits the remote form the kind's own page submits, so the guard and the service are the
   same. Where that form requires a reason, the row asks for it in a dialog.
6. **Kinds whose decision needs a written reply or more than two outcomes stay link-only**:
   content reports, appeals, vendor and group applications, suggestions to answer, reported
   problems.

## Alternatives rejected

- **A badge per queue in the nav.** Five kinds had none, and adding them would have filled the
  nav with counts staff had to add up.
- **A review page separate from the dashboard.** The dashboard is the page staff open first.
- **A new decision endpoint for the feed.** A second guard and a second call into each service
  could drift from the page's.
- **Inline decisions for every kind.** A report, an appeal or an application needs its context
  and a written reply.

## Consequences

- A new kind of review is a registry entry and a label. A spec checks that its `count` and `list`
  agree against a real database.
- A kind decided from the row adds an entry to `rowDecisions` in `#lib/types/review.js` and a
  binding in `src/routes/staff/review-decisions.ts`. The type requires the binding, and
  `review-decisions.spec.ts` checks that its form asks for the kind's capability first.
- Inbox threads, band applications, artifact requests and wishlist pledges stay out of the feed.

PRs: #2627, #2639, #2642.
