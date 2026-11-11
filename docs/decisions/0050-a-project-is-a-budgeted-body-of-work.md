# 0050 A project is a budgeted body of work that events point at

- **Date:** 2026-09-02
- **Status:** Accepted
- **Issue:** [#822](https://github.com/corvmc/corvmc.org/issues/822)

## Context

Work that spanned more than one work order had no container. A facility improvement has a budget,
an owner and a dozen work orders, and nothing tied them together. A festival is one budget over
several nights. Suggestions reached `done` because a staffer said so, with no link to the work.
The comparable products are in
[project-management-prior-art.md](../reports/project-management-prior-art.md).

## Decision

1. **`project` is a root entity.** Work orders, purchase orders, acquisitions and event listings
   carry a nullable `project_id`. Nothing points from a project to them, so one shape holds a
   facility job (no events), a show (one) and a festival (many).
2. **Three layers stay apart:** the project, the listing, and the show's back-of-house
   (`production`, a 1:1 side table that would be mostly NULL on the listing).
3. **`project.status` reuses the suggestion statuses**, and `project.suggestion_id` links the work
   back to the idea it answers.
4. **Burn is derived on read** from the rows that hold the spending. Nothing is stored beside the
   budget.
5. **Volunteer time has two valuations that are never added:** impact value over every approved
   hour at `volunteer.hourValueCents`, and recognizable contributed services over hours under a
   specialized-skill role at that role's market rate. A specialized role with no rate counts as
   zero and is reported as a gap.
6. **A deal is four values per act**, `{ guaranteeCents, percentageBps, versus, againstNet }`,
   which covers a donated set, a flat fee, a split, a guarantee and a versus deal.
7. **Recurring facility work is generated on close.** Resolving or calling off an occurrence
   writes the next one, due an interval after the close.
8. **CMMS vocabulary.** `volunteer_shift` became `work_order` and `asset_flag` became
   `work_request`. Child columns such as `volunteer_signup.shift_id`, and the
   `volunteer_shift_*` notification kinds, kept their names to avoid table rebuilds.

## Alternatives rejected

- **A project as a kind of event.** A facility job has no event, and a festival has many.
- **A stored burn total.** Something would have to keep it right.
- **One combined value for volunteer time.** The two valuations overlap by construction, so the
  sum double-counts.
- **Deal columns on `event_band`.** The public gig guide joins that table, and about nine rows in
  ten are not CMC shows. The columns went on `production_slot` (amended 2026-09-07).
- **Materializing recurring work ahead**, as `recurring_series` does. A window materializer can
  pile up unclosed duplicates; generate-on-close cannot.

## Consequences

- `getProjectBurn` in `project-service.ts` is the one read of what a project spent and was given.
- A reader of the burn DTO gets no combined total to misuse.
- "Shift" stays the member-facing word for a scheduled work order.
