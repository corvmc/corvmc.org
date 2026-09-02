CREATE TABLE `asset_flag` (
	`id` text PRIMARY KEY,
	`asset_id` text NOT NULL,
	`reported_by_user_id` text,
	`note` text NOT NULL,
	`condition` text,
	`blocks_use` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_by_user_id` text,
	`resolution_notes` text,
	`resolved_at` integer,
	`work_order_id` text,
	`loan_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_asset_flag_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_asset_flag_reported_by_user_id_user_id_fk` FOREIGN KEY (`reported_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_asset_flag_resolved_by_user_id_user_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_asset_flag_loan_id_inventory_loan_id_fk` FOREIGN KEY (`loan_id`) REFERENCES `inventory_loan`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `volunteer_hour_log` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `volunteer_hour_log` ADD `ended_at` integer;--> statement-breakpoint
ALTER TABLE `volunteer_signup` ADD `scheduled_starts_at` integer;--> statement-breakpoint
ALTER TABLE `volunteer_signup` ADD `scheduled_ends_at` integer;--> statement-breakpoint
CREATE INDEX `idx_asset_flag_status` ON `asset_flag` (`status`);--> statement-breakpoint
CREATE INDEX `idx_asset_flag_asset` ON `asset_flag` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_flag_open_blocking` ON `asset_flag` (`asset_id`) WHERE status = 'pending' and blocks_use = 1;--> statement-breakpoint
CREATE INDEX `idx_asset_flag_work_order` ON `asset_flag` (`work_order_id`) WHERE work_order_id is not null;