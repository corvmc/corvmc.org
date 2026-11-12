# 0064 A group has one Announcements thread

- **Date:** 2026-11-12
- **Status:** Accepted
- **Issue:** [#2618](https://github.com/corvmc/corvmc.org/issues/2618), superseding the
  thread-per-announcement rule of [#1304](https://github.com/corvmc/corvmc.org/issues/1304)

## Context

#1304 made each announcement its own `inbox_thread`, with `post_policy: 'leadership'`, its title in
`subject` and its body in the first message. Messages listed every one as a separate row. Real
Book Club, which posts weekly, showed five announcement rows beside its General chat. The owner's
decision on #2618: a group has at most two standing threads, General chat and one Announcements
thread.

## Decision

1. **One Announcements thread per group**, `post_policy: 'leadership'` and `notify_policy: 'email'`,
   subject `Announcements`. The partial unique index `idx_inbox_thread_group_announcements` on
   `inbox_thread (group_id) WHERE channel = 'group' AND post_policy = 'leadership'` enforces it.
   `getOrCreateAnnouncementThread` creates it on a group's first publish and lets the index
   settle a race.
2. **An announcement is a `group_announcement` row.** It is a draft until `publishedAt`. Leaders
   write and edit drafts there. Publishing posts the announcement as one message in the
   Announcements thread, its title as the first line, and records the message in `message_id`.
3. **Per-post state stays on the row:** pin, soft delete, the `notified_at` email latch and
   `recipient_count`. Publishing still emails the roster once per announcement.
4. **The Announcements thread takes no typed posts**, from leaders or members. Publishing is its
   only way in, because a typed message would bypass the per-post latch. Messages shows it
   without a composer.
5. **Named topics (#1301) and General chat are unchanged.** `createGroupTopic` makes only members'
   rooms and refuses the names `General` and `Announcements`.

## Migration

A custom migration, ordered before the index, does the following:

- copies every announcement thread into `group_announcement` under the same id;
- turns each group's oldest published, undeleted announcement thread into its Announcements thread;
- moves the messages of every other published, undeleted announcement into it, prefixing each
  post's message with its title;
- carries each reader's furthest read cursor to the merged thread;
- deletes the emptied threads, their read state and other dependent rows.

Drafts and withdrawn posts become rows with no message. Re-running it changes nothing.

## Alternatives rejected

- **One thread per group for everything** (option 3 on #2618). It removes named topics and turns
  announcements into chat messages.
- **Keeping per-post state on `inbox_message`.** Pin, soft delete and the email latch are not
  message concerns, and every chat message would carry the columns.

## Consequences

- `inbox_thread.pinned`, `published_at`, `deleted_at`, `notified_at` and `recipient_count` are
  no longer written for group threads.
- The email-room fan-out (`fanOutGroupRoom`, `publishGroupRoom`) is removed. Only
  `announcement.published` emails a roster.
- Messages titles a group row by its topic name, so the Announcements thread and named topics read
  apart from General.
