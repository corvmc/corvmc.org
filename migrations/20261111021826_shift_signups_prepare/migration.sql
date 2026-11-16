-- #2518 PR 2, before sign-ups and hour logs repoint to `volunteer_shift`.
-- 1. Rerun PR 1's copy: a timed work order made since then gets its one shift.
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
--> statement-breakpoint
-- 2. A sign-up on a task with no shift was staff assigning it: it becomes an assignee.
INSERT OR IGNORE INTO `work_order_assignee` (`work_order_id`, `user_id`, `assigned_at`, `completed_at`)
SELECT `vs`.`shift_id`, `vs`.`user_id`, `vs`.`claimed_at`, `vs`.`completed_at`
FROM `volunteer_signup` `vs`
WHERE `vs`.`status` NOT IN ('cancelled', 'declined', 'invited')
	AND NOT EXISTS (SELECT 1 FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `vs`.`shift_id`);
--> statement-breakpoint
-- 3. An hour log naming a task with no shift names the task instead.
UPDATE `volunteer_hour_log`
SET `work_order_id` = `shift_id`, `shift_id` = NULL
WHERE `shift_id` IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `volunteer_hour_log`.`shift_id`);
--> statement-breakpoint
-- 4. Those sign-ups have no shift to point at once the foreign key moves; step 2 kept them.
DELETE FROM `volunteer_signup`
WHERE NOT EXISTS (SELECT 1 FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `volunteer_signup`.`shift_id`);
