-- #2518: every timed work order gets one shift with its times, capacity, anchor, notes and
-- cancellation. The task keeps its id; the shift gets a new UUID v4. Fall Festival Day 1/Day 2
-- stay two tasks. Sign-ups and hour logs still reference work_order until their foreign keys
-- are repointed; the NOT EXISTS lets that later migration rerun this copy for newer rows.
INSERT INTO `volunteer_shift` (
	`id`, `work_order_id`, `starts_at`, `ends_at`, `capacity`, `anchor`, `notes`,
	`cancelled_at`, `cancelled_by_user_id`, `created_by_user_id`, `created_at`, `updated_at`
)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
		substr(lower(hex(randomblob(2))), 2) || '-' ||
		substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
		lower(hex(randomblob(6))),
	`wo`.`id`, `wo`.`starts_at`, `wo`.`ends_at`, `wo`.`capacity`, `wo`.`anchor`, `wo`.`notes`,
	`wo`.`cancelled_at`, `wo`.`cancelled_by_user_id`,
	coalesce(`wo`.`posted_by_user_id`, `wo`.`created_by_user_id`),
	`wo`.`created_at`, `wo`.`updated_at`
FROM `work_order` `wo`
WHERE `wo`.`starts_at` IS NOT NULL
	AND `wo`.`ends_at` IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `wo`.`id`);
