# 0054 A work order is the task, and a contractor job is an engagement on it

- **Date:** 2026-10-13
- **Status:** Accepted
- **Issue:** [#1806](https://github.com/corvmc/corvmc.org/issues/1806)

## Context

Projects were run from spreadsheets, and the staff project page was a set of typed records, each
with its own create form, status machine and page. Staff wanted a checklist: type a line, tick it
off, fill in the rest later. A contractor job was a separate record with its own title, unit and
project, so a repair had two records for one piece of work. This narrows part of
[Contractor work has its own tables](0051-contractor-work-has-its-own-tables.md) (2026-09-02).

## Decision

1. **A work order is the task.** `work_task` stays the checklist inside one.
2. **Assignment is derived, not stored.** It reads contractor when a live engagement exists, open
   when `posted_at` is set, members when there are live signups, and unassigned otherwise. Only
   `posted_at` and `posted_by_user_id` are new, because posting is a decision made before anyone
   signs up.
3. **Assigning a member is a staff-made `volunteer_signup`**, landing confirmed. A gap in the
   member's clearance or profile is warned, recorded and allowed; a blocked profile is refused.
4. **`contractor_job` is one contractor's engagement on one work order**, shaped like a signup:
   who, its own status (`asked`, `declined`, `booked`, `completed`, `cancelled`, `no_show`), and
   money where a signup has hours. A work order can have several.
5. **The work order owns whether the work is done.** Completing an engagement resolves its work
   order. Ticking the task does not complete the engagement, because done and invoiced are
   different facts.
6. **`volunteer_role_id` is nullable**, with a check that posted work has a role. The claim board
   lists posted work only.
7. **Sections are a table**, `project_section`, with `sort_order` on the work order.
8. **Progress is done work orders over live ones**, where done is ticked or its `done_when`
   holding.

## Alternatives rejected

- **A stored assignment mode.** It could disagree with the signups and engagements it describes.
- **Renaming `contractor_job`.** A table with children rebuilds on rename, for no gain.
- **Keeping the job's own `summary`, `asset_id` and `project_id`.** They duplicated the work
  order. They moved there, and `completed_at` stayed, because the contractor finishing and staff
  ticking the task are different moments.
- **A section as a text column.** Sections are renamed, reordered and left empty.

## Consequences

- Queries that inner-joined `volunteer_role` became left joins, or filter to work with a role
  where only volunteer work belongs.
- Every creation path that predates posting posts what it creates; only the task list makes
  unposted work.
- `/staff/contractors/jobs/[id]` redirects to the engagement's card on its work order's page.
- Work-order changes are audited in the shared services both the shift page and the project page
  call (#1906).
