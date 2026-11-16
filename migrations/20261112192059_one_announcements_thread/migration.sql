-- #2618: one Announcements thread per group, before the unique index that
-- enforces it. A group's Announcements thread is the leadership thread with
-- subject 'Announcements' and no published_at; every other leadership thread
-- is one announcement from #1304. Safe to re-run: each step skips what an
-- earlier run already did.

-- 1. Every announcement thread becomes a row, keeping its id. A published,
--    undeleted one keeps its first message as its post.
INSERT OR IGNORE INTO `group_announcement` (`id`, `group_id`, `title`, `body`, `author_user_id`, `author_name`, `pinned`, `published_at`, `message_id`, `notified_at`, `recipient_count`, `deleted_at`, `created_at`, `updated_at`)
SELECT t.`id`, t.`group_id`, coalesce(t.`subject`, ''), coalesce(m.`body`, ''), m.`author_user_id`, m.`author_name`, t.`pinned`, t.`published_at`,
	CASE WHEN t.`published_at` IS NOT NULL AND t.`deleted_at` IS NULL THEN m.`id` END,
	t.`notified_at`, t.`recipient_count`, t.`deleted_at`, t.`created_at`, t.`updated_at`
FROM `inbox_thread` t
LEFT JOIN `inbox_message` m ON m.`id` = (
	SELECT m2.`id` FROM `inbox_message` m2 WHERE m2.`thread_id` = t.`id`
	ORDER BY m2.`created_at`, m2.`id` LIMIT 1)
WHERE t.`channel` = 'group' AND t.`post_policy` = 'leadership' AND t.`group_id` IS NOT NULL
	AND NOT (t.`subject` = 'Announcements' AND t.`published_at` IS NULL);
--> statement-breakpoint
-- 2. A group with published posts and no Announcements thread turns its oldest
--    published post's thread into one.
UPDATE `inbox_thread`
SET `subject` = 'Announcements', `published_at` = NULL, `notified_at` = NULL,
	`recipient_count` = NULL, `pinned` = 0, `deleted_at` = NULL, `updated_at` = unixepoch()
WHERE `id` IN (
	SELECT (
		SELECT t2.`id` FROM `inbox_thread` t2
		WHERE t2.`group_id` = g.`group_id` AND t2.`channel` = 'group' AND t2.`post_policy` = 'leadership'
			AND t2.`published_at` IS NOT NULL AND t2.`deleted_at` IS NULL
		ORDER BY t2.`created_at`, t2.`id` LIMIT 1)
	FROM (SELECT DISTINCT `group_id` FROM `inbox_thread`
		WHERE `channel` = 'group' AND `post_policy` = 'leadership') g
	WHERE NOT EXISTS (
		SELECT 1 FROM `inbox_thread` a
		WHERE a.`group_id` = g.`group_id` AND a.`channel` = 'group' AND a.`post_policy` = 'leadership'
			AND a.`subject` = 'Announcements' AND a.`published_at` IS NULL)
);
--> statement-breakpoint
-- 3. Every message of a published, undeleted post moves into its group's
--    Announcements thread.
UPDATE `inbox_message`
SET `thread_id` = (
	SELECT a.`id` FROM `inbox_thread` a, `inbox_thread` s
	WHERE s.`id` = `inbox_message`.`thread_id` AND a.`group_id` = s.`group_id`
		AND a.`channel` = 'group' AND a.`post_policy` = 'leadership'
		AND a.`subject` = 'Announcements' AND a.`published_at` IS NULL)
WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread`
	WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND `published_at` IS NOT NULL AND `deleted_at` IS NULL);
--> statement-breakpoint
-- 4. Each post opens with its title, as a newly published one does.
UPDATE `inbox_message`
SET `body` = (SELECT a.`title` FROM `group_announcement` a WHERE a.`message_id` = `inbox_message`.`id`)
	|| char(10) || char(10) || `body`
WHERE `id` IN (SELECT `message_id` FROM `group_announcement` WHERE `message_id` IS NOT NULL AND `title` <> '')
	AND substr(`body`, 1, length((SELECT a.`title` FROM `group_announcement` a WHERE a.`message_id` = `inbox_message`.`id`)) + 2)
		<> (SELECT a.`title` FROM `group_announcement` a WHERE a.`message_id` = `inbox_message`.`id`) || char(10) || char(10);
--> statement-breakpoint
-- 5. A reader who had read a post keeps that cursor on the merged thread.
INSERT INTO `inbox_group_read` (`id`, `thread_id`, `user_id`, `last_read_at`)
SELECT lower(hex(randomblob(16))), a.`id`, r.`user_id`, max(r.`last_read_at`)
FROM `inbox_group_read` r
JOIN `inbox_thread` s ON s.`id` = r.`thread_id`
JOIN `inbox_thread` a ON a.`group_id` = s.`group_id` AND a.`channel` = 'group'
	AND a.`post_policy` = 'leadership' AND a.`subject` = 'Announcements' AND a.`published_at` IS NULL
WHERE s.`channel` = 'group' AND s.`post_policy` = 'leadership' AND s.`id` <> a.`id`
	AND r.`last_read_at` IS NOT NULL
GROUP BY a.`id`, r.`user_id`
ON CONFLICT (`thread_id`, `user_id`) DO UPDATE
SET `last_read_at` = max(coalesce(`inbox_group_read`.`last_read_at`, 0), excluded.`last_read_at`);
--> statement-breakpoint
-- 6. Every other announcement thread goes, with what hangs off it. Explicit
--    rather than trusting the cascade, which D1 applies and a replay may not.
DELETE FROM `inbox_message` WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL));
--> statement-breakpoint
DELETE FROM `inbox_group_read` WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL));
--> statement-breakpoint
DELETE FROM `inbox_note` WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL));
--> statement-breakpoint
DELETE FROM `inbox_participant` WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL));
--> statement-breakpoint
DELETE FROM `inbox_thread_tag` WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL));
--> statement-breakpoint
UPDATE `market_vendor` SET `thread_id` = NULL WHERE `thread_id` IN (
	SELECT `id` FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
		AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL));
--> statement-breakpoint
DELETE FROM `inbox_thread` WHERE `channel` = 'group' AND `post_policy` = 'leadership'
	AND NOT (`subject` = 'Announcements' AND `published_at` IS NULL);
--> statement-breakpoint
-- 7. The merged thread's counters, from what it now holds.
UPDATE `inbox_thread`
SET `message_count` = (SELECT count(*) FROM `inbox_message` m WHERE m.`thread_id` = `inbox_thread`.`id`),
	`last_message_at` = (SELECT max(m.`created_at`) FROM `inbox_message` m WHERE m.`thread_id` = `inbox_thread`.`id`),
	`preview` = (SELECT substr(m.`body`, 1, 120) FROM `inbox_message` m WHERE m.`thread_id` = `inbox_thread`.`id`
		ORDER BY m.`created_at` DESC, m.`id` DESC LIMIT 1)
WHERE `channel` = 'group' AND `post_policy` = 'leadership'
	AND `subject` = 'Announcements' AND `published_at` IS NULL;
