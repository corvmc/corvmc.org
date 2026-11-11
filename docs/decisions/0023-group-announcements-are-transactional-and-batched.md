# 0023 Group announcements are transactional and batched

- **Date:** 2026-08-08
- **Status:** Accepted
- **PRs:** #333, #334, #335

## Context

A band, club or committee posts announcements to its roster, in-app and by email. The notification
path, `dispatch()`, performs a preference read, an insert, a push and one Postmark call per
recipient, awaited in series. A 200-member group is about 600 subrequests against a Worker's
ceiling of 1000, and a failure partway leaves half the roster notified with no record of where it
stopped. The event bus delivers at least once.

## Decision

1. **One notification type, `announcement`, for every kind of group.** The kind goes in the payload
   and the copy. Each membership row carries its own mute, `group_member.notifyAnnouncements`,
   because a global preference cannot silence one group of six.
2. **The send is a listener, not part of the remote.** The remote writes, emits and returns.
3. **The listener latches first.** One `UPDATE` sets `notified_at` where it is null and returns the
   row. No row back means another delivery is already sending.
4. **Recipients come from one query**, which excludes the author, inactive rows, mutes and
   deactivated accounts. In-app rows insert in chunks under D1's 100-parameter cap. Email goes out
   through `sendTemplateBatch()`, 500 per Postmark call.
5. **Announcements ride the transactional stream** and ignore `subscriber.suppressedAt`. A member
   receives them because they joined a roster, so a marketing opt-out does not silence them. Every
   announcement email carries a one-click mute for the group.

## Alternatives rejected

- **`dispatch()` in a loop.** Breaks on the subrequest ceiling and fails part-way without a record.
- **One notification type per kind.** Several identical rows in the preferences page for one user
  decision.
- **The broadcast stream, or honouring `suppressedAt`.** A marketing opt-out would silence a group
  the member chose to join.

## Consequences

- A spam complaint lands on the stream that also carries password resets. If complaint rates rise,
  the fix is a separate Postmark stream for announcements, not consulting `suppressedAt`.
- Past about 500 recipients the send should persist a cursor and let cron drain it. Until that is
  built, the count is logged.
