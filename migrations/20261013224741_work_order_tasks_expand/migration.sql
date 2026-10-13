-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   member_orientation, volunteer_hour_log, volunteer_shift_feedback, volunteer_signup, work_task
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- detach member_orientation
CREATE TABLE `__detach_member_orientation` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`work_order_id` text,
	`reservation_id` text,
	`scheduled_for` integer,
	`completed_at` integer,
	`completed_by_user_id` text,
	`waived_at` integer,
	`waived_reason` text,
	`waived_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `member_orientation_user_id_unique` UNIQUE(`user_id`),
	CONSTRAINT `fk_member_orientation_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_orientation_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`),
	CONSTRAINT `fk_member_orientation_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_completed_by_user_id_user_id_fk` FOREIGN KEY (`completed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_waived_by_user_id_user_id_fk` FOREIGN KEY (`waived_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `member_orientation_waived_has_reason` CHECK((waived_at is null) = (waived_reason is null))
);
--> statement-breakpoint
INSERT INTO `__detach_member_orientation`(`id`, `user_id`, `work_order_id`, `reservation_id`, `scheduled_for`, `completed_at`, `completed_by_user_id`, `waived_at`, `waived_reason`, `waived_by_user_id`, `notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `work_order_id`, `reservation_id`, `scheduled_for`, `completed_at`, `completed_by_user_id`, `waived_at`, `waived_reason`, `waived_by_user_id`, `notes`, `created_at`, `updated_at` FROM `member_orientation`;
--> statement-breakpoint
DROP TABLE `member_orientation`;
--> statement-breakpoint
ALTER TABLE `__detach_member_orientation` RENAME TO `member_orientation`;
--> statement-breakpoint
CREATE INDEX `member_orientation_scheduled_idx` ON `member_orientation` (`scheduled_for`) WHERE completed_at is null;
--> statement-breakpoint
-- detach volunteer_hour_log
CREATE TABLE `__detach_volunteer_hour_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`shift_id` text,
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
	CONSTRAINT `fk_volunteer_hour_log_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `work_order`(`id`),
	CONSTRAINT `fk_volunteer_hour_log_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_minutes_positive` CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `group_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `group_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
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
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`),
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `work_order`(`id`),
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_invited_by_user_id_user_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `invited_at`, `invited_by_user_id`, `declined_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `notified_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `invited_at`, `invited_by_user_id`, `declined_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `notified_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
--> statement-breakpoint
DROP TABLE `volunteer_signup`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_signup` RENAME TO `volunteer_signup`;
--> statement-breakpoint
CREATE INDEX `volunteer_signup_shift_idx` ON `volunteer_signup` (`shift_id`,`status`);
--> statement-breakpoint
CREATE INDEX `volunteer_signup_user_idx` ON `volunteer_signup` (`user_id`,`status`);
--> statement-breakpoint
-- detach work_task
CREATE TABLE `__detach_work_task` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`done_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_task_work_order_id_volunteer_shift_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`),
	CONSTRAINT `fk_work_task_done_by_user_id_user_id_fk` FOREIGN KEY (`done_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `work_task_done_has_time` CHECK((done = 0 and done_at is null) or (done = 1 and done_at is not null))
);
--> statement-breakpoint
INSERT INTO `__detach_work_task`(`id`, `work_order_id`, `label`, `sort_order`, `done`, `done_at`, `done_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `work_order_id`, `label`, `sort_order`, `done`, `done_at`, `done_by_user_id`, `created_at`, `updated_at` FROM `work_task`;
--> statement-breakpoint
DROP TABLE `work_task`;
--> statement-breakpoint
ALTER TABLE `__detach_work_task` RENAME TO `work_task`;
--> statement-breakpoint
CREATE INDEX `work_task_order_idx` ON `work_task` (`work_order_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `project_section` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_project_section_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `duty_list_item` ADD `section` text;
--> statement-breakpoint
ALTER TABLE `work_order` ADD `posted_at` integer;
--> statement-breakpoint
ALTER TABLE `work_order` ADD `posted_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `work_order` ADD `section_id` text REFERENCES project_section(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `work_order` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_work_order` (
	`id` text PRIMARY KEY,
	`volunteer_role_id` text,
	`posted_at` integer,
	`posted_by_user_id` text,
	`event_id` text,
	`title` text,
	`starts_at` integer,
	`ends_at` integer,
	`asset_id` text,
	`project_id` text,
	`reservation_id` text,
	`due_at` integer,
	`section_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`duty_list_id` text,
	`maintenance_schedule_id` text,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`resolution_notes` text,
	`close_reports_on_completion` integer DEFAULT false NOT NULL,
	`group_id` text,
	`done_when` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_work_order_posted_by_user_id_user_id_fk` FOREIGN KEY (`posted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_section_id_project_section_id_fk` FOREIGN KEY (`section_id`) REFERENCES `project_section`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_duty_list_id_duty_list_id_fk` FOREIGN KEY (`duty_list_id`) REFERENCES `duty_list`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_maintenance_schedule_id_maintenance_schedule_id_fk` FOREIGN KEY (`maintenance_schedule_id`) REFERENCES `maintenance_schedule`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_cancelled_by_user_id_user_id_fk` FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_resolved_by_user_id_user_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "volunteer_shift_ends_after_start" CHECK((starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at)),
	CONSTRAINT "volunteer_shift_capacity_positive" CHECK(capacity > 0),
	CONSTRAINT "work_order_posted_has_role" CHECK(posted_at is null or volunteer_role_id is not null)
);
--> statement-breakpoint
INSERT INTO `__new_work_order`(`id`, `volunteer_role_id`, `event_id`, `title`, `starts_at`, `ends_at`, `asset_id`, `project_id`, `reservation_id`, `due_at`, `duty_list_id`, `maintenance_schedule_id`, `capacity`, `notes`, `cancelled_at`, `cancelled_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolution_notes`, `close_reports_on_completion`, `group_id`, `done_when`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `volunteer_role_id`, `event_id`, `title`, `starts_at`, `ends_at`, `asset_id`, `project_id`, `reservation_id`, `due_at`, `duty_list_id`, `maintenance_schedule_id`, `capacity`, `notes`, `cancelled_at`, `cancelled_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolution_notes`, `close_reports_on_completion`, `group_id`, `done_when`, `created_by_user_id`, `created_at`, `updated_at` FROM `work_order`;
--> statement-breakpoint
DROP TABLE `work_order`;
--> statement-breakpoint
ALTER TABLE `__new_work_order` RENAME TO `work_order`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_upcoming_idx` ON `work_order` (`starts_at`) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_role_idx` ON `work_order` (`volunteer_role_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_event_idx` ON `work_order` (`event_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_asset_idx` ON `work_order` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `work_order_project_idx` ON `work_order` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_open_occurrence` ON `work_order` (`maintenance_schedule_id`) WHERE maintenance_schedule_id is not null and resolved_at is null and cancelled_at is null;
--> statement-breakpoint
CREATE INDEX `work_order_reservation_idx` ON `work_order` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `work_order_group_open_idx` ON `work_order` (`group_id`,`due_at`) WHERE group_id is not null and resolved_at is null and cancelled_at is null;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_unscheduled_idx` ON `work_order` (`created_at`) WHERE starts_at is null and resolved_at is null and cancelled_at is null;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_section_name` ON `project_section` (`project_id`,`name`);
--> statement-breakpoint
-- reattach work_task
CREATE TABLE `__reattach_work_task` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`done_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_task_work_order_id_volunteer_shift_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_task_done_by_user_id_user_id_fk` FOREIGN KEY (`done_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `work_task_done_has_time` CHECK((done = 0 and done_at is null) or (done = 1 and done_at is not null))
);
--> statement-breakpoint
INSERT INTO `__reattach_work_task`(`id`, `work_order_id`, `label`, `sort_order`, `done`, `done_at`, `done_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `work_order_id`, `label`, `sort_order`, `done`, `done_at`, `done_by_user_id`, `created_at`, `updated_at` FROM `work_task`;
--> statement-breakpoint
DROP TABLE `work_task`;
--> statement-breakpoint
ALTER TABLE `__reattach_work_task` RENAME TO `work_task`;
--> statement-breakpoint
CREATE INDEX `work_task_order_idx` ON `work_task` (`work_order_id`,`sort_order`);
--> statement-breakpoint
-- reattach volunteer_signup
CREATE TABLE `__reattach_volunteer_signup` (
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
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`),
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_invited_by_user_id_user_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `invited_at`, `invited_by_user_id`, `declined_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `notified_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `scheduled_starts_at`, `scheduled_ends_at`, `invited_at`, `invited_by_user_id`, `declined_at`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `notified_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
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
	CONSTRAINT `fk_volunteer_hour_log_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `work_order`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_minutes_positive` CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `group_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `group_id`, `worked_on`, `minutes`, `started_at`, `ended_at`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
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
-- reattach member_orientation
CREATE TABLE `__reattach_member_orientation` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`work_order_id` text,
	`reservation_id` text,
	`scheduled_for` integer,
	`completed_at` integer,
	`completed_by_user_id` text,
	`waived_at` integer,
	`waived_reason` text,
	`waived_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `member_orientation_user_id_unique` UNIQUE(`user_id`),
	CONSTRAINT `fk_member_orientation_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_orientation_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_completed_by_user_id_user_id_fk` FOREIGN KEY (`completed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_waived_by_user_id_user_id_fk` FOREIGN KEY (`waived_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `member_orientation_waived_has_reason` CHECK((waived_at is null) = (waived_reason is null))
);
--> statement-breakpoint
INSERT INTO `__reattach_member_orientation`(`id`, `user_id`, `work_order_id`, `reservation_id`, `scheduled_for`, `completed_at`, `completed_by_user_id`, `waived_at`, `waived_reason`, `waived_by_user_id`, `notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `work_order_id`, `reservation_id`, `scheduled_for`, `completed_at`, `completed_by_user_id`, `waived_at`, `waived_reason`, `waived_by_user_id`, `notes`, `created_at`, `updated_at` FROM `member_orientation`;
--> statement-breakpoint
DROP TABLE `member_orientation`;
--> statement-breakpoint
ALTER TABLE `__reattach_member_orientation` RENAME TO `member_orientation`;
--> statement-breakpoint
CREATE INDEX `member_orientation_scheduled_idx` ON `member_orientation` (`scheduled_for`) WHERE completed_at is null;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
