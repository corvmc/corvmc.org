# 0067 A grant application or sponsorship is a project

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2622](https://github.com/corvmc/corvmc.org/issues/2622)
- **Supersedes:** [0019](0019-sponsors-and-grants-are-two-modules.md) decisions 2 (`grant_report`)
  and 4 (no side effects), and its separate list pages.

## Context

Pursuing a grant is a run of tasks with owners and dates: read the guidelines, draft, collect
letters, submit, then report. 0019 recorded the money and the dates, and reports as their own
`grant_report` rows with their own deadline code. Nobody at CMC has run a grant before, so the
steps themselves had nowhere to live. Projects already had tasks, assignees, committee owners,
templates and reminders (0050, 0053).

## Decision

1. **A grant application or a sponsorship is a project** of kind `grant` or `sponsorship`. The
   side table (`grant_application`, `sponsorship`) holds the organization, status, amounts and
   dates, one to one through `project_id`, as `production` does for a show. The project holds the
   work. Creating the row creates the project in the same batch.
2. **The owner is the committee holding the module's manage capability** (`grant.manage`,
   `sponsor.manage`), `development-committee` first. With none, the project has no committee.
3. **Grant reports are tasks** on the grant's project. `grant_report` and its deadline kind are
   dropped. The grant's own deadlines are its apply-by date and award end.
4. **Three stage templates**, `Grant application`, `Grant award` and `Grant close-out`, found by
   `duty_list.grant_stage`. They are timed from the grant's dates through the `apply_by`,
   `award_start` and `award_end` anchors, and each task carries help text in its notes. The
   application template is stamped on create. The other two are offered on the grant page and
   applied only when somebody chooses to.
5. **Tasks on these projects get a 14-day reminder**, besides the 3-day and overdue stages every
   committee task has, and a task added by hand carries the owning committee.
6. **Money names what it pays for.** `funds_project_id` on both tables points at an ordinary
   project. `getProjectBurn` lists awarded or closed grants and active or ended sponsorships
   beside the spend, never subtracted from it.
7. **One Funding page** lists both by stage, ordered by the sooner of each row's next open task
   and its deadline. It replaces the Grants and Sponsors lists, which redirect to it.

## Alternatives rejected

- **A `project_id` on each task-like table instead of a project per grant.** A grant would have no
  owner, budget link or template, which are what a first-time grant writer needs.
- **Applying each stage template on a status change.** A status set by mistake would stamp tasks
  nobody asked for; an offer costs one click.
- **A NOT NULL `project_id`.** Adding one to a populated table is a rebuild on D1. Nullable, with a
  partial unique index, matches `production.project_id`, and the services always write it.

## Consequences

- A grant's next step is its project's earliest open task, which the Funding page and the grant
  page show.
- The templates come from a migration, so the dev seed and the e2e fixture replay it after their
  wipes (`scripts/db/grant-stage-templates.ts`).
- Deleting a grant or sponsorship deletes its project and tasks.
