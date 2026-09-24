CREATE TABLE `market_day` (
	`event_id` text PRIMARY KEY,
	`applications_close_at` integer,
	`table_count` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_market_day_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `market_vendor` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`thread_id` text,
	`business_name` text NOT NULL,
	`offering` text NOT NULL,
	`website` text,
	`tables_requested` integer DEFAULT 1 NOT NULL,
	`needs_power` integer DEFAULT false NOT NULL,
	`notes` text,
	`status` text DEFAULT 'applied' NOT NULL,
	`table_label` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_market_vendor_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_market_vendor_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_market_vendor_decided_by_user_id_user_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_vendor_event_status` ON `market_vendor` (`event_id`,`status`);