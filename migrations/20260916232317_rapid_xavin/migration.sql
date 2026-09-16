-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   production_slot, event_band, event_group, ticket, event_rsvp, member_orientation, volunteer_hour_log, volunteer_shift_feedback, volunteer_signup, work_task, work_order, artifact_request, production_expense
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
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
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
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
	CONSTRAINT `fk_production_slot_event_band_id_event_band_id_fk` FOREIGN KEY (`event_band_id`) REFERENCES `event_band`(`id`),
	CONSTRAINT `fk_production_slot_paid_by_user_id_user_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_slot_set_length_positive` CHECK(set_length_minutes > 0),
	CONSTRAINT `production_slot_changeover_nonneg` CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
INSERT INTO `__detach_production_slot`(`id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_name`, `contact_email`, `contact_phone`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_name`, `contact_email`, `contact_phone`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at` FROM `production_slot`;
--> statement-breakpoint
DROP TABLE `production_slot`;
--> statement-breakpoint
ALTER TABLE `__detach_production_slot` RENAME TO `production_slot`;
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;
--> statement-breakpoint
-- detach event_band
CREATE TABLE `__detach_event_band` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`directory_entry_id` text,
	`billing_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`note` text,
	`added_by_group_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_band_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`),
	CONSTRAINT `fk_event_band_directory_entry_id_directory_entry_id_fk` FOREIGN KEY (`directory_entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_added_by_band_id_band_id_fk` FOREIGN KEY (`added_by_group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_event_band`(`id`, `event_id`, `name`, `directory_entry_id`, `billing_order`, `status`, `note`, `added_by_group_id`, `created_at`) SELECT `id`, `event_id`, `name`, `directory_entry_id`, `billing_order`, `status`, `note`, `added_by_group_id`, `created_at` FROM `event_band`;
--> statement-breakpoint
DROP TABLE `event_band`;
--> statement-breakpoint
ALTER TABLE `__detach_event_band` RENAME TO `event_band`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_band_event_band` ON `event_band` (`event_id`,`directory_entry_id`) WHERE directory_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_event_band_band_status` ON `event_band` (`directory_entry_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_event_band_event_order` ON `event_band` (`event_id`,`billing_order`);
--> statement-breakpoint
-- detach event_group
CREATE TABLE `__detach_event_group` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`group_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_group_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`),
	CONSTRAINT `fk_event_group_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_event_group`(`id`, `event_id`, `group_id`, `sort_order`, `created_at`) SELECT `id`, `event_id`, `group_id`, `sort_order`, `created_at` FROM `event_group`;
--> statement-breakpoint
DROP TABLE `event_group`;
--> statement-breakpoint
ALTER TABLE `__detach_event_group` RENAME TO `event_group`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_group_event_group` ON `event_group` (`event_id`,`group_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_group_group` ON `event_group` (`group_id`,`sort_order`);
--> statement-breakpoint
-- detach ticket
CREATE TABLE `__detach_ticket` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_payment_record_id` text,
	`unit_price_cents` integer,
	`contribution_cents` integer DEFAULT 0 NOT NULL,
	`discount_waived` integer DEFAULT false NOT NULL,
	`acts_cents` integer DEFAULT 0 NOT NULL,
	`collective_cents` integer DEFAULT 0 NOT NULL,
	`fee_covered_cents` integer DEFAULT 0 NOT NULL,
	`checked_in_at` integer,
	`checked_in_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `ticket_code_unique` UNIQUE(`code`),
	CONSTRAINT `fk_ticket_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`),
	CONSTRAINT `fk_ticket_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ticket_checked_in_by_user_id_user_id_fk` FOREIGN KEY (`checked_in_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_ticket`(`id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `unit_price_cents`, `contribution_cents`, `discount_waived`, `acts_cents`, `collective_cents`, `fee_covered_cents`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `unit_price_cents`, `contribution_cents`, `discount_waived`, `acts_cents`, `collective_cents`, `fee_covered_cents`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at` FROM `ticket`;
--> statement-breakpoint
DROP TABLE `ticket`;
--> statement-breakpoint
ALTER TABLE `__detach_ticket` RENAME TO `ticket`;
--> statement-breakpoint
CREATE INDEX `idx_ticket_event` ON `ticket` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_purchase` ON `ticket` (`purchase_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_user` ON `ticket` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_event_status` ON `ticket` (`event_id`,`status`);
--> statement-breakpoint
-- detach event_rsvp
CREATE TABLE `__detach_event_rsvp` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_rsvp_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`),
	CONSTRAINT `fk_event_rsvp_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_event_rsvp`(`id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at`) SELECT `id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at` FROM `event_rsvp`;
--> statement-breakpoint
DROP TABLE `event_rsvp`;
--> statement-breakpoint
ALTER TABLE `__detach_event_rsvp` RENAME TO `event_rsvp`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_rsvp_event_user` ON `event_rsvp` (`event_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_rsvp_event` ON `event_rsvp` (`event_id`);
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
-- detach work_order
CREATE TABLE `__detach_work_order` (
	`id` text PRIMARY KEY,
	`volunteer_role_id` text NOT NULL,
	`event_id` text,
	`title` text,
	`starts_at` integer,
	`ends_at` integer,
	`asset_id` text,
	`project_id` text,
	`reservation_id` text,
	`due_at` integer,
	`duty_list_id` text,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`resolution_notes` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_shift_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`),
	CONSTRAINT `fk_volunteer_shift_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_duty_list_id_duty_list_id_fk` FOREIGN KEY (`duty_list_id`) REFERENCES `duty_list`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_cancelled_by_user_id_user_id_fk` FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_resolved_by_user_id_user_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_shift_ends_after_start` CHECK((starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at)),
	CONSTRAINT `volunteer_shift_capacity_positive` CHECK(capacity > 0)
);
--> statement-breakpoint
INSERT INTO `__detach_work_order`(`id`, `volunteer_role_id`, `event_id`, `title`, `starts_at`, `ends_at`, `asset_id`, `project_id`, `reservation_id`, `due_at`, `duty_list_id`, `capacity`, `notes`, `cancelled_at`, `cancelled_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolution_notes`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `volunteer_role_id`, `event_id`, `title`, `starts_at`, `ends_at`, `asset_id`, `project_id`, `reservation_id`, `due_at`, `duty_list_id`, `capacity`, `notes`, `cancelled_at`, `cancelled_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolution_notes`, `created_by_user_id`, `created_at`, `updated_at` FROM `work_order`;
--> statement-breakpoint
DROP TABLE `work_order`;
--> statement-breakpoint
ALTER TABLE `__detach_work_order` RENAME TO `work_order`;
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
CREATE INDEX `work_order_reservation_idx` ON `work_order` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_unscheduled_idx` ON `work_order` (`created_at`) WHERE starts_at is null and resolved_at is null and cancelled_at is null;
--> statement-breakpoint
-- detach artifact_request
CREATE TABLE `__detach_artifact_request` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`artifact` text NOT NULL,
	`due_at` integer,
	`requested_by_user_id` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_artifact_request_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`),
	CONSTRAINT `fk_artifact_request_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifact_request_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_artifact_request`(`id`, `event_id`, `entry_id`, `artifact`, `due_at`, `requested_by_user_id`, `requested_at`, `cancelled_at`, `created_at`) SELECT `id`, `event_id`, `entry_id`, `artifact`, `due_at`, `requested_by_user_id`, `requested_at`, `cancelled_at`, `created_at` FROM `artifact_request`;
--> statement-breakpoint
DROP TABLE `artifact_request`;
--> statement-breakpoint
ALTER TABLE `__detach_artifact_request` RENAME TO `artifact_request`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_artifact_request_live` ON `artifact_request` (`event_id`,`entry_id`,`artifact`);
--> statement-breakpoint
CREATE INDEX `idx_artifact_request_event` ON `artifact_request` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_artifact_request_due` ON `artifact_request` (`due_at`);
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
CREATE TABLE `__new_event_listing` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`doors_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`announce_at` integer,
	`reservation_id` text,
	`poster_key` text,
	`tags` text,
	`ticketing_enabled` integer DEFAULT false NOT NULL,
	`ticket_price` integer,
	`ticket_price_floor_cents` integer DEFAULT 0 NOT NULL,
	`ticket_quantity` integer,
	`production_id` text,
	`group_id` text,
	`project_id` text,
	`source` text DEFAULT 'cmc' NOT NULL,
	`kind` text DEFAULT 'show' NOT NULL,
	`location` text,
	`venue_id` text,
	`external_ticket_url` text,
	`recurring_series_id` text,
	`review_notes` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`),
	CONSTRAINT `fk_event_listing_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_band_id_band_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_venue_id_venue_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_recurring_series_id_recurring_series_id_fk` FOREIGN KEY (`recurring_series_id`) REFERENCES `recurring_series`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "event_time_order" CHECK(ends_at > starts_at),
	CONSTRAINT "event_cmc_needs_end" CHECK(source != 'cmc' OR ends_at IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_event_listing`(`id`, `title`, `description`, `starts_at`, `ends_at`, `doors_at`, `status`, `published_at`, `announce_at`, `reservation_id`, `poster_key`, `tags`, `ticketing_enabled`, `ticket_price`, `ticket_price_floor_cents`, `ticket_quantity`, `production_id`, `group_id`, `project_id`, `source`, `kind`, `location`, `venue_id`, `external_ticket_url`, `recurring_series_id`, `review_notes`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `title`, `description`, `starts_at`, `ends_at`, `doors_at`, `status`, `published_at`, `announce_at`, `reservation_id`, `poster_key`, `tags`, `ticketing_enabled`, `ticket_price`, `ticket_price_floor_cents`, `ticket_quantity`, `production_id`, `group_id`, `project_id`, `source`, `kind`, `location`, `venue_id`, `external_ticket_url`, `recurring_series_id`, `review_notes`, `created_by_user_id`, `created_at`, `updated_at` FROM `event_listing`;
--> statement-breakpoint
DROP TABLE `event_listing`;
--> statement-breakpoint
ALTER TABLE `__new_event_listing` RENAME TO `event_listing`;
--> statement-breakpoint
CREATE TABLE `__new_production` (
	`id` text PRIMARY KEY,
	`status` text DEFAULT 'draft' NOT NULL,
	`producer_user_id` text,
	`load_in_at` integer,
	`soundcheck_at` integer,
	`first_set_at` integer,
	`curfew_at` integer,
	`load_out_by` integer,
	`billing_notes` text,
	`hospitality_notes` text,
	`internal_notes` text,
	`created_by_user_id` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_producer_user_id_user_id_fk` FOREIGN KEY (`producer_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_closed_by_user_id_user_id_fk` FOREIGN KEY (`closed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "production_curfew_after_first_set" CHECK(curfew_at is null or first_set_at is null or curfew_at > first_set_at)
);
--> statement-breakpoint
INSERT INTO `__new_production`(`id`, `status`, `producer_user_id`, `load_in_at`, `soundcheck_at`, `first_set_at`, `curfew_at`, `load_out_by`, `billing_notes`, `hospitality_notes`, `internal_notes`, `created_by_user_id`, `closed_at`, `closed_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `status`, `producer_user_id`, `load_in_at`, `soundcheck_at`, `first_set_at`, `curfew_at`, `load_out_by`, `billing_notes`, `hospitality_notes`, `internal_notes`, `created_by_user_id`, `closed_at`, `closed_by_user_id`, `created_at`, `updated_at` FROM `production`;
--> statement-breakpoint
DROP TABLE `production`;
--> statement-breakpoint
ALTER TABLE `__new_production` RENAME TO `production`;
--> statement-breakpoint
DROP INDEX IF EXISTS `uq_production_event`;
--> statement-breakpoint
CREATE INDEX `idx_event_status_starts` ON `event_listing` (`status`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_event_reservation` ON `event_listing` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_band` ON `event_listing` (`group_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_source` ON `event_listing` (`source`,`status`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_event_recurring_series` ON `event_listing` (`recurring_series_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_production` ON `event_listing` (`production_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_project` ON `event_listing` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_venue` ON `event_listing` (`venue_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_recurring_instance` ON `event_listing` (`recurring_series_id`,`starts_at`) WHERE recurring_series_id IS NOT NULL AND status != 'cancelled';
--> statement-breakpoint
CREATE INDEX `idx_production_status` ON `production` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_production_producer` ON `production` (`producer_user_id`);
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
-- reattach artifact_request
CREATE TABLE `__reattach_artifact_request` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`artifact` text NOT NULL,
	`due_at` integer,
	`requested_by_user_id` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_artifact_request_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifact_request_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifact_request_requested_by_user_id_user_id_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_artifact_request`(`id`, `event_id`, `entry_id`, `artifact`, `due_at`, `requested_by_user_id`, `requested_at`, `cancelled_at`, `created_at`) SELECT `id`, `event_id`, `entry_id`, `artifact`, `due_at`, `requested_by_user_id`, `requested_at`, `cancelled_at`, `created_at` FROM `artifact_request`;
--> statement-breakpoint
DROP TABLE `artifact_request`;
--> statement-breakpoint
ALTER TABLE `__reattach_artifact_request` RENAME TO `artifact_request`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_artifact_request_live` ON `artifact_request` (`event_id`,`entry_id`,`artifact`);
--> statement-breakpoint
CREATE INDEX `idx_artifact_request_event` ON `artifact_request` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_artifact_request_due` ON `artifact_request` (`due_at`);
--> statement-breakpoint
-- reattach work_order
CREATE TABLE `__reattach_work_order` (
	`id` text PRIMARY KEY,
	`volunteer_role_id` text NOT NULL,
	`event_id` text,
	`title` text,
	`starts_at` integer,
	`ends_at` integer,
	`asset_id` text,
	`project_id` text,
	`reservation_id` text,
	`due_at` integer,
	`duty_list_id` text,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`resolution_notes` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_shift_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_work_order_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_duty_list_id_duty_list_id_fk` FOREIGN KEY (`duty_list_id`) REFERENCES `duty_list`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_cancelled_by_user_id_user_id_fk` FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_resolved_by_user_id_user_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_shift_ends_after_start` CHECK((starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at)),
	CONSTRAINT `volunteer_shift_capacity_positive` CHECK(capacity > 0)
);
--> statement-breakpoint
INSERT INTO `__reattach_work_order`(`id`, `volunteer_role_id`, `event_id`, `title`, `starts_at`, `ends_at`, `asset_id`, `project_id`, `reservation_id`, `due_at`, `duty_list_id`, `capacity`, `notes`, `cancelled_at`, `cancelled_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolution_notes`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `volunteer_role_id`, `event_id`, `title`, `starts_at`, `ends_at`, `asset_id`, `project_id`, `reservation_id`, `due_at`, `duty_list_id`, `capacity`, `notes`, `cancelled_at`, `cancelled_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolution_notes`, `created_by_user_id`, `created_at`, `updated_at` FROM `work_order`;
--> statement-breakpoint
DROP TABLE `work_order`;
--> statement-breakpoint
ALTER TABLE `__reattach_work_order` RENAME TO `work_order`;
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
CREATE INDEX `work_order_reservation_idx` ON `work_order` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_unscheduled_idx` ON `work_order` (`created_at`) WHERE starts_at is null and resolved_at is null and cancelled_at is null;
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
-- reattach event_rsvp
CREATE TABLE `__reattach_event_rsvp` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_rsvp_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_rsvp_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_event_rsvp`(`id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at`) SELECT `id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at` FROM `event_rsvp`;
--> statement-breakpoint
DROP TABLE `event_rsvp`;
--> statement-breakpoint
ALTER TABLE `__reattach_event_rsvp` RENAME TO `event_rsvp`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_rsvp_event_user` ON `event_rsvp` (`event_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_rsvp_event` ON `event_rsvp` (`event_id`);
--> statement-breakpoint
-- reattach ticket
CREATE TABLE `__reattach_ticket` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_payment_record_id` text,
	`unit_price_cents` integer,
	`contribution_cents` integer DEFAULT 0 NOT NULL,
	`discount_waived` integer DEFAULT false NOT NULL,
	`acts_cents` integer DEFAULT 0 NOT NULL,
	`collective_cents` integer DEFAULT 0 NOT NULL,
	`fee_covered_cents` integer DEFAULT 0 NOT NULL,
	`checked_in_at` integer,
	`checked_in_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `ticket_code_unique` UNIQUE(`code`),
	CONSTRAINT `fk_ticket_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ticket_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ticket_checked_in_by_user_id_user_id_fk` FOREIGN KEY (`checked_in_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_ticket`(`id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `unit_price_cents`, `contribution_cents`, `discount_waived`, `acts_cents`, `collective_cents`, `fee_covered_cents`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `unit_price_cents`, `contribution_cents`, `discount_waived`, `acts_cents`, `collective_cents`, `fee_covered_cents`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at` FROM `ticket`;
--> statement-breakpoint
DROP TABLE `ticket`;
--> statement-breakpoint
ALTER TABLE `__reattach_ticket` RENAME TO `ticket`;
--> statement-breakpoint
CREATE INDEX `idx_ticket_event` ON `ticket` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_purchase` ON `ticket` (`purchase_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_user` ON `ticket` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_event_status` ON `ticket` (`event_id`,`status`);
--> statement-breakpoint
-- reattach event_group
CREATE TABLE `__reattach_event_group` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`group_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_group_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_group_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_event_group`(`id`, `event_id`, `group_id`, `sort_order`, `created_at`) SELECT `id`, `event_id`, `group_id`, `sort_order`, `created_at` FROM `event_group`;
--> statement-breakpoint
DROP TABLE `event_group`;
--> statement-breakpoint
ALTER TABLE `__reattach_event_group` RENAME TO `event_group`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_group_event_group` ON `event_group` (`event_id`,`group_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_group_group` ON `event_group` (`group_id`,`sort_order`);
--> statement-breakpoint
-- reattach event_band
CREATE TABLE `__reattach_event_band` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`directory_entry_id` text,
	`billing_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`note` text,
	`added_by_group_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_band_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_directory_entry_id_directory_entry_id_fk` FOREIGN KEY (`directory_entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_added_by_band_id_band_id_fk` FOREIGN KEY (`added_by_group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_event_band`(`id`, `event_id`, `name`, `directory_entry_id`, `billing_order`, `status`, `note`, `added_by_group_id`, `created_at`) SELECT `id`, `event_id`, `name`, `directory_entry_id`, `billing_order`, `status`, `note`, `added_by_group_id`, `created_at` FROM `event_band`;
--> statement-breakpoint
DROP TABLE `event_band`;
--> statement-breakpoint
ALTER TABLE `__reattach_event_band` RENAME TO `event_band`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_band_event_band` ON `event_band` (`event_id`,`directory_entry_id`) WHERE directory_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_event_band_band_status` ON `event_band` (`directory_entry_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_event_band_event_order` ON `event_band` (`event_id`,`billing_order`);
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
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
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
	CONSTRAINT `fk_production_slot_paid_by_user_id_user_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_slot_set_length_positive` CHECK(set_length_minutes > 0),
	CONSTRAINT `production_slot_changeover_nonneg` CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
INSERT INTO `__reattach_production_slot`(`id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_name`, `contact_email`, `contact_phone`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_name`, `contact_email`, `contact_phone`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at` FROM `production_slot`;
--> statement-breakpoint
DROP TABLE `production_slot`;
--> statement-breakpoint
ALTER TABLE `__reattach_production_slot` RENAME TO `production_slot`;
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
