-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   sponsor_placement, grant_report
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- detach sponsor_placement
CREATE TABLE `__detach_sponsor_placement` (
	`id` text PRIMARY KEY,
	`sponsorship_id` text NOT NULL,
	`event_id` text NOT NULL,
	`on_event_page` integer DEFAULT true NOT NULL,
	`in_campaign` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_sponsor_placement_sponsorship_id_sponsorship_id_fk` FOREIGN KEY (`sponsorship_id`) REFERENCES `sponsorship`(`id`),
	CONSTRAINT `fk_sponsor_placement_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_sponsor_placement`(`id`, `sponsorship_id`, `event_id`, `on_event_page`, `in_campaign`, `created_at`) SELECT `id`, `sponsorship_id`, `event_id`, `on_event_page`, `in_campaign`, `created_at` FROM `sponsor_placement`;
--> statement-breakpoint
DROP TABLE `sponsor_placement`;
--> statement-breakpoint
ALTER TABLE `__detach_sponsor_placement` RENAME TO `sponsor_placement`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_placement_term_event_idx` ON `sponsor_placement` (`sponsorship_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `sponsor_placement_event_idx` ON `sponsor_placement` (`event_id`);
--> statement-breakpoint
-- detach grant_report
CREATE TABLE `__detach_grant_report` (
	`id` text PRIMARY KEY,
	`grant_application_id` text NOT NULL,
	`title` text NOT NULL,
	`due_on` text NOT NULL,
	`submitted_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_grant_report_grant_application_id_grant_application_id_fk` FOREIGN KEY (`grant_application_id`) REFERENCES `grant_application`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_grant_report`(`id`, `grant_application_id`, `title`, `due_on`, `submitted_on`, `notes`, `created_at`, `updated_at`) SELECT `id`, `grant_application_id`, `title`, `due_on`, `submitted_on`, `notes`, `created_at`, `updated_at` FROM `grant_report`;
--> statement-breakpoint
DROP TABLE `grant_report`;
--> statement-breakpoint
ALTER TABLE `__detach_grant_report` RENAME TO `grant_report`;
--> statement-breakpoint
CREATE INDEX `grant_report_application_idx` ON `grant_report` (`grant_application_id`);
--> statement-breakpoint
CREATE TABLE `__new_contractor_job` (
	`id` text PRIMARY KEY,
	`status` text DEFAULT 'asked' NOT NULL,
	`work_order_id` text NOT NULL,
	`scheduled_for` integer,
	`expected_back_at` integer,
	`completed_at` integer,
	`quoted_cents` integer,
	`cost_cents` integer,
	`is_donated` integer DEFAULT false NOT NULL,
	`fair_value_cents` integer,
	`fair_value_basis` text,
	`invoice_ref` text,
	`paid_at` integer,
	`requested_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_contractor_job_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_contractor_job_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "contractor_job_cost_nonneg" CHECK(not (cost_cents < 0) and not (quoted_cents < 0))
);
--> statement-breakpoint
INSERT INTO `__new_contractor_job`(`id`, `status`, `work_order_id`, `scheduled_for`, `expected_back_at`, `completed_at`, `quoted_cents`, `cost_cents`, `is_donated`, `fair_value_cents`, `fair_value_basis`, `invoice_ref`, `paid_at`, `requested_by_user_id`, `notes`, `created_at`, `updated_at`) SELECT `id`, `status`, `work_order_id`, `scheduled_for`, `expected_back_at`, `completed_at`, `quoted_cents`, `cost_cents`, `is_donated`, `fair_value_cents`, `fair_value_basis`, `invoice_ref`, `paid_at`, `requested_by_user_id`, `notes`, `created_at`, `updated_at` FROM `contractor_job`;
--> statement-breakpoint
DROP TABLE `contractor_job`;
--> statement-breakpoint
ALTER TABLE `__new_contractor_job` RENAME TO `contractor_job`;
--> statement-breakpoint
CREATE TABLE `__new_sponsorship` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`tier` text,
	`status` text DEFAULT 'prospect' NOT NULL,
	`amount_cents` integer,
	`starts_on` text,
	`ends_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sponsorship`(`id`, `title`, `tier`, `status`, `amount_cents`, `starts_on`, `ends_on`, `notes`, `created_at`, `updated_at`) SELECT `id`, `title`, `tier`, `status`, `amount_cents`, `starts_on`, `ends_on`, `notes`, `created_at`, `updated_at` FROM `sponsorship`;
--> statement-breakpoint
DROP TABLE `sponsorship`;
--> statement-breakpoint
ALTER TABLE `__new_sponsorship` RENAME TO `sponsorship`;
--> statement-breakpoint
CREATE TABLE `__new_grant_application` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`status` text DEFAULT 'prospect' NOT NULL,
	`amount_requested_cents` integer,
	`amount_awarded_cents` integer,
	`apply_by` text,
	`starts_on` text,
	`ends_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_grant_application`(`id`, `title`, `status`, `amount_requested_cents`, `amount_awarded_cents`, `apply_by`, `starts_on`, `ends_on`, `notes`, `created_at`, `updated_at`) SELECT `id`, `title`, `status`, `amount_requested_cents`, `amount_awarded_cents`, `apply_by`, `starts_on`, `ends_on`, `notes`, `created_at`, `updated_at` FROM `grant_application`;
--> statement-breakpoint
DROP TABLE `grant_application`;
--> statement-breakpoint
ALTER TABLE `__new_grant_application` RENAME TO `grant_application`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contractor_trade`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contractor_active`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contractor_insurance`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contractor_job_contractor`;
--> statement-breakpoint
DROP INDEX IF EXISTS `sponsorship_sponsor_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `grant_application_funder_idx`;
--> statement-breakpoint
CREATE INDEX `idx_contractor_job_work_order` ON `contractor_job` (`work_order_id`);
--> statement-breakpoint
CREATE INDEX `idx_contractor_job_status` ON `contractor_job` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_contractor_job_overdue` ON `contractor_job` (`expected_back_at`) WHERE status = 'booked';
--> statement-breakpoint
CREATE INDEX `grant_application_status_idx` ON `grant_application` (`status`);
--> statement-breakpoint
DROP TABLE `contractor`;
--> statement-breakpoint
DROP TABLE `sponsor`;
--> statement-breakpoint
DROP TABLE `funder`;
--> statement-breakpoint
ALTER TABLE `contact` DROP COLUMN `booking_name`;
--> statement-breakpoint
ALTER TABLE `contact` DROP COLUMN `booking_email`;
--> statement-breakpoint
ALTER TABLE `contact` DROP COLUMN `booking_phone`;
--> statement-breakpoint
-- reattach grant_report
CREATE TABLE `__reattach_grant_report` (
	`id` text PRIMARY KEY,
	`grant_application_id` text NOT NULL,
	`title` text NOT NULL,
	`due_on` text NOT NULL,
	`submitted_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_grant_report_grant_application_id_grant_application_id_fk` FOREIGN KEY (`grant_application_id`) REFERENCES `grant_application`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_grant_report`(`id`, `grant_application_id`, `title`, `due_on`, `submitted_on`, `notes`, `created_at`, `updated_at`) SELECT `id`, `grant_application_id`, `title`, `due_on`, `submitted_on`, `notes`, `created_at`, `updated_at` FROM `grant_report`;
--> statement-breakpoint
DROP TABLE `grant_report`;
--> statement-breakpoint
ALTER TABLE `__reattach_grant_report` RENAME TO `grant_report`;
--> statement-breakpoint
CREATE INDEX `grant_report_application_idx` ON `grant_report` (`grant_application_id`);
--> statement-breakpoint
-- reattach sponsor_placement
CREATE TABLE `__reattach_sponsor_placement` (
	`id` text PRIMARY KEY,
	`sponsorship_id` text NOT NULL,
	`event_id` text NOT NULL,
	`on_event_page` integer DEFAULT true NOT NULL,
	`in_campaign` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_sponsor_placement_sponsorship_id_sponsorship_id_fk` FOREIGN KEY (`sponsorship_id`) REFERENCES `sponsorship`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sponsor_placement_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_sponsor_placement`(`id`, `sponsorship_id`, `event_id`, `on_event_page`, `in_campaign`, `created_at`) SELECT `id`, `sponsorship_id`, `event_id`, `on_event_page`, `in_campaign`, `created_at` FROM `sponsor_placement`;
--> statement-breakpoint
DROP TABLE `sponsor_placement`;
--> statement-breakpoint
ALTER TABLE `__reattach_sponsor_placement` RENAME TO `sponsor_placement`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_placement_term_event_idx` ON `sponsor_placement` (`sponsorship_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `sponsor_placement_event_idx` ON `sponsor_placement` (`event_id`);
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
