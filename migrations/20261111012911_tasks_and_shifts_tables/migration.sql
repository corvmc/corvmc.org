CREATE TABLE `volunteer_shift` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer DEFAULT 1 NOT NULL,
	`anchor` text,
	`notes` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_shift_cancelled_by_user_id_user_id_fk` FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "volunteer_shift_end_after_start" CHECK(ends_at > starts_at),
	CONSTRAINT "volunteer_shift_places_positive" CHECK(capacity > 0)
);
--> statement-breakpoint
CREATE TABLE `work_order_assignee` (
	`work_order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`assigned_by_user_id` text,
	`assigned_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	CONSTRAINT `work_order_assignee_pk` PRIMARY KEY(`work_order_id`, `user_id`),
	CONSTRAINT `fk_work_order_assignee_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_assignee_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_assignee_assigned_by_user_id_user_id_fk` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `volunteer_hour_log` ADD `work_order_id` text REFERENCES work_order(id) ON DELETE SET NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `volunteer_shift_upcoming_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `volunteer_shift_role_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `volunteer_shift_event_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `volunteer_shift_asset_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `volunteer_shift_unscheduled_idx`;--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_work_order_idx` ON `volunteer_hour_log` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `volunteer_shift_upcoming_idx` ON `volunteer_shift` (`starts_at`) WHERE cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX `volunteer_shift_work_order_idx` ON `volunteer_shift` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `work_order_upcoming_idx` ON `work_order` (`starts_at`) WHERE cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX `work_order_role_idx` ON `work_order` (`volunteer_role_id`);--> statement-breakpoint
CREATE INDEX `work_order_event_idx` ON `work_order` (`event_id`);--> statement-breakpoint
CREATE INDEX `work_order_asset_idx` ON `work_order` (`asset_id`);--> statement-breakpoint
CREATE INDEX `work_order_unscheduled_idx` ON `work_order` (`created_at`) WHERE starts_at is null and resolved_at is null and cancelled_at is null;--> statement-breakpoint
CREATE INDEX `work_order_assignee_user_idx` ON `work_order_assignee` (`user_id`);