# 0079 A festival is a parent project

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2543](https://github.com/corvmc/corvmc.org/issues/2543)

## Context

Every show is its own production and its own project (`production.project_id` is unique,
[0011](0011-productions-are-projects.md)). A festival or a multi-night run is several shows under
one budget, and two show projects had nothing that added them up.

## Decision

1. **`project.parent_project_id`**, nullable, set null when the parent is deleted. Any project
   can be a child or a parent; a show under a general festival project is the case it is for.
2. **One level deep.** `updateProject` and `createProject` refuse a project as its own parent, a
   parent that has a parent, and a project with children as a child (`ProjectParentError`).
   A CHECK cannot read another row, and a self-reference CHECK would rebuild `project` and its
   children on D1, so the service holds all three.
3. **The parent's burn is a sum.** `getProjectBurn` adds each child's own burn (cash, the `show`
   block, contributed value, funding) to the parent's, and sets it against the parent's budget.
   `parts` lists the cash spend of the parent and each child. A child's burn stays its own.
4. **Each night stays its own production**: run of show, door take and settlement are per night.
5. **Staff set it from Edit project** with `project.manage`. The parent's page lists its children
   and the budget page shows spend by project. The create modal is unchanged.

## Alternatives rejected

- **A festival as a production with several listings.** A production is one night's
  back-of-house; its settlement and door take are per night.
- **Deeper nesting.** No case needs it, and a one-level sum needs no recursive query.

## Consequences

- The Projects list and committee reports show a festival's summed spend. A committee report
  that lists both a festival and its shows shows each show's spend twice; it has no total row.
- `project-parent.spec.ts` pins the sum, the depth rules and detaching against real SQLite;
  `projects.remote.parent.spec.ts` pins the guard.
