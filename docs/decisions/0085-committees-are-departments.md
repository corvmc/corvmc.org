# 0085 Committees are departments, and a duty grants the duty

- **Date:** 2026-11-14
- **Status:** Accepted
- **Issue:** [#2983](https://github.com/corvmc/corvmc.org/issues/2983) and its sub-issues, the
  last [#2994](https://github.com/corvmc/corvmc.org/issues/2994); the chair in
  [#3009](https://github.com/corvmc/corvmc.org/issues/3009)

## Context

Who may do a piece of work and who is expected to were stored apart and read apart. Permission was
capabilities from seven routes; responsibility was an assignee, an owning committee
(`work_order.group_id`), a volunteer role and notification recipients, none of which read the
permission side. [0053](0053-committees-own-deliverables-not-permissions.md) §5 made that a rule:
ownership grants nothing. The result was ten cases where the two disagreed, listed on #2983. A
committee seat was listed its committee's tasks and could not complete them. An assignee could not
close a task with a done condition. `allowStaff` admitted any position holder with no named
capability.

This record amends 0053 §5 for the task itself, and
[0049](0049-a-committee-is-a-group-chaired-by-admins.md) §4 (the free-text seat title and admin
chairs).

## Decision

1. **A committee is a department.** It stays a group of kind `committee`. It owns its tasks,
   recurring work, projects and events, and holds its capability grants (`group_capability`).
2. **A position is a row.** `group_position` names a standing role in one committee and
   `group_position_holder` says who holds it through their roster row. One position per committee
   is the chair (`is_chair`); holding it is what makes someone chair (#3009).
3. **Operations is the staff department.** Each job in the matrix is a position in the
   `operations` committee, and an Operations seat grants that job's capabilities. `admin` stays a
   `model_has_roles` row. The `staff` position is not retired yet.
4. **A duty grants the duty and nothing wider.** `canActOnTask` admits the assignee, the holder of
   the position the task is tagged for, any active seat on the owning committee, or a holder of
   `volunteer.manageShifts` scoped to the row. It returns the reason. Take, tick, complete and hand
   back ask it; editing the linked record, assigning others and money out still need a grant.
   Ownership still adds no reach on the show.
5. **One list.** `waitingOn` is "Your tasks" on both dashboards: assigned to you, else tagged for a
   position you hold, else in your committee while its position is vacant. It is a subset of what
   `canActOnTask` admits.
6. **Every guard passes scope and names a capability.** A task, project or event guard reads the
   row's committee and project, so an `'owned'` grant works on every page.
7. **Event-scoped jobs are shift roles.** A role's grants may open `grant_lead_days` before the
   event (the vendor host and `market.host`).
8. **The reason is shown from the rule.** A person's page lists positions, committee seats with
   the positions held there, and live shift roles, with what each gives (`explainAccess`). A
   task's page lists who it waits on and why the viewer can or cannot act (`waitsOnTask`,
   `explainTaskAct`). Each is built from the function its guard asks, and a spec checks the
   explanation against the guard for every user, capability, scope and task in its fixture.

## Alternatives rejected

- **Responsibility stored as permission**, by granting `volunteer.manageShifts` to every committee.
  It gives reach over every task the committee touches, not the ones it owns.
- **A separate department table.** Committees already carry rosters, grants, chairs and projects;
  a second table would duplicate all of it (owner, 2026-11-14).
- **A written-out explanation beside the guards.** It drifts from what the guards admit; the
  explanation reads the guards' own functions instead.

## Consequences

- A new way of holding a capability needs a line in `explainAccess` and in its spec, or the spec
  fails.
- A person's page shows `'owned'` grants as "on its own records"; a project's committees and a
  show's event lead are not listed, because they hold only with a project in hand.
- Separation-of-duties pairs beyond the two-person till count, and renaming "committee" in the
  interface, remain open.
