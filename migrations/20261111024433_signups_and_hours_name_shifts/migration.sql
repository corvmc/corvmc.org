-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   volunteer_shift_feedback
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
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
ALTER TABLE `work_order` ADD `pending_capacity` integer;
--> statement-breakpoint
CREATE TABLE `__new_volunteer_hour_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`shift_id` text,
	`work_order_id` text,
	`group_id` text,
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
	CONSTRAINT `fk_volunteer_hour_log_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "volunteer_minutes_positive" CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__new_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `work_order_id`, `group_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `work_order_id`, `group_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
--> statement-breakpoint
DROP TABLE `volunteer_hour_log`;
--> statement-breakpoint
ALTER TABLE `__new_volunteer_hour_log` RENAME TO `volunteer_hour_log`;
--> statement-breakpoint
CREATE TABLE `__new_volunteer_signup` (
	`id` text PRIMARY KEY,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`scheduled_starts_at` integer,
	`scheduled_ends_at` integer,
	`invited_at` integer,
	`invited_by_user_id` text,
	`declined_at` integer,
	`claimed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`confirmed_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`notified_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_invited_by_user_id_user_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`)
);
--> statement-breakpoint
INSERT INTO `__new_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `invited_at`, `invited_by_user_id`, `declined_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `notified_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `invited_at`, `invited_by_user_id`, `declined_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `notified_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
--> statement-breakpoint
DROP TABLE `volunteer_signup`;
--> statement-breakpoint
ALTER TABLE `__new_volunteer_signup` RENAME TO `volunteer_signup`;
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_user_idx` ON `volunteer_hour_log` (`user_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_status_idx` ON `volunteer_hour_log` (`status`,`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_worked_on_idx` ON `volunteer_hour_log` (`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_role_idx` ON `volunteer_hour_log` (`volunteer_role_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_work_order_idx` ON `volunteer_hour_log` (`work_order_id`);
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
-- #2518: both tables named the task. Each timed task has exactly one shift here (the
-- prepare migration copied any missing and removed sign-ups on tasks with none), so each
-- old value maps through `volunteer_shift.work_order_id`. Inside the deferred-FK window.
UPDATE `volunteer_signup`
SET `shift_id` = (SELECT `s`.`id` FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `volunteer_signup`.`shift_id`)
WHERE EXISTS (SELECT 1 FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `volunteer_signup`.`shift_id`);
--> statement-breakpoint
UPDATE `volunteer_hour_log`
SET `shift_id` = (SELECT `s`.`id` FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `volunteer_hour_log`.`shift_id`)
WHERE EXISTS (SELECT 1 FROM `volunteer_shift` `s` WHERE `s`.`work_order_id` = `volunteer_hour_log`.`shift_id`);
--> statement-breakpoint
-- A task with no shift keeps the places it asked for (a duty-list window waiting for its
-- time, a recurring occurrence), for the shift opened on it later.
UPDATE `work_order` SET `pending_capacity` = `capacity`
WHERE `starts_at` IS NULL AND (`pending_duration_minutes` IS NOT NULL OR `capacity` > 1);
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
