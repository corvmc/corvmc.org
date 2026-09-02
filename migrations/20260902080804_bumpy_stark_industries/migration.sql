-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   volunteer_hour_log, volunteer_shift_feedback, volunteer_signup
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- detach volunteer_hour_log
CREATE TABLE `__detach_volunteer_hour_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`shift_id` text,
	`worked_on` integer NOT NULL,
	`minutes` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`review_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_hour_log_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_hour_log_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_hour_log_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`),
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_minutes_positive` CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
--> statement-breakpoint
DROP TABLE `volunteer_hour_log`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_hour_log` RENAME TO `volunteer_hour_log`;
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_user_idx` ON `volunteer_hour_log` (`user_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_status_idx` ON `volunteer_hour_log` (`status`,`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_worked_on_idx` ON `volunteer_hour_log` (`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_role_idx` ON `volunteer_hour_log` (`volunteer_role_id`);
--> statement-breakpoint
-- detach volunteer_shift_feedback
CREATE TABLE `__detach_volunteer_shift_feedback` (
	`id` text PRIMARY KEY,
	`signup_id` text NOT NULL,
	`rating` integer NOT NULL,
	`was_set_up` integer NOT NULL,
	`comment` text,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `volunteer_shift_feedback_signup_id_unique` UNIQUE(`signup_id`),
	CONSTRAINT `fk_volunteer_shift_feedback_signup_id_volunteer_signup_id_fk` FOREIGN KEY (`signup_id`) REFERENCES `volunteer_signup`(`id`),
	CONSTRAINT `volunteer_shift_feedback_rating_range` CHECK(rating >= 1 AND rating <= 5)
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_shift_feedback`(`id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at`) SELECT `id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at` FROM `volunteer_shift_feedback`;
--> statement-breakpoint
DROP TABLE `volunteer_shift_feedback`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_shift_feedback` RENAME TO `volunteer_shift_feedback`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_feedback_submitted_idx` ON `volunteer_shift_feedback` (`submitted_at`);
--> statement-breakpoint
-- detach volunteer_signup
CREATE TABLE `__detach_volunteer_signup` (
	`id` text PRIMARY KEY,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`scheduled_starts_at` integer,
	`scheduled_ends_at` integer,
	`claimed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`confirmed_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`),
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`),
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
--> statement-breakpoint
DROP TABLE `volunteer_signup`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_signup` RENAME TO `volunteer_signup`;
--> statement-breakpoint
CREATE INDEX `volunteer_signup_shift_idx` ON `volunteer_signup` (`shift_id`,`status`);
--> statement-breakpoint
CREATE INDEX `volunteer_signup_user_idx` ON `volunteer_signup` (`user_id`,`status`);
--> statement-breakpoint
ALTER TABLE `volunteer_shift` ADD `asset_id` text REFERENCES inventory_asset(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `volunteer_shift` ADD `due_at` integer;
--> statement-breakpoint
ALTER TABLE `volunteer_shift` ADD `resolved_at` integer;
--> statement-breakpoint
ALTER TABLE `volunteer_shift` ADD `resolved_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `volunteer_shift` ADD `resolution_notes` text;
--> statement-breakpoint
CREATE TABLE `__new_volunteer_shift` (
	`id` text PRIMARY KEY,
	`volunteer_role_id` text NOT NULL,
	`event_id` text,
	`starts_at` integer,
	`ends_at` integer,
	`asset_id` text,
	`due_at` integer,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`cancelled_at` integer,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`resolution_notes` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_shift_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_resolved_by_user_id_user_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "volunteer_shift_ends_after_start" CHECK((starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at)),
	CONSTRAINT "volunteer_shift_capacity_positive" CHECK(capacity > 0)
);
--> statement-breakpoint
INSERT INTO `__new_volunteer_shift`(`id`, `volunteer_role_id`, `event_id`, `starts_at`, `ends_at`, `capacity`, `notes`, `cancelled_at`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `volunteer_role_id`, `event_id`, `starts_at`, `ends_at`, `capacity`, `notes`, `cancelled_at`, `created_by_user_id`, `created_at`, `updated_at` FROM `volunteer_shift`;
--> statement-breakpoint
DROP TABLE `volunteer_shift`;
--> statement-breakpoint
ALTER TABLE `__new_volunteer_shift` RENAME TO `volunteer_shift`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_upcoming_idx` ON `volunteer_shift` (`starts_at`) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_role_idx` ON `volunteer_shift` (`volunteer_role_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_event_idx` ON `volunteer_shift` (`event_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_asset_idx` ON `volunteer_shift` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_unscheduled_idx` ON `volunteer_shift` (`created_at`) WHERE starts_at is null and resolved_at is null and cancelled_at is null;
--> statement-breakpoint
-- reattach volunteer_signup
CREATE TABLE `__reattach_volunteer_signup` (
	`id` text PRIMARY KEY,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`scheduled_starts_at` integer,
	`scheduled_ends_at` integer,
	`claimed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`confirmed_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`),
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
--> statement-breakpoint
DROP TABLE `volunteer_signup`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_signup` RENAME TO `volunteer_signup`;
--> statement-breakpoint
CREATE INDEX `volunteer_signup_shift_idx` ON `volunteer_signup` (`shift_id`,`status`);
--> statement-breakpoint
CREATE INDEX `volunteer_signup_user_idx` ON `volunteer_signup` (`user_id`,`status`);
--> statement-breakpoint
-- reattach volunteer_shift_feedback
CREATE TABLE `__reattach_volunteer_shift_feedback` (
	`id` text PRIMARY KEY,
	`signup_id` text NOT NULL,
	`rating` integer NOT NULL,
	`was_set_up` integer NOT NULL,
	`comment` text,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `volunteer_shift_feedback_signup_id_unique` UNIQUE(`signup_id`),
	CONSTRAINT `fk_volunteer_shift_feedback_signup_id_volunteer_signup_id_fk` FOREIGN KEY (`signup_id`) REFERENCES `volunteer_signup`(`id`) ON DELETE CASCADE,
	CONSTRAINT `volunteer_shift_feedback_rating_range` CHECK(rating >= 1 AND rating <= 5)
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_shift_feedback`(`id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at`) SELECT `id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at` FROM `volunteer_shift_feedback`;
--> statement-breakpoint
DROP TABLE `volunteer_shift_feedback`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_shift_feedback` RENAME TO `volunteer_shift_feedback`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_feedback_submitted_idx` ON `volunteer_shift_feedback` (`submitted_at`);
--> statement-breakpoint
-- reattach volunteer_hour_log
CREATE TABLE `__reattach_volunteer_hour_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`shift_id` text,
	`worked_on` integer NOT NULL,
	`minutes` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`review_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_hour_log_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_hour_log_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_hour_log_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_minutes_positive` CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
--> statement-breakpoint
DROP TABLE `volunteer_hour_log`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_hour_log` RENAME TO `volunteer_hour_log`;
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_user_idx` ON `volunteer_hour_log` (`user_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_status_idx` ON `volunteer_hour_log` (`status`,`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_worked_on_idx` ON `volunteer_hour_log` (`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_role_idx` ON `volunteer_hour_log` (`volunteer_role_id`);
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
