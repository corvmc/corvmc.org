# NNNN Sponsors and grants are two modules

- **Date:** 2026-09-23
- **Status:** Accepted
- **Issue:** [#1479](https://github.com/corvmc/corvmc.org/issues/1479)

## Context

The Development committee tracks business sponsorships (#574) and grant applications with their
reporting deadlines (#595). Nothing in the app recorded either. A first design put both in one
`agreement` ledger (#1458, built as #1457). The owner reversed that in #1479, and #1457 closed
unmerged.

## Decision

Sponsors and grants are separate modules, each with its own tables, service, pages and
capability.

1. **Sponsors:** a `sponsor` row per business and a `sponsorship` row per term, because the
   same business renews season after season. The deadline is an active term's end.
2. **Grants:** a `funder`, its `grant_application`s (requested and awarded amounts), and each
   award's `grant_report`s. The deadline depends on status: apply-by, then the earliest
   unsubmitted report or the award's end.
3. The only shared code is `src/lib/utils/deadline.ts`. Dates are ISO day strings, since a
   deadline is a day in Corvallis with no time.
4. Status moves by hand through each edit form. No transition has a side effect.
5. No amount here is accounting. An award arrives outside the app.

## Alternatives rejected

- **One `agreement` ledger for both.** A sponsor is a relationship that renews; a grant is an
  application that owes reports after the award. One table would have to model both.

## Consequences

- Each module's deadline rule is a pure function its own spec covers.
- Staff hold `manage` on both; the treasurer holds `read` on both.
