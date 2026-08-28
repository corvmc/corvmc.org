CREATE TABLE `band_site` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`subscription` text,
	`custom_domain` text,
	`custom_domain_status` text,
	`custom_domain_hostname_id` text,
	`custom_domain_verification` text,
	`custom_domain_added_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_band_site_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `band_media` ADD `band_site_id` text REFERENCES band_site(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `band_page_config` ADD `band_site_id` text REFERENCES band_site(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_site_group` ON `band_site` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_site_custom_domain` ON `band_site` (`custom_domain`);--> statement-breakpoint
CREATE INDEX `idx_band_site_tier` ON `band_site` (`tier`);--> statement-breakpoint
CREATE INDEX `idx_band_media_site_type` ON `band_media` (`band_site_id`,`type`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_band_page_config_site` ON `band_page_config` (`band_site_id`);