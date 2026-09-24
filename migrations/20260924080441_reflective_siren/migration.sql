ALTER TABLE `work_request` ADD `location` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_request` (
	`id` text PRIMARY KEY,
	`asset_id` text,
	`location` text,
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
	CONSTRAINT `fk_asset_flag_loan_id_inventory_loan_id_fk` FOREIGN KEY (`loan_id`) REFERENCES `inventory_loan`(`id`) ON DELETE SET NULL,
	CONSTRAINT "work_request_has_subject" CHECK(asset_id is not null or location is not null)
);
--> statement-breakpoint
INSERT INTO `__new_work_request`(`id`, `asset_id`, `reported_by_user_id`, `note`, `condition`, `blocks_use`, `status`, `resolved_by_user_id`, `resolution_notes`, `resolved_at`, `work_order_id`, `loan_id`, `created_at`, `updated_at`) SELECT `id`, `asset_id`, `reported_by_user_id`, `note`, `condition`, `blocks_use`, `status`, `resolved_by_user_id`, `resolution_notes`, `resolved_at`, `work_order_id`, `loan_id`, `created_at`, `updated_at` FROM `work_request`;--> statement-breakpoint
DROP TABLE `work_request`;--> statement-breakpoint
ALTER TABLE `__new_work_request` RENAME TO `work_request`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_asset_flag_status` ON `work_request` (`status`);--> statement-breakpoint
CREATE INDEX `idx_asset_flag_asset` ON `work_request` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_flag_open_blocking` ON `work_request` (`asset_id`) WHERE status = 'pending' and blocks_use = 1;--> statement-breakpoint
CREATE INDEX `idx_asset_flag_work_order` ON `work_request` (`work_order_id`) WHERE work_order_id is not null;