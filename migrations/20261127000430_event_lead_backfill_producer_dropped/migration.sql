-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   production_expense, production_slot, production_till_count
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
-- Event lead backfill (#3274): production.producer_user_id becomes an "Event lead" task
-- assignee, before the column is dropped by the rebuild below. The six door_cash_*
-- columns go in the same rebuild (#3372); their figures moved to production_till_count
-- in #3273. Every statement is a no-op on a second run: the role, its two capability
-- rows and each show's lead task are only added where missing, and a task that already
-- has an assignee is left to them. A producer who no longer has a live account is skipped,
-- and with no producer to name nothing is created, role included.
INSERT INTO volunteer_role (id, name, description, `group`, display_order)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'Event lead',
	'Work with the acts before the show: answer their questions, keep their guest lists and run the advance.' || char(10) || char(10) || 'One person per show, named by staff. There is no shift; the role carries the show''s production tools from the day you are named.',
	'away-from-shows', 54
WHERE NOT EXISTS (SELECT 1 FROM volunteer_role WHERE name = 'Event lead')
	AND EXISTS (
		SELECT 1 FROM production p
		JOIN event_listing e ON e.project_id = p.project_id
		JOIN user u ON u.id = p.producer_user_id AND u.deleted_at IS NULL
	);
--> statement-breakpoint
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'role', r.id, r.name,
	json_object('added', json((
		SELECT json_group_array(w.capability) FROM (
			SELECT 'production.run' AS capability UNION ALL SELECT 'event.manageGuests'
		) w
		WHERE NOT EXISTS (
			SELECT 1 FROM volunteer_role_capability c
			WHERE c.volunteer_role_id = r.id AND c.capability = w.capability
		)
	)), 'removed', json('[]')), unixepoch()
FROM volunteer_role r
WHERE r.name = 'Event lead'
	AND EXISTS (
		SELECT 1 FROM production p
		JOIN event_listing e ON e.project_id = p.project_id
		JOIN user u ON u.id = p.producer_user_id AND u.deleted_at IS NULL
	)
	AND (SELECT count(*) FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = r.id AND c.capability IN ('production.run', 'event.manageGuests')) < 2;
--> statement-breakpoint
INSERT OR IGNORE INTO volunteer_role_capability (volunteer_role_id, capability)
SELECT r.id, w.capability FROM volunteer_role r
JOIN (SELECT 'production.run' AS capability UNION ALL SELECT 'event.manageGuests') w
WHERE r.name = 'Event lead'
	AND EXISTS (
		SELECT 1 FROM production p
		JOIN event_listing e ON e.project_id = p.project_id
		JOIN user u ON u.id = p.producer_user_id AND u.deleted_at IS NULL
	);
--> statement-breakpoint
INSERT INTO work_order (id, volunteer_role_id, event_id, title, notes)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	r.id, e.id, 'Event lead', 'Works with the acts before the show: answers their questions and keeps each act''s guest list. The Production tab has the advance.'
FROM production p
JOIN event_listing e ON e.project_id = p.project_id
JOIN user u ON u.id = p.producer_user_id AND u.deleted_at IS NULL
JOIN volunteer_role r ON r.name = 'Event lead'
WHERE NOT EXISTS (
	SELECT 1 FROM work_order t
	WHERE t.event_id = e.id AND t.volunteer_role_id = r.id AND t.cancelled_at IS NULL
);
--> statement-breakpoint
WITH producer_task AS (
	SELECT p.producer_user_id AS user_id,
		(SELECT t.id FROM work_order t
			WHERE t.event_id = e.id AND t.volunteer_role_id = r.id AND t.cancelled_at IS NULL
			ORDER BY t.created_at, t.id LIMIT 1) AS task_id
	FROM production p
	JOIN event_listing e ON e.project_id = p.project_id
	JOIN user u ON u.id = p.producer_user_id AND u.deleted_at IS NULL
	JOIN volunteer_role r ON r.name = 'Event lead'
)
INSERT INTO work_order_assignee (work_order_id, user_id, assigned_at)
SELECT task_id, user_id, unixepoch() FROM producer_task
WHERE task_id IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM work_order_assignee a WHERE a.work_order_id = producer_task.task_id);
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- detach production_expense
CREATE TABLE `__detach_production_expense` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`deductible` integer DEFAULT true NOT NULL,
	`paid_to` text,
	`paid_at` integer,
	`notes` text,
	`recorded_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_expense_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`),
	CONSTRAINT `fk_production_expense_recorded_by_user_id_user_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_production_expense`(`id`, `production_id`, `label`, `category`, `amount_cents`, `deductible`, `paid_to`, `paid_at`, `notes`, `recorded_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `label`, `category`, `amount_cents`, `deductible`, `paid_to`, `paid_at`, `notes`, `recorded_by_user_id`, `created_at`, `updated_at` FROM `production_expense`;
--> statement-breakpoint
DROP TABLE `production_expense`;
--> statement-breakpoint
ALTER TABLE `__detach_production_expense` RENAME TO `production_expense`;
--> statement-breakpoint
CREATE INDEX `idx_production_expense_production` ON `production_expense` (`production_id`,`category`);
--> statement-breakpoint
-- detach production_slot
CREATE TABLE `__detach_production_slot` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`event_band_id` text,
	`sort_order` real NOT NULL,
	`set_length_minutes` integer NOT NULL,
	`changeover_minutes` integer DEFAULT 10 NOT NULL,
	`scheduled_start_at` integer,
	`actual_start_at` integer,
	`actual_end_at` integer,
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_id` text,
	`guarantee_cents` integer,
	`percentage_bps` integer,
	`versus` integer DEFAULT false NOT NULL,
	`against_net` integer DEFAULT false NOT NULL,
	`contributed` integer DEFAULT false NOT NULL,
	`paid_cents` integer,
	`paid_at` integer,
	`paid_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_slot_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`),
	CONSTRAINT `fk_production_slot_event_band_id_event_band_id_fk` FOREIGN KEY (`event_band_id`) REFERENCES `event_band`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_paid_by_user_id_user_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_slot_set_length_positive` CHECK(set_length_minutes > 0),
	CONSTRAINT `production_slot_changeover_nonneg` CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
INSERT INTO `__detach_production_slot`(`id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at` FROM `production_slot`;
--> statement-breakpoint
DROP TABLE `production_slot`;
--> statement-breakpoint
ALTER TABLE `__detach_production_slot` RENAME TO `production_slot`;
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;
--> statement-breakpoint
-- detach production_till_count
CREATE TABLE `__detach_production_till_count` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`kind` text NOT NULL,
	`cash_cents` integer NOT NULL,
	`counted_by_user_id` text,
	`counted_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_till_count_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`),
	CONSTRAINT `fk_production_till_count_counted_by_user_id_user_id_fk` FOREIGN KEY (`counted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_till_count_cash_nonneg` CHECK(cash_cents >= 0)
);
--> statement-breakpoint
INSERT INTO `__detach_production_till_count`(`id`, `production_id`, `kind`, `cash_cents`, `counted_by_user_id`, `counted_at`, `created_at`) SELECT `id`, `production_id`, `kind`, `cash_cents`, `counted_by_user_id`, `counted_at`, `created_at` FROM `production_till_count`;
--> statement-breakpoint
DROP TABLE `production_till_count`;
--> statement-breakpoint
ALTER TABLE `__detach_production_till_count` RENAME TO `production_till_count`;
--> statement-breakpoint
CREATE INDEX `idx_production_till_count_production` ON `production_till_count` (`production_id`,`counted_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_till_count_staff` ON `production_till_count` (`production_id`) WHERE kind = 'staff';
--> statement-breakpoint
CREATE TABLE `__new_production` (
	`id` text PRIMARY KEY,
	`status` text DEFAULT 'draft' NOT NULL,
	`project_id` text,
	`load_in_at` integer,
	`soundcheck_at` integer,
	`first_set_at` integer,
	`curfew_at` integer,
	`load_out_by` integer,
	`changeover_minutes` integer DEFAULT 15 NOT NULL,
	`load_in_done_at` integer,
	`soundcheck_done_at` integer,
	`doors_done_at` integer,
	`curfew_done_at` integer,
	`load_out_done_at` integer,
	`door_count` integer,
	`door_split_acts_percent` integer,
	`acts_wanted` integer,
	`billing_notes` text,
	`hospitality_notes` text,
	`internal_notes` text,
	`created_by_user_id` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_production_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_closed_by_user_id_user_id_fk` FOREIGN KEY (`closed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "production_curfew_after_first_set" CHECK(curfew_at is null or first_set_at is null or curfew_at > first_set_at)
);
--> statement-breakpoint
INSERT INTO `__new_production`(`id`, `status`, `project_id`, `load_in_at`, `soundcheck_at`, `first_set_at`, `curfew_at`, `load_out_by`, `changeover_minutes`, `load_in_done_at`, `soundcheck_done_at`, `doors_done_at`, `curfew_done_at`, `load_out_done_at`, `door_count`, `door_split_acts_percent`, `acts_wanted`, `billing_notes`, `hospitality_notes`, `internal_notes`, `created_by_user_id`, `closed_at`, `closed_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `status`, `project_id`, `load_in_at`, `soundcheck_at`, `first_set_at`, `curfew_at`, `load_out_by`, `changeover_minutes`, `load_in_done_at`, `soundcheck_done_at`, `doors_done_at`, `curfew_done_at`, `load_out_done_at`, `door_count`, `door_split_acts_percent`, `acts_wanted`, `billing_notes`, `hospitality_notes`, `internal_notes`, `created_by_user_id`, `closed_at`, `closed_by_user_id`, `created_at`, `updated_at` FROM `production`;
--> statement-breakpoint
DROP TABLE `production`;
--> statement-breakpoint
ALTER TABLE `__new_production` RENAME TO `production`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_production_producer`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_project` ON `production` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_production_status` ON `production` (`status`);
--> statement-breakpoint
-- reattach production_till_count
CREATE TABLE `__reattach_production_till_count` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`kind` text NOT NULL,
	`cash_cents` integer NOT NULL,
	`counted_by_user_id` text,
	`counted_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_till_count_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_till_count_counted_by_user_id_user_id_fk` FOREIGN KEY (`counted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_till_count_cash_nonneg` CHECK(cash_cents >= 0)
);
--> statement-breakpoint
INSERT INTO `__reattach_production_till_count`(`id`, `production_id`, `kind`, `cash_cents`, `counted_by_user_id`, `counted_at`, `created_at`) SELECT `id`, `production_id`, `kind`, `cash_cents`, `counted_by_user_id`, `counted_at`, `created_at` FROM `production_till_count`;
--> statement-breakpoint
DROP TABLE `production_till_count`;
--> statement-breakpoint
ALTER TABLE `__reattach_production_till_count` RENAME TO `production_till_count`;
--> statement-breakpoint
CREATE INDEX `idx_production_till_count_production` ON `production_till_count` (`production_id`,`counted_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_till_count_staff` ON `production_till_count` (`production_id`) WHERE kind = 'staff';
--> statement-breakpoint
-- reattach production_slot
CREATE TABLE `__reattach_production_slot` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`event_band_id` text,
	`sort_order` real NOT NULL,
	`set_length_minutes` integer NOT NULL,
	`changeover_minutes` integer DEFAULT 10 NOT NULL,
	`scheduled_start_at` integer,
	`actual_start_at` integer,
	`actual_end_at` integer,
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_id` text,
	`guarantee_cents` integer,
	`percentage_bps` integer,
	`versus` integer DEFAULT false NOT NULL,
	`against_net` integer DEFAULT false NOT NULL,
	`contributed` integer DEFAULT false NOT NULL,
	`paid_cents` integer,
	`paid_at` integer,
	`paid_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_slot_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_slot_event_band_id_event_band_id_fk` FOREIGN KEY (`event_band_id`) REFERENCES `event_band`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_paid_by_user_id_user_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_slot_set_length_positive` CHECK(set_length_minutes > 0),
	CONSTRAINT `production_slot_changeover_nonneg` CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
INSERT INTO `__reattach_production_slot`(`id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at` FROM `production_slot`;
--> statement-breakpoint
DROP TABLE `production_slot`;
--> statement-breakpoint
ALTER TABLE `__reattach_production_slot` RENAME TO `production_slot`;
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;
--> statement-breakpoint
-- reattach production_expense
CREATE TABLE `__reattach_production_expense` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`deductible` integer DEFAULT true NOT NULL,
	`paid_to` text,
	`paid_at` integer,
	`notes` text,
	`recorded_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_expense_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_expense_recorded_by_user_id_user_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_production_expense`(`id`, `production_id`, `label`, `category`, `amount_cents`, `deductible`, `paid_to`, `paid_at`, `notes`, `recorded_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `label`, `category`, `amount_cents`, `deductible`, `paid_to`, `paid_at`, `notes`, `recorded_by_user_id`, `created_at`, `updated_at` FROM `production_expense`;
--> statement-breakpoint
DROP TABLE `production_expense`;
--> statement-breakpoint
ALTER TABLE `__reattach_production_expense` RENAME TO `production_expense`;
--> statement-breakpoint
CREATE INDEX `idx_production_expense_production` ON `production_expense` (`production_id`,`category`);
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
--> statement-breakpoint
-- restore trigger `production_project_required_insert`: dropping `production` dropped it
CREATE TRIGGER `production_project_required_insert`
BEFORE INSERT ON `production`
WHEN NEW.project_id IS NULL
BEGIN
	SELECT RAISE(ABORT, 'production.project_id is required');
END;
--> statement-breakpoint
-- restore trigger `production_project_required_update`: dropping `production` dropped it
CREATE TRIGGER `production_project_required_update`
BEFORE UPDATE OF `project_id` ON `production`
WHEN NEW.project_id IS NULL
BEGIN
	SELECT RAISE(ABORT, 'production.project_id is required');
END;
