-- #1700 contract: the Worker that was live while the switch migrated could
-- still write committee applications and `requested` rows. Copy those again,
-- with the switch's own idempotent statements, before the next migration drops
-- the old tables. Committees are not re-flipped: staff may have closed one.
INSERT OR IGNORE INTO `group_application` (`id`, `user_id`, `answers`, `withdrawn_at`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `answers`, `withdrawn_at`, `created_at`, `updated_at` FROM `committee_application`;
--> statement-breakpoint
INSERT OR IGNORE INTO `group_application_choice` (`id`, `application_id`, `group_id`, `status`, `review_notes`, `decided_by_user_id`, `decided_at`, `created_at`, `updated_at`)
SELECT `id`, `application_id`, `group_id`, `status`, `review_notes`, `decided_by_user_id`, `decided_at`, `created_at`, `updated_at` FROM `committee_application_choice`;
--> statement-breakpoint
INSERT OR IGNORE INTO `group_application` (`id`, `user_id`, `answers`, `created_at`, `updated_at`)
SELECT 'migrated-request-' || gm.`id`, gm.`user_id`, '{}', gm.`created_at`, coalesce(gm.`updated_at`, gm.`created_at`)
FROM `group_member` gm
WHERE gm.`status` = 'requested'
	AND NOT EXISTS (
		SELECT 1 FROM `group_application_choice` c
		JOIN `group_application` a ON a.`id` = c.`application_id`
		WHERE a.`user_id` = gm.`user_id` AND c.`group_id` = gm.`group_id`
			AND a.`withdrawn_at` IS NULL AND c.`status` IN ('submitted', 'contacted')
	);
--> statement-breakpoint
INSERT OR IGNORE INTO `group_application_choice` (`id`, `application_id`, `group_id`, `status`, `created_at`, `updated_at`)
SELECT 'migrated-request-' || gm.`id`, a.`id`, gm.`group_id`, 'submitted', gm.`created_at`, coalesce(gm.`updated_at`, gm.`created_at`)
FROM `group_member` gm
JOIN `group_application` a ON a.`id` = 'migrated-request-' || gm.`id`
WHERE gm.`status` = 'requested';
--> statement-breakpoint
DELETE FROM `group_member` WHERE `status` = 'requested';
