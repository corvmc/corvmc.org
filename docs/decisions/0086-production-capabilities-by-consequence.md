# 0086 Production capabilities are cut by consequence

- **Date:** 2026-11-15
- **Status:** Accepted
- **Issue:** [#2959](https://github.com/corvmc/corvmc.org/issues/2959), owner decision of
  2026-11-15; reverses the answer to [#1708](https://github.com/corvmc/corvmc.org/issues/1708)

## Context

[0011](0011-productions-are-projects.md) split a show into two capabilities by committee:
`production.book` for Booking's half and `production.run` for Production's. Both had `'owned'`
reach over the shows a committee was named on in `project_committee`. Deliverables
([0053](0053-committees-own-deliverables-not-permissions.md)) then said whose job each piece of
show work is, per item. The capability split no longer had to say it, and a committee owning the
poster or the description held no power to set either.

## Decision

1. **`production.run` is the show's own work**, with `'owned'` reach: times and notes, run of
   show, the advance, the door take, expenses, poster art, and the listing's description and
   times. Every committee on the show that carries the grant may do it.
2. **`production.book` is what binds CMC to someone outside it**, and is org-wide: the deal terms,
   the bill (`setStaffEventLineup`), moving to `draft`, `offered`, `confirmed` or `cancelled`,
   cancelling a series, and naming the event lead.
3. **Owning a deliverable puts a committee on the show.** A committee owning a live task in a
   project is on it for its grants' reach, as one named in `project_committee` is. This amends
   0053 §5 and the "ownership still adds no reach" line of
   [0085](0085-committees-are-departments.md) §4. No `project_committee` row is written; the
   reach is derived, so it ends when the task is cancelled or moved.
4. **Payouts stay `finance.refund`**, and `production.create` stays org-wide.
5. **A data migration preserves every holder.** Each committee holding `production.book` gains
   `production.run`. In production that is Booking, which is named on every show, so its reach
   does not change.
6. **`explainAccess` lists each committee's projects** and whether it is named on them or owns a
   task there, read from the rows the guard reads.

## Alternatives rejected

- **Show work for every committee on the show without a grant.** It would bypass the grant
  allowlist; the committee page already grants `production.run`.
- **Writing a `project_committee` row when a deliverable is assigned.** It drifts when the task is
  cancelled or reassigned; deriving it does not.

## Consequences

- A deliverable-owning committee's other `'owned'` grants, such as `volunteer.manageShifts`, now
  reach the whole show as well as its own items.
- Art and Merchandise and Communications reach the poster and the description only once their
  committee is granted `production.run`; the migration does not grant it to them.
- Event-keyed remotes that a show's committee still cannot reach are tracked on
  [#2262](https://github.com/corvmc/corvmc.org/issues/2262).
