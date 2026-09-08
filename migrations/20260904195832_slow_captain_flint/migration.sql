CREATE TABLE `venue` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`address1` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`capacity` integer,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`load_in_notes` text,
	`notes` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "venue_capacity_positive" CHECK(capacity is null or capacity > 0)
);
--> statement-breakpoint
ALTER TABLE `event` ADD `venue_id` text REFERENCES venue(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `venue_slug_idx` ON `venue` (`slug`);--> statement-breakpoint
CREATE INDEX `venue_name_idx` ON `venue` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `venue_one_primary_idx` ON `venue` (`is_primary`) WHERE is_primary = 1;--> statement-breakpoint
CREATE INDEX `idx_event_venue` ON `event` (`venue_id`);