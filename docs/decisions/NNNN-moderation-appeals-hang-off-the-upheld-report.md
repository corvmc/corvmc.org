# NNNN Moderation appeals hang off the upheld report

- **Date:** 2026-08-18
- **Status:** Accepted
- **Issue:** [#578](https://github.com/corvmc/corvmc.org/issues/578)

## Context

A member whose post staff took down, or whose standing staff restricted, had no way to contest
it except a message thread. Restoring standing after such a conversation was a button on
`/staff/members/[id]` someone had to remember. `setStanding` also accepted a call with no report
behind it, so a staffer acting alone left no reason to show or contest.

## Decision

**Every moderation action is an upheld report, and an appeal attaches to that report.** Built in
#1382, #1580 and #1581.

1. `setStanding` requires a `flagId`. A staffer acting on their own files a `staff_action`
   report (`content_flag.origin`), already resolved.
2. `moderation_appeal` has a unique index on `flagId`: one appeal per decision. Staff may reopen
   a decided appeal; a member cannot ask to.
3. An appeal decides the content and the standing separately (`contentOutcome`,
   `standingOutcome`). The verdict label is derived from them, and pending is
   `decidedAt IS NULL`.
4. The staffer who resolved the report may grant the appeal but not deny it (`SelfReviewError`,
   enforced in the service).
5. Nothing changes while an appeal is pending.
6. Granting applies the restores first and stamps the appeal last. A restored listing is
   published directly, not through the standing-aware submit.

## Alternatives rejected

- **An appeal as an inbox thread.** A thread has no outcome, cannot be queried for unanswered
  appeals, and cannot trigger the restore.
- **A polymorphic target (`actionType`, `actionId`).** Once every action has a report, the
  report is a complete anchor.
- **Lifting the consequence while the appeal waits.** Anyone restricted could lift it by filing,
  for as long as the queue is slow.
- **A soft warning the resolving staffer clicks through, or an escalation after N days.** The
  first leaves the rule to habit. With this few staff, the second notifies the staffer already
  blocked.
- **A cap on open appeals.** Each upheld report admits one appeal, so volume is already bounded.
- **A dedicated `/staff/appeals` page.** The appeal renders on `/staff/flags/[id]`, under the
  report it contests.

## Consequences

- A denial that needs a second staffer waits for one. A grant never waits.
- Appealing a dismissed report, account deactivation or an eligibility rule is out of scope.
- The member's email and notice state the verdict only; the staff reason stays internal (#1430).
