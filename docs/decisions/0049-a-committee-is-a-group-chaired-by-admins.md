# 0049 A committee is a group, chaired by its admins

- **Date:** 2026-08-28
- **Status:** Accepted
- **Issue:** [#607](https://github.com/corvmc/corvmc.org/issues/607)

## Context

The collective adopted six committees, each with a chair, between a board and a volunteer pool.
The word "committee" meant two unrelated things in the code: a `group` kind with a roster, and a
`volunteer_role` bucket holding rows such as "Booking Committee". Nothing connected the two.
Committee membership granted nothing, so committee work collapsed into "be staff".

## Decision

1. **A committee is a `group` with `kind = 'committee'`.** The roster is `group_member`.
2. **The committee volunteer roles retire.** The `committee` bucket leaves `volunteerRoleGroups`.
   The six roles are archived rather than deleted, because hour logs point at them, and their
   interest rows become the first applications.
3. **A chair is a group `admin`, not an `owner`.** The chair is first among equals and is
   appointed by the board. A committee is normally ownerless, and a chair and a deputy look the
   same in the data.
4. **`group_member.position` is a free-text label that no code reads.** Titles are the chair's to
   invent, rename and drop.
5. **Committee members act within their own domain.** A committee guard reads `group_member`,
   resolves the committee from the row being acted on, and composes with staff, who can always
   cover.
6. **Workflow surfaces are added beside the staff panel**, which stays as the administrative tool.

## Alternatives rejected

- **Keeping both meanings and building a funnel from role interest to the roster.** More code, and
  the name would mean two things permanently.
- **The chair as `owner`, or a fourth role value.** `owner` carries transfer and delete, which
  belong to staff for a committee.
- **A machine-readable `position`.** Code that read it would constrain it. The cost is that the app
  cannot notice an unstaffed duty; the chair reports that.
- **Committees that meet and ask staff to act.** It turns the structure into a documents and
  announcements problem and leaves panel access as the only way to do committee work.

## Consequences

- Each new committee power is a guard over `group_member` plus a named capability. The guard is
  `requireCommitteeMember(groupId, cover)` in the code today.
- Staff add and remove chairs from the program's staff page.
- The duties the app does not serve yet are listed on
  [#2557](https://github.com/corvmc/corvmc.org/issues/2557).
