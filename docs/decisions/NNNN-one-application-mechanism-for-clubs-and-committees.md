# NNNN One application mechanism for clubs and committees

- **Date:** 2026-09-29
- **Status:** Accepted
- **Issue:** [#1700](https://github.com/corvmc/corvmc.org/issues/1700); decisions #1727, #1728,
  #1729, #1730

## Context

There were two ways to apply to a group, and neither knew about the other. A `by_application` club
took a `group_member` row with status `requested`: no answers, and `unique(groupId, userId)` meant a
declined applicant could never apply again. Committees used `committee_application` and
`committee_application_choice` (#1151): two board questions, withdrawal, several committees per
submission, a decision with notes per committee, and acceptance by invitation. That path ignored
`joinPolicy`, so `/member/groups` listed committees as invite-only while another page took
applications to them.

## Decision

1. **One table pair, `group_application` and `group_application_choice`**, with the committee
   tables' shape. An application holds answers keyed by question id; a choice holds one group's
   status, notes and decider.
2. **`joinPolicy` decides.** A group takes applications only when it is `by_application`, read from
   the row. Every committee was set to `by_application`. `joinGroup` serves `open` groups only.
3. **Questions belong to the kind** (`groupApplicationQuestions`): the board's two for a committee,
   one optional note for a club, under the club's `joinInstructions`.
4. **Several groups per application only when all are committees.**
5. **Accepting invites the applicant**, who then accepts like any other invitation.
6. **Reviewers are the group's owner or admins, of any kind**, plus holders of
   `committee.reviewApplications` on a committee. `group.manage` alone does not qualify.
7. **Only an open choice blocks a new application**, so a declined applicant can apply again.

## Alternatives rejected

- **Keeping the `requested` roster status.** It carried no content and blocked re-applying.
- **Keeping two paths.** Members saw contradictory answers about the same committee.
- **Per-group questions.** Recorded in #1728 as a later, additive option.

## Consequences

- A migration copied the committee tables, turned each `requested` row into an application, deleted
  those rows, and set every committee to `by_application`. A second migration copied stragglers
  before the old tables were dropped. `requested` is no longer a roster status.
- A committee set back to `invite_only` stops taking applications; its open choices stay
  answerable.
- Bands stay `invite_only` and never take applications.
