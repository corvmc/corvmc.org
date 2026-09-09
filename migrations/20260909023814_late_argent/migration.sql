CREATE TABLE `artifact_request` (
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
CREATE UNIQUE INDEX `uq_artifact_request_live` ON `artifact_request` (`event_id`,`entry_id`,`artifact`);--> statement-breakpoint
CREATE INDEX `idx_artifact_request_event` ON `artifact_request` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_request_due` ON `artifact_request` (`due_at`);