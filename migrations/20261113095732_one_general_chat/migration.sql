-- #2621: one General topic per group, before the unique index that enforces
-- it. General is the group thread with no subject; where a group has several,
-- the oldest keeps its id and takes in the rest. Production had none on
-- 2026-11-13, so on D1 every statement here matches nothing.

-- 1. Every message of a later General moves into the group's oldest one.
UPDATE `inbox_message`
SET `thread_id` = (
	SELECT k.`id` FROM `inbox_thread` k, `inbox_thread` s
	WHERE s.`id` = `inbox_message`.`thread_id` AND k.`group_id` = s.`group_id`
		AND k.`channel` = 'group' AND k.`subject` IS NULL
	ORDER BY k.`created_at`, k.`id` LIMIT 1)
WHERE `thread_id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
-- 2. A reader keeps the furthest cursor, and a mute, across the merged threads.
INSERT INTO `inbox_group_read` (`id`, `thread_id`, `user_id`, `last_read_at`, `muted`)
SELECT lower(hex(randomblob(16))), k.`id`, r.`user_id`, max(r.`last_read_at`), max(r.`muted`)
FROM `inbox_group_read` r
JOIN `inbox_thread` s ON s.`id` = r.`thread_id`
JOIN `inbox_thread` k ON k.`id` = (
	SELECT k2.`id` FROM `inbox_thread` k2
	WHERE k2.`group_id` = s.`group_id` AND k2.`channel` = 'group' AND k2.`subject` IS NULL
	ORDER BY k2.`created_at`, k2.`id` LIMIT 1)
WHERE s.`channel` = 'group' AND s.`subject` IS NULL AND s.`id` <> k.`id`
GROUP BY k.`id`, r.`user_id`
ON CONFLICT (`thread_id`, `user_id`) DO UPDATE
SET `last_read_at` = max(coalesce(`inbox_group_read`.`last_read_at`, 0), coalesce(excluded.`last_read_at`, 0)),
	`muted` = max(`inbox_group_read`.`muted`, excluded.`muted`);
--> statement-breakpoint
-- 3. The later Generals go, with what hangs off them. Explicit rather than
--    trusting the cascade, which D1 applies and a replay may not.
DELETE FROM `inbox_group_read` WHERE `thread_id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
DELETE FROM `inbox_note` WHERE `thread_id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
DELETE FROM `inbox_participant` WHERE `thread_id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
DELETE FROM `inbox_thread_tag` WHERE `thread_id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
UPDATE `market_vendor` SET `thread_id` = NULL WHERE `thread_id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
DELETE FROM `inbox_thread` WHERE `id` IN (
	SELECT t.`id` FROM `inbox_thread` t
	WHERE t.`channel` = 'group' AND t.`subject` IS NULL AND EXISTS (
		SELECT 1 FROM `inbox_thread` k
		WHERE k.`group_id` = t.`group_id` AND k.`channel` = 'group' AND k.`subject` IS NULL
			AND (k.`created_at` < t.`created_at` OR (k.`created_at` = t.`created_at` AND k.`id` < t.`id`))));
--> statement-breakpoint
-- 4. Every General's counters, from what it now holds. Only a merged one
--    changes; the rest recompute to what they had.
UPDATE `inbox_thread`
SET `message_count` = (SELECT count(*) FROM `inbox_message` m WHERE m.`thread_id` = `inbox_thread`.`id`),
	`last_message_at` = (SELECT max(m.`created_at`) FROM `inbox_message` m WHERE m.`thread_id` = `inbox_thread`.`id`),
	`preview` = (SELECT substr(m.`body`, 1, 120) FROM `inbox_message` m WHERE m.`thread_id` = `inbox_thread`.`id`
		ORDER BY m.`created_at` DESC, m.`id` DESC LIMIT 1)
WHERE `channel` = 'group' AND `subject` IS NULL
	AND `id` IN (SELECT `thread_id` FROM `inbox_message` WHERE `thread_id` IS NOT NULL);
