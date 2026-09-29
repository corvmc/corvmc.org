-- #1700: one application flow for every group kind. Every statement is
-- idempotent on its target id, so the contract migration can re-run the copy
-- for rows the previous Worker wrote between this migrating and it publishing.
INSERT OR IGNORE INTO `group_application` (`id`, `user_id`, `answers`, `withdrawn_at`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `answers`, `withdrawn_at`, `created_at`, `updated_at` FROM `committee_application`;
--> statement-breakpoint
INSERT OR IGNORE INTO `group_application_choice` (`id`, `application_id`, `group_id`, `status`, `review_notes`, `decided_by_user_id`, `decided_at`, `created_at`, `updated_at`)
SELECT `id`, `application_id`, `group_id`, `status`, `review_notes`, `decided_by_user_id`, `decided_at`, `created_at`, `updated_at` FROM `committee_application_choice`;
--> statement-breakpoint
-- A `requested` roster row becomes an application with no answers and one open
-- choice, unless the same person already has an open choice for that group.
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
-- Accepting invites, and `invite()` would hit unique(group_id, user_id) on a
-- `requested` row left behind. Every one is now an open choice.
DELETE FROM `group_member` WHERE `status` = 'requested';
--> statement-breakpoint
UPDATE `group` SET `join_policy` = 'by_application' WHERE `kind` = 'committee';
