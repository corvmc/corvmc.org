CREATE TABLE `calendar_source` (
	`id` text PRIMARY KEY,
	`venue_id` text NOT NULL,
	`url` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`last_fetched_at` integer,
	`last_error` text,
	`last_imported_count` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_calendar_source_venue_id_venue_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_source_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `event_listing` ADD `import_source_id` text REFERENCES calendar_source(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event_listing` ADD `import_uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_calendar_source_url` ON `calendar_source` (`url`);--> statement-breakpoint
CREATE INDEX `idx_calendar_source_venue` ON `calendar_source` (`venue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_import_uid` ON `event_listing` (`import_source_id`,`import_uid`) WHERE import_source_id IS NOT NULL AND import_uid IS NOT NULL;