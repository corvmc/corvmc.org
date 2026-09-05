CREATE TABLE `lock_fallback_code` (
	`id` text PRIMARY KEY,
	`code` text NOT NULL,
	`lock_access_id` text,
	`synced_at` integer,
	`retired_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `reservation` ADD `lock_fallback_revealed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_lock_fallback_active` ON `lock_fallback_code` (`retired_at`,`synced_at`);