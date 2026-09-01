ALTER TABLE `event_band` RENAME COLUMN `added_by_band_id` TO `added_by_group_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event_band` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`directory_entry_id` text,
	`billing_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`note` text,
	`added_by_group_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_band_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_directory_entry_id_directory_entry_id_fk` FOREIGN KEY (`directory_entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_added_by_band_id_band_id_fk` FOREIGN KEY (`added_by_group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_event_band`(`id`, `event_id`, `name`, `directory_entry_id`, `billing_order`, `status`, `note`, `added_by_group_id`, `created_at`) SELECT `id`, `event_id`, `name`, `directory_entry_id`, `billing_order`, `status`, `note`, `added_by_group_id`, `created_at` FROM `event_band`;--> statement-breakpoint
DROP TABLE `event_band`;--> statement-breakpoint
ALTER TABLE `__new_event_band` RENAME TO `event_band`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_band_event_band` ON `event_band` (`event_id`,`directory_entry_id`) WHERE directory_entry_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_event_band_band_status` ON `event_band` (`directory_entry_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_event_band_event_order` ON `event_band` (`event_id`,`billing_order`);