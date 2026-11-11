# NNNN A committee owns show work; ownership grants no permission

- **Date:** 2026-09-29
- **Status:** Accepted
- **Issue:** [#1701](https://github.com/corvmc/corvmc.org/issues/1701), with the decisions in
  [#1706](https://github.com/corvmc/corvmc.org/issues/1706),
  [#1707](https://github.com/corvmc/corvmc.org/issues/1707),
  [#1708](https://github.com/corvmc/corvmc.org/issues/1708) and
  [#1709](https://github.com/corvmc/corvmc.org/issues/1709)

## Context

Two facts were stored as one. Permission says whether a person may do something; it changes rarely
and is restricted where the harm is real. Responsibility says whose job something is on one show,
who hears about it and who is chased when it is late. A work order named a volunteer role and never
a committee, so a show's poster, promotion and advance sat inside one role's checklist with no
owner. The facts that would say the work was done, such as a poster on the listing, were already
read by the publish and close-out gates.

## Decision

1. **Responsibility is an owning committee on a work order**: `work_order.group_id`, copied from
   the template item. Null means staff's work. A disbanded committee's items fall back to null.
2. **Done can be derived.** `work_order.done_when` names one of a closed set of facts about the
   show (`workDoneConditions`). An item is done when it is resolved by hand, or when its condition
   holds and its tasks are ticked. Nothing is stored when the fact comes true, so the item reopens
   if the fact goes away.
3. **Conditions are code, chosen by data.** A template picks the condition; a typed function in
   `done-conditions.ts` evaluates it, sharing its predicate with the gate that reads the same
   fact.
4. **Deliverables gate nothing.** The publish and close-out gates keep reading the facts.
5. **Ownership grants nothing and takes nothing away.** It writes no `project_committee` row, so
   the committee gains no reach on the show (#1708). What a committee may do to its own items is
   `volunteer.manageShifts` with `'owned'` reach.
6. **A deliverable keeps a volunteer role**, because it is still volunteer work that someone logs
   hours against (#1707).
7. **Reminders are derived** from the reminders registry, over open, committee-owned items with a
   due date.

## Alternatives rejected

- **Storing responsibility as permission**, through capability grants. Permission is coarse and
  rarely changes; responsibility is per item and changes often.
- **Predicates stored as data.** They cannot be typed or validated, and nobody reviews SQL kept in
  a table.
- **Ownership that adds reach.** Owning the poster would give Art and Merchandise the power to set
  posters on every show it touches.

## Consequences

- The coordinator's unscheduled-work queue leaves out committee-owned items, which are on their
  committee's Open items tab.
- A cancelled show cancels its committees' open items and notifies each committee that had one
  (#1709).
- Re-cutting `production.book` and `production.run` by what an action commits the collective to
  was left for later.
