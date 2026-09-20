-- Announcements become threads (#1307, part of #1304).
--
-- One `announcement` becomes one `inbox_thread` carrying the title as its
-- subject, plus one `inbox_message` carrying the body and the author. The
-- `announcement` table is deliberately LEFT IN PLACE: production D1 is
-- canonical and cannot be rebuilt, so nothing is dropped until #1309 has
-- verified the read surfaces against real rows.
--
-- The thread's id is the announcement's, so a row migrated twice would
-- violate the primary key rather than silently duplicate — and so #1309 can
-- match the two tables up without a mapping table.

INSERT INTO inbox_thread (
  id, channel, group_id, status, subject, preview,
  pinned, published_at, deleted_at, notified_at, recipient_count,
  post_policy, notify_policy,
  message_count, last_message_at, created_at, updated_at
)
SELECT
  a.id,
  'group',
  a.group_id,
  'open',
  a.title,
  -- The list shows a preview, and `announcement` never had one; the body's
  -- opening is what every other channel puts there.
  substr(a.body, 1, 120),
  a.pinned,
  a.published_at,
  a.deleted_at,
  a.notified_at,
  a.recipient_count,
  -- What an announcement is, as policy: leadership writes, the roster is
  -- emailed.
  'leadership',
  'email',
  1,
  -- Without this the whole back catalogue sorts below every chat topic,
  -- because `last_message_at` drives the list order. A draft has no
  -- published_at, so it falls back to when it was written.
  COALESCE(a.published_at, a.created_at),
  a.created_at,
  a.updated_at
FROM announcement a;
--> statement-breakpoint

INSERT INTO inbox_message (
  id, thread_id, direction, body, author_name, author_user_id, created_at
)
SELECT
  -- Deterministic, so replaying this migration cannot double-post a body.
  a.id,
  a.id,
  'peer',
  a.body,
  -- `announcement.author_id` is SET NULL on purpose: the post outlives the
  -- account. The timeline renders `author_name`, so a deleted author has to
  -- leave something behind rather than a blank line.
  COALESCE(u.name, 'A former member'),
  a.author_id,
  a.created_at
FROM announcement a
LEFT JOIN user u ON u.id = a.author_id;
