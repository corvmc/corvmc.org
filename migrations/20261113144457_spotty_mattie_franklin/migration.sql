CREATE TABLE `event_attendance` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`marked_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_attendance_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_attendance_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_attendance_marked_by_user_id_user_id_fk` FOREIGN KEY (`marked_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_attendance_event_user` ON `event_attendance` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_event_attendance_user` ON `event_attendance` (`user_id`);