CREATE TABLE `production` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
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
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_producer_user_id_user_id_fk` FOREIGN KEY (`producer_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "production_curfew_after_first_set" CHECK(curfew_at is null or first_set_at is null or curfew_at > first_set_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_event` ON `production` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_production_status` ON `production` (`status`);--> statement-breakpoint
CREATE INDEX `idx_production_producer` ON `production` (`producer_user_id`);